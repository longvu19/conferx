import { sign, verify } from 'hono/jwt'
import type { JWTPayload } from 'hono/utils/jwt/types'

const ACCESS_SECRET = Bun.env.JWT_SECRET as string;
const REFRESH_SECRET = Bun.env.JWT_REFRESH_SECRET as string;

export async function signAccessToken(payload: JWTPayload) {
  return await sign(payload, ACCESS_SECRET, 'HS256')
}

export async function signRefreshToken(payload: JWTPayload) {
  return await sign(payload, REFRESH_SECRET, 'HS256')
}

export async function verifyRefreshToken(token: string) {
  return await verify(token, REFRESH_SECRET, 'HS256')
}