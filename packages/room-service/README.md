# room-service

Bun + Hono + Drizzle (Postgres) service managing meetings, participants and LiveKit media tokens.

```bash
bun install
cp ../../config/.env.example .env   # set DB_* / JWT_* / LIVEKIT_* for local runs
bun run db:migrate
bun run dev
```

Schema changes: edit `src/db/schema.ts`, then `bun run db:generate` and commit the new migration.

## API (`/api/v1/rooms`)

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/` | – | Create meeting → `room_id`, `room_password`, admin `token` |
| GET | `/:roomId` | – | Public info (status, participant count) |
| POST | `/:roomId/join` | – | Join with room password (member) or admin password (admin) |
| POST | `/:roomId/refresh-token` | cookie | New access token |
| GET | `/:roomId/me` | Bearer | Own status (admin also gets `room_password`) |
| GET | `/:roomId/participants` | Bearer | List (admin sees waiting list) |
| PATCH | `/:roomId/participants/:userId` | admin | `{status: approved\|rejected}` |
| DELETE | `/:roomId/participants/:userId` | self/admin | Leave or remove |
| PATCH | `/:roomId` | admin | `{status: open\|private}` |
| POST | `/:roomId/end` | admin | End meeting for everyone |
| POST | `/:roomId/media-token` | approved | LiveKit token + URL |
