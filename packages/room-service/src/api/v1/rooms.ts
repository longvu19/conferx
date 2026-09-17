import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { setCookie } from "hono/cookie";
import { and, desc, eq, sql } from "drizzle-orm";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { db } from "../../db/index.ts";
import { participants, rooms, type Participant, type Room } from "../../db/schema.ts";
import { env } from "../../lib/env.ts";
import { generateRoomId, generateRoomPassword } from "../../lib/ids.ts";
import { signAccessToken, signRefreshToken, verifyRefreshToken, type TokenClaims } from "../../lib/jwt.ts";
import { closeMediaRoom, createMediaToken, removeFromMediaRoom } from "../../lib/livekit.ts";
import { getOptionalUser, getRefreshCookie, readBody, refreshCookieName, requireRoomAuth, type AppEnv } from "../../lib/http.ts";

const roomsAPI = new Hono<AppEnv>();

// ---------- schemas ----------
// Guest browser id; the server prefixes it so guests can never claim an account's id.
const guestId = z.string().trim().min(8).max(60).optional();
const displayName = z.string().trim().min(1).max(64).optional();

const createRoomSchema = z.object({
  user_id: guestId,
  name: displayName,
  admin_password: z.string().min(8).max(128),
  status: z.enum(["open", "private"]).default("private"),
});
const joinRoomSchema = z.object({ user_id: guestId, name: displayName, password: z.string().min(1).max(128).optional() });
const updateRoomSchema = z.object({ status: z.enum(["open", "private"]) });
const updateParticipantSchema = z.object({ status: z.enum(["approved", "rejected"]) });

// ---------- helpers ----------
const findRoom = async (roomId: string): Promise<Room> => {
  const [room] = await db.select().from(rooms).where(eq(rooms.room_id, roomId));
  if (!room) throw new HTTPException(404, { message: "Meeting not found" });
  return room;
};

const findActiveRoom = async (roomId: string) => {
  const room = await findRoom(roomId);
  if (room.status === "closed") throw new HTTPException(410, { message: "Meeting has ended" });
  return room;
};

const findParticipant = async (roomId: string, uid: string): Promise<Participant | undefined> => {
  const [row] = await db
    .select()
    .from(participants)
    .where(and(eq(participants.room_id, roomId), eq(participants.user_id, uid)));
  return row;
};

const requireParticipant = async (auth: TokenClaims) => {
  const me = await findParticipant(auth.room_id, auth.user_id);
  if (!me || me.status === "rejected") throw new HTTPException(403, { message: "You are not in this meeting" });
  return me;
};

const requireAdmin = async (auth: TokenClaims) => {
  const me = await requireParticipant(auth);
  if (me.role !== "admin") throw new HTTPException(403, { message: "Only the meeting admin can do this" });
  return me;
};

/**
 * Who is calling: a signed-in account ("u_<id>", from the user token) or a guest
 * ("g_<browser id>"). Prefixes keep the two id spaces apart.
 */
const resolveIdentity = async (c: Context, input: { user_id?: string; name?: string }) => {
  const user = await getOptionalUser(c);
  if (user) return { id: `u_${user.sub}`, name: input.name ?? user.name, isAccount: true };
  if (!input.user_id) throw new HTTPException(400, { message: "user_id is required for guests" });
  if (!input.name) throw new HTTPException(400, { message: "name is required" });
  return { id: `g_${input.user_id}`, name: input.name, isAccount: false };
};

const safeEqual = (a: string, b: string) => {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
};

const publicParticipant = (p: Participant) => ({
  user_id: p.user_id,
  name: p.name,
  role: p.role,
  status: p.status,
  joined_at: p.created_at,
});

/** Issues an access token in the body and a refresh token as an HttpOnly cookie. */
const issueSession = async (c: Context, claims: TokenClaims) => {
  const [accessToken, refreshToken] = await Promise.all([signAccessToken(claims), signRefreshToken(claims)]);
  setCookie(c, refreshCookieName(claims.room_id), refreshToken, {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE !== "false",
    sameSite: "Strict",
    path: "/api/v1/rooms",
    maxAge: env.refreshTokenTtl,
  });
  return accessToken;
};

// ---------- public endpoints ----------

/** Meetings created by the signed-in account (newest first). */
roomsAPI.get("/", async (c) => {
  const user = await getOptionalUser(c);
  if (!user) throw new HTTPException(401, { message: "Sign in to see your meetings" });
  const mine = await db
    .select({ room_id: rooms.room_id, status: rooms.status, room_password: rooms.room_password, created_at: rooms.created_at })
    .from(rooms)
    .where(eq(rooms.admin_id, `u_${user.sub}`))
    .orderBy(desc(rooms.created_at))
    .limit(50);
  return c.json(mine);
});

