#!/bin/sh
# Declarative gateway configuration. Idempotent: re-running overwrites the same IDs.
# Runs once as the `apisix-init` service after APISIX is up.
set -eu

ADMIN="${APISIX_ADMIN_URL:-http://apisix:9180}/apisix/admin"
KEY_HEADER="X-API-KEY: ${APISIX_ADMIN_KEY}"

put() {
  echo "PUT $1"
  curl -fsS -X PUT "$ADMIN/$1" -H "$KEY_HEADER" -H "Content-Type: application/json" -d "$2" > /dev/null
}

echo "Waiting for APISIX admin API..."
until curl -fsS "$ADMIN/routes" -H "$KEY_HEADER" > /dev/null 2>&1; do sleep 2; done

put upstreams/room-service '{
  "name": "room-service",
  "type": "roundrobin",
  "nodes": { "room-service:3002": 1 },
  "checks": { "active": { "http_path": "/health", "healthy": { "interval": 10 }, "unhealthy": { "interval": 5 } } }
}'

# Brute-force protection for password checks: 10 attempts / minute per IP.
put routes/rooms-join '{
  "name": "rooms-join",
  "uri": "/api/v1/rooms/*/join",
  "methods": ["POST"],
  "priority": 10,
  "upstream_id": "room-service",
  "plugins": {
    "limit-count": { "count": 10, "time_window": 60, "key_type": "var", "key": "remote_addr", "rejected_code": 429 }
  }
}'

put routes/rooms '{
  "name": "rooms",
  "uris": ["/api/v1/rooms", "/api/v1/rooms/*"],
  "upstream_id": "room-service",
  "plugins": {
    "limit-count": { "count": 300, "time_window": 60, "key_type": "var", "key": "remote_addr", "rejected_code": 429 }
  }
}'

put global_rules/1 '{ "plugins": { "request-id": {}, "prometheus": {} } }'

echo "APISIX routes configured."
