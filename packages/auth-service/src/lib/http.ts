import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { z } from "zod";

/** Accepts JSON, urlencoded and multipart bodies, then validates with zod. */
export const readBody = async <T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> => {
  const contentType = c.req.header("content-type") ?? "";
  let raw: unknown = {};
  try {
    raw = contentType.includes("application/json") ? await c.req.json() : await c.req.parseBody();
  } catch {
    throw new HTTPException(400, { message: "Malformed request body" });
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new HTTPException(400, { message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
  }
  return parsed.data;
};
