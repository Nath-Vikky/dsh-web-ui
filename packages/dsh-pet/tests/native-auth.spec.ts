import type { IncomingMessage } from 'node:http'
import { describe, expect, it } from 'vitest'
import {
  authorizePetNativeRequest,
  createPetNativeToken,
  isLoopbackAddress,
  isPetNativeToken,
  isTrustedPetBrowserRequest,
} from '../src/adapters/web/native-auth.ts'
import { PET_ERROR_CODES } from '../src/errors.ts'

function request(address: string | undefined, authorization?: string): IncomingMessage {
  return {
    headers: { ...(authorization === undefined ? {} : { authorization }) },
    socket: { remoteAddress: address },
  } as unknown as IncomingMessage
}

function browserRequest(
  address: string | undefined,
  host: string | undefined,
  origin?: string,
  fetchSite?: string,
): IncomingMessage {
  return {
    headers: {
      ...(host === undefined ? {} : { host }),
      ...(origin === undefined ? {} : { origin }),
      ...(fetchSite === undefined ? {} : { 'sec-fetch-site': fetchSite }),
    },
    socket: { remoteAddress: address },
  } as unknown as IncomingMessage
}

describe('native bridge authentication', () => {
  it('generates independent 256-bit base64url credentials', () => {
    const first = createPetNativeToken()
    const second = createPetNativeToken()
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(second).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(second).not.toBe(first)
    expect(isPetNativeToken(first)).toBe(true)
    expect(isPetNativeToken('short')).toBe(false)
  })

  it('allows only the explicit loopback address forms', () => {
    expect(isLoopbackAddress('127.0.0.1')).toBe(true)
    expect(isLoopbackAddress('::1')).toBe(true)
    expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true)
    expect(isLoopbackAddress('127.0.0.2')).toBe(false)
    expect(isLoopbackAddress('192.168.1.4')).toBe(false)
    expect(isLoopbackAddress(undefined)).toBe(false)
  })

  it('requires both a loopback peer and the exact bearer token', () => {
    const token = createPetNativeToken()
    expect(authorizePetNativeRequest(request('::1', `Bearer ${token}`), token)).toBeUndefined()
    expect(authorizePetNativeRequest(request('::1'), token)).toBe(PET_ERROR_CODES.nativeAuthRequired)
    expect(authorizePetNativeRequest(request('::1', 'Bearer wrong'), token)).toBe(PET_ERROR_CODES.nativeAuthInvalid)
    expect(authorizePetNativeRequest(request('10.0.0.2', `Bearer ${token}`), token))
      .toBe(PET_ERROR_CODES.nativeLoopbackRequired)
  })

  it('serves standalone browser settings only to same-origin loopback pages', () => {
    expect(isTrustedPetBrowserRequest(browserRequest(
      '127.0.0.1',
      '127.0.0.1:3080',
      'http://127.0.0.1:3080',
      'same-origin',
    ))).toBe(true)
    expect(isTrustedPetBrowserRequest(browserRequest('::1', 'localhost:3080'))).toBe(true)
    expect(isTrustedPetBrowserRequest(browserRequest(
      '127.0.0.1',
      '127.0.0.1:3080',
      'http://example.test',
    ))).toBe(false)
    expect(isTrustedPetBrowserRequest(browserRequest(
      '127.0.0.1',
      '127.0.0.1:3080',
      undefined,
      'cross-site',
    ))).toBe(false)
    expect(isTrustedPetBrowserRequest(browserRequest('192.168.1.5', '127.0.0.1:3080'))).toBe(false)
    expect(isTrustedPetBrowserRequest(browserRequest('127.0.0.1', 'dsh.example.test'))).toBe(false)
  })
})