/** Public room info used by the join screen. Never exposes passwords. */
roomsAPI.get("/:roomId", async (c) => {
  const room = await findRoom(c.req.param("roomId"));
  const [count] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(participants)
    .where(and(eq(participants.room_id, room.room_id), eq(participants.status, "approved")));
  return c.json({
    room_id: room.room_id,
    status: room.status,
    participant_count: count?.value ?? 0,
    created_at: room.created_at,
  });
});

/** Create a meeting. The creator becomes admin and receives the room password to share. */
roomsAPI.post("/", async (c) => {
  const input = await readBody(c, createRoomSchema);
  const who = await resolveIdentity(c, input);
  const adminPasswordHash = await Bun.password.hash(input.admin_password, { algorithm: "bcrypt", cost: 10 });

  // Retry on the (unlikely) event of a room_id collision.
  let room: Room | undefined;
  for (let attempt = 0; attempt < 3 && !room; attempt++) {
    try {
      room = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(rooms)
          .values({
            room_id: generateRoomId(),
            admin_id: who.id,
            admin_password: adminPasswordHash,
            room_password: generateRoomPassword(),
            status: input.status,
          })
          .returning();
        if (!created) throw new Error("Failed to create room");
        await tx.insert(participants).values({
          room_id: created.room_id,
          user_id: who.id,
          name: who.name,
          role: "admin",
          status: "approved",
        });
        return created;
      });
    } catch (error) {
      if (attempt === 2 || !String(error).includes("unique")) throw error;
    }
  }
  if (!room) throw new HTTPException(500, { message: "Failed to create room" });

  const token = await issueSession(c, { room_id: room.room_id, user_id: who.id, role: "admin" });
  return c.json(
    { room_id: room.room_id, user_id: who.id, room_password: room.room_password, status: room.status, role: "admin", participant_status: "approved", token },
    201,
  );
});

/**
 * Join with the room password (member) or the admin password (admin).
 * The signed-in account that created the room rejoins as admin without a password.
 * Open rooms approve members immediately; private rooms put them in the waiting list.
 * Calling join again (e.g. after a page reload) re-issues the session.
 */
roomsAPI.post("/:roomId/join", async (c) => {
  const room = await findActiveRoom(c.req.param("roomId"));
  const input = await readBody(c, joinRoomSchema);
  const who = await resolveIdentity(c, input);

  const isOwner = who.isAccount && room.admin_id === who.id;
  const isAdmin = isOwner || (!!input.password && (await Bun.password.verify(input.password, room.admin_password)));
  if (!isAdmin && !(input.password && safeEqual(input.password, room.room_password))) {
    throw new HTTPException(401, { message: input.password ? "Wrong meeting password" : "Enter the meeting password" });
  }

  const existing = await findParticipant(room.room_id, who.id);
  if (existing?.status === "rejected" && !isAdmin) {
    throw new HTTPException(403, { message: "The admin removed you from this meeting" });
  }

  const role = isAdmin ? "admin" : (existing?.role ?? "member");
  const status =
    role === "admin" || existing?.status === "approved" || room.status === "open" ? "approved" : "pending";

  await db
    .insert(participants)
    .values({ room_id: room.room_id, user_id: who.id, name: who.name, role, status })
    .onConflictDoUpdate({
      target: [participants.room_id, participants.user_id],
      set: { name: who.name, role, status, updated_at: new Date() },
    });

  const token = await issueSession(c, { room_id: room.room_id, user_id: who.id, role });
  return c.json({ room_id: room.room_id, user_id: who.id, role, participant_status: status, token }, existing ? 200 : 201);
});

/** Exchange the HttpOnly refresh cookie for a new access token. */
roomsAPI.post("/:roomId/refresh-token", async (c) => {
  const roomId = c.req.param("roomId");
  const cookie = getRefreshCookie(c, roomId);
  if (!cookie) throw new HTTPException(401, { message: "Refresh token not provided" });

  let claims: TokenClaims;
  try {
    claims = await verifyRefreshToken(cookie);
  } catch {
    throw new HTTPException(401, { message: "Invalid or expired refresh token" });
  }
  if (claims.room_id !== roomId) throw new HTTPException(401, { message: "Invalid refresh token" });

  await findActiveRoom(roomId);
  const me = await requireParticipant(claims);
  const token = await issueSession(c, { room_id: roomId, user_id: me.user_id, role: me.role });
  return c.json({ token, role: me.role, participant_status: me.status });
});

