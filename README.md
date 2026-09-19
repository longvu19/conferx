# ConferX

Online meetings with video, audio, chat and screen sharing.
Platforms: Web (Nuxt/Vue, repo `conferx-fe`), Desktop (Electron, planned).

## Architecture

```
Browser ──HTTP──▶ APISIX :9080 ──▶ auth-service :3001 ──▶ Postgres (auth)
                          └──────▶ room-service :3002 ──▶ Postgres (rooms)
   │                                    │
   └──WebRTC (ws :7880, udp :7882)──▶ LiveKit SFU ◀── server API (tokens, kick, end)
```

| Component | Tech | Status |
|---|---|---|
| Gateway | APISIX 3 + etcd, routes in `config/apisix/init/routes.sh` | ✅ |
| room-service | Bun, Hono, Drizzle, Postgres | ✅ meetings, waiting room, admin controls, media tokens |
| Media | LiveKit SFU (video, audio, screen share, in-meeting chat via data channel) | ✅ |
| auth-service | Bun, Hono, Drizzle, Postgres | ✅ accounts, rotating refresh tokens (guests can still join without an account) |
| Monitoring | Prometheus + Grafana (`--profile monitoring`) | ✅ optional |

## Run locally

```bash
cp config/.env.example config/.env      # edit the secrets
docker compose -f config/docker-compose.yml up -d --build
curl http://localhost:9080/api/v1/rooms/does-not-exist   # {"error":"Meeting not found"}
```

Then start the frontend (`conferx-fe`): `bun install && bun run dev` → http://localhost:3000

> The `caddy` and `frontend` services exist for the deployed host and are dead
> weight locally — `caddy` will keep failing to get a certificate for the public
> domain. Start only what you need:
>
> ```bash
> docker compose -f config/docker-compose.yml up -d --build \
>   etcd apisix apisix-init rooms-db auth-db auth-service room-service livekit
> ```

> Upgrading from the old stack: the database schema changed. Run
> `docker compose -f config/docker-compose.yml down -v` once to reset volumes.

## Deploy

One host runs everything. Caddy is the only public entrypoint for HTTP and it
obtains and renews the TLS certificate on its own; LiveKit's media ports stay
open directly because WebRTC media is not HTTP and cannot be proxied.

```
                   :80/:443 ──▶ Caddy ──▶ frontend :3000 ──(SSR proxy)──▶ apisix :9080
Browser            :7880    ──▶ Caddy ──▶ livekit :7880        (wss signaling)
                   :7881/tcp, :7882/udp ──────▶ livekit        (media, no proxy)
```

`apisix` and `frontend` are no longer published to the host — reach them through
Caddy only.

### 1. Prerequisites

- A VM with a **public IP**. 2 vCPU / 12 GB RAM handles a single ~30-person
  room comfortably; bandwidth matters more than CPU (roughly 60–70 Mbps for one
  full room where only the host publishes video).
- A **domain** pointing at that IP. A free `*.duckdns.org` subdomain works —
  Let's Encrypt only cares that you control the name.
- **Both repos side by side** on the host, because `docker-compose.yml` builds
  the frontend from `../../conferx-fe`:

  ```
  ~/conferx-be/
  ~/conferx-fe/
  ```

### 2. Open the ports — in both places

Cloud firewalls and the host firewall are independent; missing either one looks
identical from outside (a silent timeout).

| Port | Why |
|---|---|
| 22/tcp | SSH |
| 80/tcp | ACME HTTP-01 challenge + redirect to HTTPS |
| 443/tcp | the app |
| 7880/tcp | LiveKit signaling (Caddy terminates TLS here) |
| 7881/tcp | WebRTC over TCP, for restrictive networks |
| 7882/udp | WebRTC media |

In the cloud console, add ingress rules for all of the above. On the host
(Oracle Linux / RHEL family):

```bash
for p in 80/tcp 443/tcp 7880/tcp 7881/tcp 7882/udp; do sudo firewall-cmd --permanent --add-port=$p; done
sudo firewall-cmd --reload
```

On OCI also check the subnet's **route table** has `0.0.0.0/0 → Internet
Gateway`. Without it the public IP is unreachable no matter what the security
list says.

### 3. Prepare the host

```bash
sudo dnf install -y podman python3-pip
sudo pip3 install podman-compose

