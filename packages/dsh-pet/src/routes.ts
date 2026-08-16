/**
 * Pet HTTP bridge — the Electron companion consumes state and interactions,
 * and mirrors window preferences back to the Host settings namespace.
 * @module @linxin666/dsh-pet/routes
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { PetCompanionSettings, PetService } from './service.ts'
import type { PetInteraction } from './affinity.ts'

/** Local companion-facing base path of the pet API. */
export const PET_API_PREFIX = '/api/pet'

/** Keep intermediary proxies and browsers from considering an idle stream dead. */
export const PET_SSE_HEARTBEAT_MS = 15_000

/** Write one JSON response. */
function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

/** Require the method or answer 405. */
function requireMethod(req: IncomingMessage, res: ServerResponse, method: string): boolean {
  if (req.method === method) return true
  json(res, 405, { ok: false, error: 'method-not-allowed' })
  return false
}

/** Read a JSON request body (bounded). */
function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 64 * 1024) {
        // Reject first so the error handler can write the 400 response,
        // then close the connection once the response is flushed.
        reject(new Error('body-too-large'))
        queueMicrotask(() => req.destroy())
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new Error('invalid-json'))
      }
    })
    req.on('error', reject)
  })
}

/** Wrap one async service call as a GET JSON route. */
function getRoute(path: string, run: () => Promise<unknown>): WebRoute {
  return {
    kind: 'exact',
    path,
    handler: (req: IncomingMessage, res: ServerResponse): void => {
      if (!requireMethod(req, res, 'GET')) return
      run().then((value) => json(res, 200, value), (error) => {
        json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
      })
    },
  }
}

/** Wrap one async service call as a POST JSON route (body passed through). */
function postRoute(path: string, run: (body: Record<string, unknown>) => Promise<unknown>): WebRoute {
  return {
    kind: 'exact',
    path,
    handler: (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      if (!requireMethod(req, res, 'POST')) return Promise.resolve()
      return readJsonBody(req).then((body) => {
        const record = (typeof body === 'object' && body !== null) ? body as Record<string, unknown> : {}
        return run(record).then(
          (value) => json(res, 200, value),
          (error) => {
            json(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
          },
        )
      }, (error) => {
        json(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
      })
    },
  }
}

/** Full-snapshot SSE stream; closing the request releases every listener and timer. */
function eventStreamRoute(service: PetService): WebRoute {
  return {
    kind: 'exact',
    path: `${PET_API_PREFIX}/events`,
    handler: (req: IncomingMessage, res: ServerResponse): void => {
      if (!requireMethod(req, res, 'GET')) return
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        'connection': 'keep-alive',
        'x-accel-buffering': 'no',
      })
      res.flushHeaders?.()

      let closed = false
      let unsubscribe = (): void => undefined
      let heartbeat: ReturnType<typeof setInterval> | undefined
      const close = (): void => {
        if (closed) return
        closed = true
        if (heartbeat !== undefined) clearInterval(heartbeat)
        unsubscribe()
        req.off('close', close)
      }
      const send = (snapshot: Awaited<ReturnType<PetService['state']>>): void => {
        if (closed) return
        try {
          res.write(`data: ${JSON.stringify(snapshot)}\n\n`)
        } catch {
          close()
        }
      }
      req.once('close', close)
      const disposeSubscription = service.subscribeState(send)
      if (closed) {
        disposeSubscription()
        return
      }
      unsubscribe = disposeSubscription
      heartbeat = setInterval(() => {
        if (closed) return
        try {
          res.write(': heartbeat\n\n')
        } catch {
          close()
        }
      }, PET_SSE_HEARTBEAT_MS)
      heartbeat.unref?.()
    },
  }
}

/** Build the desktop companion route family for one pet service. */
export function makePetRoutes(deps: { service: PetService }): WebRoute[] {
  const { service } = deps
  return [
    getRoute(`${PET_API_PREFIX}/state`, () => service.state()),
    eventStreamRoute(service),
    postRoute(`${PET_API_PREFIX}/interact`, (body) => {
      const kind = body.kind as PetInteraction | undefined
      if (kind !== 'pet' && kind !== 'feed') return Promise.reject(new Error('invalid-kind'))
      return service.interact(kind)
    }),
    postRoute(`${PET_API_PREFIX}/companion-settings`, (body) => {
      const keys = ['visible', 'alwaysOnTop', 'locked'] as const
      const invalid = keys.some(key => body[key] !== undefined && typeof body[key] !== 'boolean')
      if (invalid) return Promise.reject(new Error('invalid-companion-settings'))
      const patch: Partial<PetCompanionSettings> = {}
      for (const key of keys) {
        if (typeof body[key] === 'boolean') patch[key] = body[key]
      }
      if (Object.keys(patch).length === 0) return Promise.reject(new Error('empty-companion-settings'))
      return service.setCompanionSettings(patch)
    }),
  ]
}
