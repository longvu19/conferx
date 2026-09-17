import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { HTTPException } from "hono/http-exception";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { env } from "./lib/env.ts";

const app = new Hono();
app.use(logger());
app.use(cors({ origin: env.corsOrigin.split(","), credentials: true }));

app.get("/health", (c) => c.json({ status: "ok" }));

// File-based routing: src/api/<version>/<resource>.ts -> /api/<version>/<resource>
const apiDir = join(import.meta.dir, "api");
for (const version of readdirSync(apiDir)) {
  const versionPath = join(apiDir, version);
  const files = readdirSync(versionPath, { withFileTypes: true }).filter((f) => f.isFile() && f.name.endsWith(".ts"));
  for (const file of files) {
    const router = (await import(join(versionPath, file.name))).default;
    app.route(`/api/${version}/${file.name.replace(/\.ts$/, "")}`, router);
  }
}

app.notFound((c) => c.json({ error: "Not found" }, 404));
app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
  console.error(err);
  return c.json({ error: "Internal server error" }, 500);
});

console.log(`room-service listening on :${env.port}`);
export default { port: env.port, fetch: app.fetch };
