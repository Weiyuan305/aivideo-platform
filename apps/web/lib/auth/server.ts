import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { getDatabase } from "@aivideo/db";
import * as schema from "@aivideo/db/schema";
function initializeAuth(databaseURL: string, secret: string, baseURL: string) {
  return betterAuth({
    database: drizzleAdapter(getDatabase(databaseURL), {
      provider: "pg",
      schema,
    }),
    secret,
    baseURL,
    emailAndPassword: { enabled: true },
    trustedOrigins: [baseURL],
  });
}
let auth: ReturnType<typeof initializeAuth> | null = null;
export function getAuth() {
  const { DATABASE_URL, BETTER_AUTH_SECRET, BETTER_AUTH_URL } = process.env;
  if (!DATABASE_URL || !BETTER_AUTH_SECRET || !BETTER_AUTH_URL) return null;
  if (BETTER_AUTH_SECRET.length < 32)
    throw new Error("BETTER_AUTH_SECRET 至少需要 32 字符");
  if (!auth)
    auth = initializeAuth(DATABASE_URL, BETTER_AUTH_SECRET, BETTER_AUTH_URL);
  return auth;
}
