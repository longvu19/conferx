CREATE TYPE "public"."participants_role" AS ENUM('admin', 'member');--> statement-breakpoint
CREATE TYPE "public"."participants_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."rooms_status" AS ENUM('open', 'private', 'closed');--> statement-breakpoint
CREATE TABLE "participants" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(64) NOT NULL,
	"room_id" varchar(32) NOT NULL,
	"name" varchar(64) NOT NULL,
	"role" "participants_role" DEFAULT 'member' NOT NULL,
	"status" "participants_status" DEFAULT 'pending' NOT NULL,
	"updated_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rooms" (
	"id" serial PRIMARY KEY NOT NULL,
	"room_id" varchar(32) NOT NULL,
	"admin_id" varchar(64) NOT NULL,
	"admin_password" varchar(255) NOT NULL,
	"room_password" varchar(32) NOT NULL,
	"status" "rooms_status" DEFAULT 'private' NOT NULL,
	"updated_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "rooms_room_id_unique" UNIQUE("room_id")
);
--> statement-breakpoint
ALTER TABLE "participants" ADD CONSTRAINT "participants_room_id_rooms_room_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("room_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "participants_room_user_idx" ON "participants" USING btree ("room_id","user_id");