# Resolve bare image names (oven/bun, postgres…) without an interactive prompt
echo 'unqualified-search-registries = ["docker.io"]' | sudo tee /etc/containers/registries.conf.d/docker.conf

# Keep rootless containers alive after you log out
sudo loginctl enable-linger "$USER"

# Let rootless Podman bind :80 and :443
echo 'net.ipv4.ip_unprivileged_port_start=80' | sudo tee /etc/sysctl.d/99-rootless-ports.conf
sudo sysctl --system
```

### 4. Configure

Point `config/Caddyfile` at your domain (it is checked in with
`conferx.duckdns.org`), then write `config/.env` with fresh secrets:

```bash
cd ~/conferx-be/config
cat > .env <<EOF
ROOMS_DB_PASSWORD='$(openssl rand -hex 24)'
AUTH_DB_PASSWORD='$(openssl rand -hex 24)'
JWT_SECRET=$(openssl rand -hex 32)
JWT_REFRESH_SECRET=$(openssl rand -hex 32)
USER_JWT_SECRET=$(openssl rand -hex 32)
APISIX_ADMIN_KEY=$(openssl rand -hex 16)
LIVEKIT_API_KEY=conferx
LIVEKIT_API_SECRET=$(openssl rand -hex 20)
LIVEKIT_PUBLIC_URL=wss://your-domain:7880
LIVEKIT_NODE_IP=<public IP>
CORS_ORIGIN=https://your-domain
COOKIE_SECURE=true
EOF
chmod 600 .env
```

`LIVEKIT_NODE_IP` is the public IP, not the domain — LiveKit hands it to
browsers as an ICE candidate. Never reuse the local dev secrets: older ones were
committed to git history.

### 5. Bring it up

```bash
cd ~/conferx-be/config
podman-compose -f docker-compose.yml up -d
podman ps                                   # apisix-init exits 0, everything else stays Up
podman logs conferx_caddy_1 | grep "certificate obtained"
```

Verify from **outside** the host — a container being `Up` does not mean it
serves:

```bash
curl -o /dev/null -w '%{http_code}\n' https://your-domain/                       # 200
curl -o /dev/null -w '%{http_code}\n' -X POST https://your-domain/api/v1/auth/login \
  -H 'Content-Type: application/json' -d '{}'                                    # 400, not 404
curl -o /dev/null -w '%{http_code}\n' https://your-domain:7880/                  # 200
```

A `404` on the auth route means the gateway never loaded its routes; re-run
`apisix-init`. `Connection refused` means the firewall is open but nothing is
listening; a timeout means a firewall layer is still closed.

### 6. Ship an update

```bash
rsync -a --exclude node_modules --exclude .nuxt --exclude .output \
  ./conferx-fe/ host:~/conferx-fe/
ssh host 'cd ~/conferx-be/config && \
  podman-compose -f docker-compose.yml build frontend && \
  podman-compose -f docker-compose.yml up -d --force-recreate frontend'
```

`--force-recreate` is not optional: `up -d` alone leaves the old container
running when only the image changed, so the deploy silently does nothing.

### Gotchas worth knowing before you hit them

| Symptom | Cause |
|---|---|
| `short-name resolution enforced but cannot prompt without a TTY` | Non-interactive shell can't pick a registry — set `unqualified-search-registries` (step 3) |
| `permission denied` reading a mounted config file | SELinux. Bind mounts need `:Z` — already set on the three config mounts in `docker-compose.yml` |
| Containers die minutes after you disconnect | Rootless Podman without lingering; `loginctl enable-linger` (step 3) |
| Caddy can't bind :80 | `net.ipv4.ip_unprivileged_port_start` still 1024 (step 3) |
| Everything times out, security list looks right | Missing `0.0.0.0/0 → Internet Gateway` route (step 2) |
| Rebuilt image, page unchanged | Missing `--force-recreate` (step 6) |
| Camera/mic blocked in the browser | WebRTC needs a secure context — the domain must be HTTPS, not the raw IP |

### Optional

- Enable LiveKit's embedded TURN (commented out in `config/livekit/livekit.yaml`)
  for users behind strict firewalls.
- `--profile monitoring` adds Prometheus + Grafana.
- Back up the Postgres volumes (`pg_dump` to object storage); they are the only
  state worth keeping.
