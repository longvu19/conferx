import { pgTable, uuid, varchar, timestamp, index } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid().primaryKey().defaultRandom(),
  email: varchar({ length: 254 }).notNull().unique(), // stored lower-cased
  password_hash: varchar({ length: 255 }).notNull(),
  display_name: varchar({ length: 64 }).notNull(),
  updated_at: timestamp(),
  created_at: timestamp().defaultNow().notNull(),
});

// One row per signed-in device. The refresh token secret is stored as a SHA-256 hash
// and rotated on every refresh, so a leaked database cannot be used to sign in.
export const sessions = pgTable(
  "sessions",
  {
    id: uuid().primaryKey().defaultRandom(),
    user_id: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token_hash: varchar({ length: 64 }).notNull(),
    // Previous hash, accepted briefly after rotation so two tabs refreshing at once
    // are not mistaken for token theft.
    prev_token_hash: varchar({ length: 64 }),
    rotated_at: timestamp(),
    user_agent: varchar({ length: 255 }),
    expires_at: timestamp().notNull(),
    revoked_at: timestamp(),
    last_used_at: timestamp().defaultNow().notNull(),
    created_at: timestamp().defaultNow().notNull(),
  },
  (t) => [index("sessions_user_idx").on(t.user_id)],
);

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
