# auth-service

Bun + Hono + Drizzle (Postgres) service for ConferX user accounts.

- Passwords hashed with argon2id (`Bun.password`)
- Access token: HS256 JWT, 15 min, shared secret `USER_JWT_SECRET` (room-service verifies it)
- Refresh token: opaque, HttpOnly cookie, stored as SHA-256 hash, rotated on every use; reusing an old token revokes the session (a 60 s grace returns 409 "retry" for concurrent refreshes from several tabs)

```bash
bun install
bun run db:migrate   # needs DB_* and USER_JWT_SECRET
bun run dev
```

## API (`/api/v1/auth`)

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/register` | – | `{email, password, display_name}` → `{user, token}` + refresh cookie |
| POST | `/login` | – | `{email, password}` → `{user, token}` + refresh cookie |
| POST | `/refresh` | cookie | Rotate refresh token → `{user, token}` |
| POST | `/logout` | cookie | Revoke this device session |
| GET | `/me` | Bearer | Current user |
| PATCH | `/me` | Bearer | `{display_name}` → `{user, token}` |
| POST | `/me/password` | Bearer | `{current_password, new_password}`; signs out other devices |
