import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { env } from "../lib/env.ts";

const db = drizzle({ connection: { url: env.dbUrl, max: 1 }, casing: "snake_case" });

try {
  await migrate(db, { migrationsFolder: `${import.meta.dir}/migrations` });
  console.log("Migrations completed successfully");
  process.exit(0);
} catch (error) {
  console.error("Error during migrations:", error);
  process.exit(1);
}
