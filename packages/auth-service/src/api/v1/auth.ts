import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { and, eq, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/index.ts";
import { sessions, users, type User } from "../../db/schema.ts";
import { env } from "../../lib/env.ts";
import { readBody } from "../../lib/http.ts";
import {
  formatRefreshToken,
  parseRefreshToken,
  randomSecret,
  sha256,
  signUserAccessToken,
  verifyUserAccessToken,
  type UserClaims,
} from "../../lib/tokens.ts";

type AppEnv = { Variables: { user: UserClaims } };
const authAPI = new Hono<AppEnv>();

const COOKIE = "conferx_rt";
const COOKIE_PATH = "/api/v1/auth";
const ROTATION_GRACE_MS = 60_000;

// ---------- schemas ----------
const email = z.string().trim().toLowerCase().pipe(z.email().max(254));
const password = z.string().min(8, "Use at least 8 characters").max(128);
const displayName = z.string().trim().min(1).max(64);

const registerSchema = z.object({ email, password, display_name: displayName });
const loginSchema = z.object({ email, password: z.string().min(1).max(128) });
const updateProfileSchema = z.object({ display_name: displayName });
const changePasswordSchema = z.object({ current_password: z.string().min(1).max(128), new_password: password });

// ---------- helpers ----------
const publicUser = (u: User) => ({ id: u.id, email: u.email, display_name: u.display_name, created_at: u.created_at });

// Verifying against a dummy hash when the email is unknown keeps response times similar,
// so login timing does not reveal which emails are registered.
const dummyHash = Bun.password.hash("conferx-dummy-password");

const setRefreshCookie = (c: Context, token: string) =>
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: "Strict",
    path: COOKIE_PATH,
    maxAge: env.refreshTokenTtl,
  });

const clearRefreshCookie = (c: Context) => deleteCookie(c, COOKIE, { path: COOKIE_PATH, secure: env.cookieSecure });

const expiry = () => new Date(Date.now() + env.refreshTokenTtl * 1000);

/** Creates a device session and returns the response body (access token + user). */
const startSession = async (c: Context, user: User) => {
  const secret = randomSecret();
  const [session] = await db
    .insert(sessions)
    .values({
      user_id: user.id,
      token_hash: await sha256(secret),
      user_agent: c.req.header("user-agent")?.slice(0, 255),
      expires_at: expiry(),
    })
    .returning({ id: sessions.id });
  setRefreshCookie(c, formatRefreshToken(session!.id, secret));
  return { user: publicUser(user), token: await signUserAccessToken(user) };
};

const findUser = async (id: string) => {
  const [user] = await db.select().from(users).where(eq(users.id, id));
  if (!user) throw new HTTPException(401, { message: "Account not found" });
  return user;
};

const requireUser = async (c: Context<AppEnv>, next: () => Promise<void>) => {
  const header = c.req.header("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  if (!token) throw new HTTPException(401, { message: "Sign in required" });
  try {
    c.set("user", await verifyUserAccessToken(token));
  } catch {
    throw new HTTPException(401, { message: "Session expired" });
  }
  await next();
};

// ---------- public ----------
authAPI.post("/register", async (c) => {
  const input = await readBody(c, registerSchema);
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, input.email));
  if (existing) throw new HTTPException(409, { message: "An account with this email already exists" });

  const [user] = await db
    .insert(users)
    .values({ email: input.email, display_name: input.display_name, password_hash: await Bun.password.hash(input.password) })
    .returning();
  return c.json(await startSession(c, user!), 201);
});

authAPI.post("/login", async (c) => {
  const input = await readBody(c, loginSchema);
  const [user] = await db.select().from(users).where(eq(users.email, input.email));
  const valid = await Bun.password.verify(input.password, user?.password_hash ?? (await dummyHash));
  if (!user || !valid) throw new HTTPException(401, { message: "Wrong email or password" });
  return c.json(await startSession(c, user));
});

/** Rotates the refresh token. Reusing an old token revokes the session (likely theft). */
authAPI.post("/refresh", async (c) => {
  const parsed = parseRefreshToken(getCookie(c, COOKIE) ?? "");
  const fail = (message: string) => {
    clearRefreshCookie(c);
    return new HTTPException(401, { message });
  };
  if (!parsed) throw fail("Not signed in");

  const [session] = await db.select().from(sessions).where(eq(sessions.id, parsed.sessionId));
  if (!session || session.revoked_at || session.expires_at < new Date()) throw fail("Session expired");

  const hash = await sha256(parsed.secret);
  if (hash !== session.token_hash) {
    const justRotated =
      hash === session.prev_token_hash && !!session.rotated_at && Date.now() - session.rotated_at.getTime() < ROTATION_GRACE_MS;
    // Another tab refreshed a moment ago: its new cookie is already in the browser, so just retry.
    if (justRotated) throw new HTTPException(409, { message: "Session was just refreshed. Retry." });
    await db.update(sessions).set({ revoked_at: new Date() }).where(eq(sessions.id, session.id));
    throw fail("Session expired");
  }

  const user = await findUser(session.user_id);
  const secret = randomSecret();
  await db
    .update(sessions)
    .set({
      token_hash: await sha256(secret),
      prev_token_hash: session.token_hash,
      rotated_at: new Date(),
      last_used_at: new Date(),
      expires_at: expiry(),
    })
    .where(eq(sessions.id, session.id));
  setRefreshCookie(c, formatRefreshToken(session.id, secret));
  return c.json({ user: publicUser(user), token: await signUserAccessToken(user) });
});

authAPI.post("/logout", async (c) => {
  const parsed = parseRefreshToken(getCookie(c, COOKIE) ?? "");
  if (parsed) {
    await db.update(sessions).set({ revoked_at: new Date() }).where(eq(sessions.id, parsed.sessionId));
  }
  clearRefreshCookie(c);
  return c.body(null, 204);
});

// ---------- signed in ----------
authAPI.get("/me", requireUser, async (c) => {
  return c.json(publicUser(await findUser(c.get("user").sub)));
});

authAPI.patch("/me", requireUser, async (c) => {
  const { display_name } = await readBody(c, updateProfileSchema);
  const [user] = await db
    .update(users)
    .set({ display_name, updated_at: new Date() })
    .where(eq(users.id, c.get("user").sub))
    .returning();
  if (!user) throw new HTTPException(401, { message: "Account not found" });
  // New access token so the updated name is used right away.
  return c.json({ user: publicUser(user), token: await signUserAccessToken(user) });
});

/** Changes the password and signs out every other device. */
authAPI.post("/me/password", requireUser, async (c) => {
  const input = await readBody(c, changePasswordSchema);
  const user = await findUser(c.get("user").sub);
  if (!(await Bun.password.verify(input.current_password, user.password_hash))) {
    throw new HTTPException(400, { message: "Current password is incorrect" });
  }
  await db
    .update(users)
    .set({ password_hash: await Bun.password.hash(input.new_password), updated_at: new Date() })
    .where(eq(users.id, user.id));

  const current = parseRefreshToken(getCookie(c, COOKIE) ?? "");
  await db
    .update(sessions)
    .set({ revoked_at: new Date() })
    .where(
      and(
        eq(sessions.user_id, user.id),
        isNull(sessions.revoked_at),
        current ? ne(sessions.id, current.sessionId) : undefined,
      ),
    );
  return c.body(null, 204);
});

export default authAPI;