// ---------- authenticated endpoints ----------
roomsAPI.use("/:roomId/*", async (c, next) => {
  const path = c.req.path;
  if (path.endsWith("/join") || path.endsWith("/refresh-token")) return next();
  return requireRoomAuth(c, next);
});

/** Current user's membership. Polled by the waiting screen. */
roomsAPI.get("/:roomId/me", async (c) => {
  const auth = c.get("auth");
  const room = await findRoom(auth.room_id);
  const me = await findParticipant(auth.room_id, auth.user_id);
  if (!me) throw new HTTPException(404, { message: "You are not in this meeting" });
  return c.json({
    room: {
      room_id: room.room_id,
      status: room.status,
      ...(me.role === "admin" && me.status === "approved" ? { room_password: room.room_password } : {}),
    },
    participant: publicParticipant(me),
  });
});

/** Participants. Admin also sees the waiting list. */
roomsAPI.get("/:roomId/participants", async (c) => {
  const auth = c.get("auth");
  const me = await requireParticipant(auth);
  if (me.status !== "approved") throw new HTTPException(403, { message: "Waiting for approval" });
  const rows = await db.select().from(participants).where(eq(participants.room_id, auth.room_id));
  const visible = me.role === "admin" ? rows.filter((p) => p.status !== "rejected") : rows.filter((p) => p.status === "approved");
  return c.json(visible.map(publicParticipant));
});

/** Admin approves or rejects a participant. */
roomsAPI.patch("/:roomId/participants/:userId", async (c) => {
  const auth = c.get("auth");
  await findActiveRoom(auth.room_id);
  await requireAdmin(auth);
  const { status } = await readBody(c, updateParticipantSchema);
  const target = c.req.param("userId");
  if (target === auth.user_id) throw new HTTPException(400, { message: "You cannot change your own status" });

  const [updated] = await db
    .update(participants)
    .set({ status, updated_at: new Date() })
    .where(and(eq(participants.room_id, auth.room_id), eq(participants.user_id, target)))
    .returning();
  if (!updated) throw new HTTPException(404, { message: "Participant not found" });
  if (status === "rejected") await removeFromMediaRoom(auth.room_id, target);
  return c.json(publicParticipant(updated));
});

/** Leave (self) or remove someone (admin). Removed users cannot rejoin with the room password. */
roomsAPI.delete("/:roomId/participants/:userId", async (c) => {
  const auth = c.get("auth");
  const target = c.req.param("userId");
  if (target === auth.user_id) {
    await db.delete(participants).where(and(eq(participants.room_id, auth.room_id), eq(participants.user_id, target)));
  } else {
    await requireAdmin(auth);
    const [updated] = await db
      .update(participants)
      .set({ status: "rejected", updated_at: new Date() })
      .where(and(eq(participants.room_id, auth.room_id), eq(participants.user_id, target)))
      .returning();
    if (!updated) throw new HTTPException(404, { message: "Participant not found" });
  }
  await removeFromMediaRoom(auth.room_id, target);
  return c.body(null, 204);
});

/** Admin switches between open and private. */
roomsAPI.patch("/:roomId", async (c) => {
  const auth = c.get("auth");
  await findActiveRoom(auth.room_id);
  await requireAdmin(auth);
  const { status } = await readBody(c, updateRoomSchema);
  const [room] = await db
    .update(rooms)
    .set({ status, updated_at: new Date() })
    .where(eq(rooms.room_id, auth.room_id))
    .returning({ room_id: rooms.room_id, status: rooms.status });
  return c.json(room);
});

/** Admin ends the meeting for everyone. */
roomsAPI.post("/:roomId/end", async (c) => {
  const auth = c.get("auth");
  await findActiveRoom(auth.room_id);
  await requireAdmin(auth);
  await db.update(rooms).set({ status: "closed", updated_at: new Date() }).where(eq(rooms.room_id, auth.room_id));
  await closeMediaRoom(auth.room_id);
  return c.body(null, 204);
});

/** LiveKit token for approved participants. */
roomsAPI.post("/:roomId/media-token", async (c) => {
  const auth = c.get("auth");
  await findActiveRoom(auth.room_id);
  const me = await requireParticipant(auth);
  if (me.status !== "approved") throw new HTTPException(403, { message: "Waiting for approval" });
  const token = await createMediaToken(auth.room_id, me.user_id, me.name, me.role);
  return c.json({ token, url: env.livekit.publicUrl });
});


export default roomsAPI;
