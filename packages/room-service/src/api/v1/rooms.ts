import { Hono } from "hono";
import { eq, and } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { participants, rooms, RoomsStatusEnumValues } from "../../db/schema.ts";
import type { Room, Participant, NewRoom, RoomsStatusEnumType } from "../../db/schema.ts";
import { jwt } from 'hono/jwt';
import { verifyRefreshToken, signAccessToken, signRefreshToken } from "../../helper/jwt.ts";
import type { JwtVariables } from 'hono/jwt'
type Variables = JwtVariables;
const secretToken = process.env.JWT_SECRET
const roomsAPI = new Hono<{ Variables: Variables }>();
const db = drizzle({ connection: process.env.DB_URL!, casing: "snake_case" });

roomsAPI.get("/", async (c) => {
  const roomsData = await db.select().from(rooms).leftJoin(participants, eq(rooms.room_id, participants.room_id));
  const result = roomsData.reduce<Record<string, { room: Room; participants: Participant[]; }>>((acc, row) => {
    const roomId = row.rooms.room_id;
    if (!acc[roomId]) {
      acc[roomId] = { room: row.rooms, participants: [] };
    }
    acc[roomId].participants.push(row.participants!);
    return acc;
  }, {});
  c.status(200);
  return c.json(result);
});

roomsAPI.get("/:roomId", async (c) => {
  const roomId = c.req.param("roomId");
  const roomData = await db
    .select()
    .from(rooms)
    .leftJoin(participants,eq(rooms.room_id, participants.room_id))
    .where(eq(rooms.room_id, roomId));
  if(roomData.length < 1) {
    c.status(404);
    return c.json({ error: "Meeting not found" });
  }
  c.status(200);
  return c.json(roomData);
});

roomsAPI.post("/", async (c) => {
  const userInput = await c.req.parseBody();
  const roomData : NewRoom = {
    room_id: `${Bun.nanoseconds().toString()}-${Math.floor(Math.random() * 100).toString().padStart(3, '0')}`,
    admin_password: await Bun.password.hash(userInput.admin_password as string, {
      algorithm: "bcrypt",
      cost: 4,
    }),
    admin_id: userInput.user_id as string,
    room_password: Math.floor(Math.random() * 10000000).toString().padStart(8, '0'),
    status: "open",
  }
  const result = await db.transaction(async (tx) => {
    const insertedRoom = await tx.insert(rooms).values(roomData).returning();
    if (!insertedRoom[0]) {
      throw new Error("Failed to insert room");
    }
    const insertedParticipant = await tx.insert(participants).values({
      room_id: insertedRoom[0].room_id,
      name: userInput.name as string,
      user_id: userInput.user_id as string,
      status: 'approved'
    }).returning();
    if (!insertedParticipant[0]) {
      tx.rollback();
      throw new Error("Failed to insert participant");
    }
  });
  const payload = {
    room_id: roomData.room_id,
    user_id: userInput.user_id as string,
    iat: Math.floor(Date.now() / 1000),
  }
  const token = await signAccessToken(payload);
  const refreshToken = await signRefreshToken(payload);
  c.header('Set-Cookie', `refresh_token=${refreshToken}; HttpOnly; Secure; Path=/api/rooms/refresh-token; Max-Age=${60 * 60 * 24 * 7}; SameSite=Strict`);
  c.status(201);
  return c.json({token: token});
});

roomsAPI.post("/refresh-token", async (c) => {
  const refreshToken = c.req.header("Cookie")?.split('; ').find(row => row.startsWith('refresh_token='));
  if (!refreshToken) {
    c.status(401);
    return c.json({ error: "Refresh token not provided" });
  }
  const token = refreshToken.split('=')[1];
  try {
    const payload = await verifyRefreshToken(token as string);
    const newAccessToken = await signAccessToken(payload);
    c.status(200);
    return c.json({ token: newAccessToken });
  } catch (error) {
    c.status(401);
    return c.json({ error: "Invalid refresh token" });
  }
});

