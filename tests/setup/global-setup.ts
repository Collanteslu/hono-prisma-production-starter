import { execSync } from "node:child_process";
import { rmSync } from "node:fs";

/**
 * Applies all Prisma migrations to the throwaway test database before the suite runs,
 * and deletes the database file afterwards.
 */
export default function setup() {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl) throw new Error("TEST_DATABASE_URL was not set by vitest.config.ts");

  execSync("npx prisma migrate deploy", {
    stdio: "ignore",
    env: { ...process.env, DATABASE_URL: databaseUrl, TURSO_DATABASE_URL: "" },
  });

  return () => {
    const file = databaseUrl.replace(/^file:/, "");
    for (const suffix of ["", "-journal", "-wal", "-shm"]) {
      rmSync(`${file}${suffix}`, { force: true });
    }
  };
}
