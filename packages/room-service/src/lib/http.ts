import type { Context, MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { getCookie } from "hono/cookie";
import type { z } from "zod";
import { verifyAccessToken, verifyUserToken, type TokenClaims, type UserClaims } from "./jwt.ts";

export type AppEnv = { Variables: { auth: TokenClaims } };

/** Accepts JSON, urlencoded and multipart bodies, then validates with zod. */
export const readBody = async <T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> => {
  const contentType = c.req.header("content-type") ?? "";
  let raw: unknown = {};
  try {
    raw = contentType.includes("application/json") ? await c.req.json() : await c.req.parseBody();
  } catch {
    throw new HTTPException(400, { message: "Malformed request body" });
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new HTTPException(400, { message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
  }
  return parsed.data;
};

/** Requires a valid access token issued for the :roomId in the URL. */
export const requireRoomAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const header = c.req.header("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  if (!token) throw new HTTPException(401, { message: "Missing access token" });
  let claims: TokenClaims;
  try {
    claims = await verifyAccessToken(token);
  } catch {
    throw new HTTPException(401, { message: "Invalid or expired access token" });
  }
  const roomId = c.req.param("roomId");
  if (roomId && claims.room_id !== roomId) throw new HTTPException(403, { message: "Token is not valid for this room" });
  c.set("auth", claims);
  await next();
};

export const refreshCookieName = (roomId: string) => `rt_${roomId.replaceAll("-", "_")}`;
export const getRefreshCookie = (c: Context, roomId: string) => getCookie(c, refreshCookieName(roomId));

/**
 * Optional signed-in user on create/join/list requests.
 * No Authorization header -> guest (null). An invalid or expired token is a 401 so the
 * client refreshes instead of silently continuing as a guest.
 */
export const getOptionalUser = async (c: Context): Promise<UserClaims | null> => {
  const header = c.req.header("authorization");
  if (!header) return null;
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  try {
    return await verifyUserToken(token);
  } catch {
    throw new HTTPException(401, { message: "Your sign-in expired. Sign in again." });
  }
};