roomsAPI.put("/:roomId", async (c) => {
  const roomId = c.req.param("roomId");
  const userInput = await c.req.parseBody();
  const status : RoomsStatusEnumType = Object.values(RoomsStatusEnumValues).includes(userInput.status as RoomsStatusEnumType) ? userInput.status as RoomsStatusEnumType : "open";
  const result = await db
    .update(rooms)
    .set({
      status: status,
      updated_at: new Date(),
    })
    .where(eq(rooms.room_id, roomId)).returning();
  if (result.length === 0) {
    c.status(404);
    return c.json({ error: "Room not found" });
  }
  c.status(200);
  return c.json(result);
});

roomsAPI.delete("/:roomId", async (c) => {
  const roomId = c.req.param("roomId");
  const result = await db.transaction(async (tx) => {
    const deletedParticipants = await tx
      .delete(participants)
      .where(eq(participants.room_id, roomId));
    const deletedRoom = await tx
      .delete(rooms)
      .where(eq(rooms.room_id, roomId));
    return deletedRoom;
  });
  c.status(204);
  return c.json(result);
});

roomsAPI.post("/join/:roomId", async (c) => {
  const roomId = c.req.param("roomId");
  const userInput = await c.req.parseBody();
  const userId = userInput.user_id as string;
  const roomData = await db.select().from(rooms).where(eq(rooms.room_id, roomId));
  const existingParticipant = await db.select().from(participants).where(
    and(eq(participants.room_id, roomId),
    eq(participants.user_id, userId))
  );
  if (existingParticipant.length > 0) {
    c.status(409);
    return c.json({ error: "User already joined the meeting" });
  }
  if (roomData.length < 1) {
    c.status(404);
    return c.json({ error: "Meeting not found" });
  }else if(roomData[0]!.status === "closed") {
    c.status(403);
    return c.json({ error: "Meeting is ended" });
  }
  const result = await db.insert(participants).values({
    room_id: roomId,
    name: userInput.name as string,
    user_id: userId,
    status: "pending",
  });
  c.status(201);
  return c.json(result);
});

roomsAPI.delete("/leave/:roomId/:userId", async (c) => {
  const roomId = c.req.param("roomId");
  const userId = c.req.param("userId");
  const result = await db.delete(participants).where(
    and(eq(participants.room_id, roomId),
    eq(participants.user_id, userId))
  );
  c.status(204);
  return c.json({ status: "success", data: result });
});

roomsAPI.put("/approve/:roomId/:userId", jwt({
  secret: secretToken as string }), async (c) => {
  const roomId = c.req.param("roomId");
  const userId = c.req.param("userId");
  const payload = c.get('jwtPayload');
  if (!payload || payload.room_id !== roomId) {
    c.status(403);
    return c.json({ error: "Forbidden" });
  }
  const result = await db.update(participants).set({ status: "approved" }).where(
    and(eq(participants.room_id, roomId),
    eq(participants.user_id, userId))
  );
  c.status(200);
  return c.json({ status: "success", data: result });
});

roomsAPI.put("/end/:roomId",jwt({
    secret: secretToken as string
  }), async (c) => {
  const roomId = c.req.param("roomId");
  const payload = c.get('jwtPayload');
  if (!payload || payload.room_id !== roomId) {
    c.status(403);
    return c.json({ error: "Forbidden" });
  }
  const roomData = await db.select().from(rooms).where(eq(rooms.room_id, roomId));
  if (roomData.length < 1) {
    c.status(404);
    return c.json({ error: "Meeting not found" });
  }
  if (roomData[0]!.status === "closed") {
    c.status(403);
    return c.json({ error: "Meeting is already ended" });
  }
  if (roomData[0]!.admin_id !== payload.user_id) {
    c.status(403);
    return c.json({ error: "Only the admin can end the meeting" });
  }

  const result = await db.transaction(async (tx) => {
    const updatedRoom = await tx
      .update(rooms)
      .set({
        status: "closed",
        updated_at: new Date(),
      })
      .where(eq(rooms.room_id, roomId)).returning();
    if (updatedRoom.length === 0) {
      c.status(404);
      return c.json({ error: "Meeting not found" });
    }
    await tx
      .delete(participants)
      .where(eq(participants.room_id, roomId));
    return updatedRoom;
  })
  c.status(200);
  return c.json(result);
});
export default roomsAPI;