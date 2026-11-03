import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
let db: ReturnType<typeof drizzle<typeof schema>> | undefined;
export function getDatabase(url: string) {
  if (!db) db = drizzle(postgres(url, { max: 5, prepare: false }), { schema });
  return db;
}
