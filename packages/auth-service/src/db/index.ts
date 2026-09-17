import { drizzle } from "drizzle-orm/postgres-js";
import { env } from "../lib/env.ts";
import * as schema from "./schema.ts";

export const db = drizzle({ connection: env.dbUrl, casing: "snake_case", schema });
