import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { participants, rooms, RoomsStatusEnumValues } from "../../db/schema.ts";
import type { NewRoom, RoomsStatusEnumType } from "../../db/schema.ts";
const roomsAPI = new Hono();
const db = drizzle({ connection: process.env.DB_URL!, casing: "snake_case" });

roomsAPI.get("/", async (c) => {
  const roomsData = await db.select().from(rooms).leftJoin(participants,eq(rooms.room_id, participants.room_id));
  c.status(200);
  return c.json(roomsData);
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
    return c.json({ error: "Room not found" });
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
    }).returning();
    if (!insertedParticipant[0]) {
      tx.rollback();
      throw new Error("Failed to insert participant");
    }
    return insertedRoom
  });
  c.status(201);
  return c.json(result);
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
    // if (deletedParticipants.count === 0) {
    //   throw new Error("Failed to delete participants");
    // }
    const deletedRoom = await tx
      .delete(rooms)
      .where(eq(rooms.room_id, roomId));
    // if (deletedRoom.count === 0) {
    //   throw new Error("Failed to delete room");
    // }
    return deletedRoom;
  });
  c.status(204);
  return c.json(result);
});

roomsAPI.post("/join/:roomId", async (c) => {
  const roomId = c.req.param("roomId");
  const userInput = await c.req.parseBody();
  const result = await db.transaction(async (tx) => {
    const insertedParticipant = await tx.insert(participants).values({
      room_id: roomId,
      name: userInput.name as string,
    }).returning();
    if (!insertedParticipant[0]) {
      tx.rollback();
      throw new Error("Failed to insert participant");
    }
    return insertedParticipant;
  });
  c.status(201);
  return c.json(result);
});

export default roomsAPI;