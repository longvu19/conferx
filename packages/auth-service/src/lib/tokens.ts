import { sign, verify } from "hono/jwt";
import { env } from "./env.ts";
import type { User } from "../db/schema.ts";

export interface UserClaims {
  sub: string;
  email: string;
  name: string;
}

const now = () => Math.floor(Date.now() / 1000);

/** Short-lived access token. room-service verifies it with the same secret. */
export const signUserAccessToken = (user: Pick<User, "id" | "email" | "display_name">) =>
  sign(
    { sub: user.id, email: user.email, name: user.display_name, typ: "user", iat: now(), exp: now() + env.accessTokenTtl },
    env.userJwtSecret,
    "HS256",
  );

export const verifyUserAccessToken = async (token: string): Promise<UserClaims> => {
  const payload = await verify(token, env.userJwtSecret, "HS256");
  if (payload.typ !== "user" || typeof payload.sub !== "string") throw new Error("Invalid token");
  return { sub: payload.sub, email: String(payload.email), name: String(payload.name) };
};

const toHex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");

export const randomSecret = () => toHex(crypto.getRandomValues(new Uint8Array(32)).buffer);

export const sha256 = async (value: string) =>
  toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));

/** Opaque refresh token: "<session id>.<secret>". Only sha256(secret) is stored. */
export const formatRefreshToken = (sessionId: string, secret: string) => `${sessionId}.${secret}`;

export const parseRefreshToken = (token: string) => {
  const [sessionId, secret] = token.split(".");
  const uuid = /^[0-9a-f-]{36}$/i;
  if (!sessionId || !secret || !uuid.test(sessionId) || !/^[0-9a-f]{64}$/.test(secret)) return null;
  return { sessionId, secret };
};
