import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { HTTPException } from "hono/http-exception";
import { env } from "./lib/env.ts";
import authAPI from "./api/v1/auth.ts";

const app = new Hono();
app.use(logger());
app.use(cors({ origin: env.corsOrigin.split(","), credentials: true }));

app.get("/health", (c) => c.json({ status: "ok" }));
app.route("/api/v1/auth", authAPI);

app.notFound((c) => c.json({ error: "Not found" }, 404));
app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
  console.error(err);
  return c.json({ error: "Internal server error" }, 500);
});

console.log(`auth-service listening on :${env.port}`);
export default { port: env.port, fetch: app.fetch };
