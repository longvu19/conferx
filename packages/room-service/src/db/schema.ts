import { pgTable,pgEnum, serial, varchar, integer, timestamp } from 'drizzle-orm/pg-core'
import { drizzle } from 'drizzle-orm/postgres-js';
import { relations } from 'drizzle-orm';
const db = drizzle({ connection: process.env.DB_URL!, casing: 'snake_case' });
export const roomsStatusEnum = pgEnum('rooms_status', ['open','private', 'closed']);
const timestamps = {
  updated_at: timestamp(),
  created_at: timestamp().defaultNow().notNull(),
}
export type RoomsStatusEnumType = typeof roomsStatusEnum.enumValues[number];
export const RoomsStatusEnumValues = roomsStatusEnum.enumValues;

export const rooms = pgTable('rooms', {
  id: serial('id').primaryKey(),
  // name: varchar({ length: 255 }).notNull(),
  room_id: varchar({ length: 255 }).notNull().unique(),
  admin_password: varchar({ length: 255 }).notNull(),
  room_password: varchar({ length: 255 }).notNull(),
  // ownerId: integer().notNull(),
  status: roomsStatusEnum().notNull(),
  ...timestamps,
});

export const participants = pgTable('participants', {
  id: serial('id').primaryKey(),
  room_id: varchar({ length: 255 }).notNull().references(() => rooms.room_id),
  name: varchar({ length: 255 }).notNull(),
  ...timestamps,
});

// export const users = pgTable('users', {
//   id: serial('id').primaryKey(),
//   name: varchar({ length: 255 }).notNull(),
//   email: varchar({ length: 255 }).notNull(),
//   password: varchar({ length: 255 }).notNull(),
//   ...timestamps,
// });

export const roomsRelations = relations(rooms, ({ many }) => ({
  participants: many(participants)
}));

export const participantsRelations = relations(participants, ({ one }) => ({
  room: one(rooms, {
    fields: [participants.room_id],
    references: [rooms.id],
  }),
}));

export type Room = typeof rooms.$inferSelect;
export type NewRoom = typeof rooms.$inferInsert;
export type Participant = typeof participants.$inferSelect;
export type NewParticipant = typeof participants.$inferInsert;