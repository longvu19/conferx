import { pgTable, pgEnum, serial, varchar, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// open    = anyone with the room password joins immediately
// private = joiners wait for admin approval
// closed  = meeting ended
export const roomsStatusEnum = pgEnum("rooms_status", ["open", "private", "closed"]);
export const participantsStatusEnum = pgEnum("participants_status", ["pending", "approved", "rejected"]);
export const participantsRoleEnum = pgEnum("participants_role", ["admin", "member"]);

const timestamps = {
  updated_at: timestamp(),
  created_at: timestamp().defaultNow().notNull(),
};

export const rooms = pgTable("rooms", {
  id: serial("id").primaryKey(),
  room_id: varchar({ length: 32 }).notNull().unique(),
  admin_id: varchar({ length: 64 }).notNull(),
  admin_password: varchar({ length: 255 }).notNull(),
  room_password: varchar({ length: 32 }).notNull(),
  status: roomsStatusEnum().notNull().default("private"),
  ...timestamps,
});

export const participants = pgTable(
  "participants",
  {
    id: serial("id").primaryKey(),
    user_id: varchar({ length: 64 }).notNull(),
    room_id: varchar({ length: 32 })
      .notNull()
      .references(() => rooms.room_id, { onDelete: "cascade" }),
    name: varchar({ length: 64 }).notNull(),
    role: participantsRoleEnum().notNull().default("member"),
    status: participantsStatusEnum().notNull().default("pending"),
    ...timestamps,
  },
  (t) => [uniqueIndex("participants_room_user_idx").on(t.room_id, t.user_id)],
);

export const roomsRelations = relations(rooms, ({ many }) => ({
  participants: many(participants),
}));

export const participantsRelations = relations(participants, ({ one }) => ({
  room: one(rooms, {
    fields: [participants.room_id],
    references: [rooms.room_id],
  }),
}));

export type RoomStatus = (typeof roomsStatusEnum.enumValues)[number];
export type Room = typeof rooms.$inferSelect;
export type NewRoom = typeof rooms.$inferInsert;
export type Participant = typeof participants.$inferSelect;
