# ConferX

Online meetings with video, audio, chat and screen sharing.
Platforms: Web (Nuxt/Vue, repo `conferx-fe`), Desktop (Electron, planned).

## Architecture

```
Browser ──HTTP──▶ APISIX :9080 ──▶ room-service :3002 ──▶ Postgres
   │                                    │
   └──WebRTC (ws :7880, udp :7882)──▶ LiveKit SFU ◀── server API (tokens, kick, end)
```

| Component | Tech | Status |
|---|---|---|
| Gateway | APISIX 3 + etcd, routes in `config/apisix/init/routes.sh` | ✅ |
| room-service | Bun, Hono, Drizzle, Postgres | ✅ meetings, waiting room, admin controls, media tokens |
| Media | LiveKit SFU (video, audio, screen share, in-meeting chat via data channel) | ✅ |
| auth-service | Express | 🚧 skeleton (meetings use anonymous browser IDs) |
| Monitoring | Prometheus + Grafana (`--profile monitoring`) | ✅ optional |

## Run locally

```bash
cp config/.env.example config/.env      # edit the secrets
docker compose -f config/docker-compose.yml up -d --build
curl http://localhost:9080/api/v1/rooms/does-not-exist   # {"error":"Meeting not found"}
```

Then start the frontend (`conferx-fe`): `bun install && bun run dev` → http://localhost:3000

> Upgrading from the old stack: the database schema changed. Run
> `docker compose -f config/docker-compose.yml down -v` once to reset volumes.

## Production notes
- Serve everything over HTTPS; set `LIVEKIT_PUBLIC_URL=wss://…` and `LIVEKIT_NODE_IP` to the public IP.
- Open UDP 7882 and TCP 7881; enable LiveKit's embedded TURN for users behind strict firewalls.
- Rotate every secret in `config/.env`. Old secrets were previously committed to git history.
