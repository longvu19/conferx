import { sign, verify } from "hono/jwt";
import { env } from "./env.ts";

export type Role = "admin" | "member";
export interface TokenClaims {
  room_id: string;
  user_id: string;
  role: Role;
}

const now = () => Math.floor(Date.now() / 1000);

export const signAccessToken = (claims: TokenClaims) =>
  sign({ ...claims, typ: "access", iat: now(), exp: now() + env.accessTokenTtl }, env.jwtSecret, "HS256");

export const signRefreshToken = (claims: TokenClaims) =>
  sign({ ...claims, typ: "refresh", iat: now(), exp: now() + env.refreshTokenTtl }, env.jwtRefreshSecret, "HS256");

const toClaims = (payload: Record<string, unknown>, typ: string): TokenClaims => {
  if (payload.typ !== typ || typeof payload.room_id !== "string" || typeof payload.user_id !== "string") {
    throw new Error("Invalid token payload");
  }
  return { room_id: payload.room_id, user_id: payload.user_id, role: payload.role === "admin" ? "admin" : "member" };
};

export const verifyAccessToken = async (token: string) =>
  toClaims(await verify(token, env.jwtSecret, "HS256"), "access");

export const verifyRefreshToken = async (token: string) =>
  toClaims(await verify(token, env.jwtRefreshSecret, "HS256"), "refresh");

export interface UserClaims {
  sub: string;
  name: string;
}

/** Access token issued by auth-service for a signed-in account. */
export const verifyUserToken = async (token: string): Promise<UserClaims> => {
  const payload = await verify(token, env.userJwtSecret, "HS256");
  if (payload.typ !== "user" || typeof payload.sub !== "string") throw new Error("Invalid user token");
  return { sub: payload.sub, name: String(payload.name ?? "") };
};
