/** Host half of dsh-pet's narrow, loopback-only settings fallback. */

import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  SettingsConflictError,
  settingsNamespace,
  type SettingsDescriptor,
  type SettingsNamespace,
  type SettingsPathOp,
  type SettingsProvider,
} from '@deepseek-ai/dsh-settings'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import {
  PET_SETTINGS_BRIDGE_PREFIX,
  type PetSettingsBridgeMutateRequest,
  type PetSettingsBridgeOp,
  type PetSettingsBridgeResult,
  type PetSettingsBridgeView,
  type PetSettingsField,
} from './settings-protocol.ts'
import { PET_SETTINGS_NAMESPACE } from './service.ts'

const MAX_JSON_BODY_BYTES = 8 * 1024
const FIELDS = new Set<PetSettingsField>(['enabled', 'visible', 'alwaysOnTop', 'locked'])

/** Accept only a loopback browser talking to its own origin. */
function isLoopbackRequest(request: IncomingMessage): boolean {
  const address = request.socket.remoteAddress
  if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') return false
  const host = request.headers.host
  if (typeof host !== 'string') return false
  let hostUrl: URL
  try {
    hostUrl = new URL(`http://${host}`)
  } catch {
    return false
  }
  if (hostUrl.hostname !== '127.0.0.1' && hostUrl.hostname !== 'localhost' && hostUrl.hostname !== '[::1]') return false
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = request.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'referrer-policy': 'no-referrer',
  })
  res.end(JSON.stringify(body))
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > MAX_JSON_BODY_BYTES) return undefined
    chunks.push(buffer)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } catch {
    return undefined
  }
}

function toView(descriptor: SettingsDescriptor, settings: SettingsProvider): PetSettingsBridgeView {
  return {
    value: descriptor.value,
    ...(descriptor.base === undefined ? {} : { base: descriptor.base }),
    ...(descriptor.user === undefined ? {} : { user: descriptor.user }),
    revision: descriptor.revision,
    writable: settings.writable !== false,
  }
}

function descriptorOf(settings: SettingsProvider): SettingsDescriptor | undefined {
  return settings.describe({ redactSecrets: true })
    .find(descriptor => String(descriptor.ns) === PET_SETTINGS_NAMESPACE)
}

function failureOf(error: unknown): PetSettingsBridgeResult {
  if (error instanceof SettingsConflictError) {
    return { ok: false, code: 'settings-conflict', message: error.message }
  }
  const message = error instanceof Error ? error.message : String(error)
  return { ok: false, code: 'settings-rejected', message }
}

function parseOps(value: unknown): PetSettingsBridgeOp[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > FIELDS.size) return undefined
  const seen = new Set<string>()
  const parsed: PetSettingsBridgeOp[] = []
  for (const candidate of value) {
    if (typeof candidate !== 'object' || candidate === null) return undefined
    const op = candidate as { op?: unknown; path?: unknown; value?: unknown }
    if ((op.op !== 'set' && op.op !== 'unset') || !Array.isArray(op.path) || op.path.length !== 1) return undefined
    const field = op.path[0]
    if (typeof field !== 'string' || !FIELDS.has(field as PetSettingsField) || seen.has(field)) return undefined
    seen.add(field)
    if (op.op === 'set') {
      if (typeof op.value !== 'boolean') return undefined
      parsed.push({ op: 'set', path: [field as PetSettingsField], value: op.value })
    } else {
      parsed.push({ op: 'unset', path: [field as PetSettingsField] })
    }
  }
  return parsed
}

/** Build the two narrow bridge routes for this package's own namespace. */
export function makePetSettingsBridgeRoutes(settings: SettingsProvider): WebRoute[] {
  const guard = (req: IncomingMessage, res: ServerResponse): boolean => {
    if (!isLoopbackRequest(req)) {
      writeJson(res, 403, { ok: false, code: 'forbidden', message: 'loopback requests only' })
      return false
    }
    if (req.method !== 'POST') {
      writeJson(res, 405, { ok: false, code: 'method-not-allowed', message: 'POST required' })
      return false
    }
    return true
  }
  const current = (): PetSettingsBridgeResult => {
    const descriptor = descriptorOf(settings)
    return descriptor === undefined
      ? { ok: false, code: 'settings-unavailable', message: 'pet settings namespace is not registered' }
      : { ok: true, value: toView(descriptor, settings) }
  }
  return [
    {
      kind: 'exact',
      path: `${PET_SETTINGS_BRIDGE_PREFIX}/describe`,
      handler: async (req, res) => {
        if (!guard(req, res)) return
        // Consume and validate the tiny request body so malformed callers do
        // not accidentally look like a successful settings read.
        const body = await readJsonBody(req)
        if (typeof body !== 'object' || body === null || Array.isArray(body)) {
          writeJson(res, 400, { ok: false, code: 'settings-rejected', message: 'unreadable JSON body' })
          return
        }
        writeJson(res, 200, current())
      },
    },
    {
      kind: 'exact',
      path: `${PET_SETTINGS_BRIDGE_PREFIX}/mutate`,
      handler: async (req, res) => {
        if (!guard(req, res)) return
        const body = await readJsonBody(req) as Partial<PetSettingsBridgeMutateRequest> | undefined
        const ops = parseOps(body?.ops)
        const expectedRevision = body?.expectedRevision
        if (ops === undefined || (expectedRevision !== undefined && (!Number.isInteger(expectedRevision) || expectedRevision < 0))) {
          writeJson(res, 400, { ok: false, code: 'settings-rejected', message: 'malformed pet settings request' })
          return
        }
        try {
          await settings.mutate(
            settingsNamespace(PET_SETTINGS_NAMESPACE) as SettingsNamespace,
            ops as SettingsPathOp[],
            expectedRevision,
          )
          writeJson(res, 200, current())
        } catch (error) {
          writeJson(res, 200, failureOf(error))
        }
      },
    },
  ]
}
