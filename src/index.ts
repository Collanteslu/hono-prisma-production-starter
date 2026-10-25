/**
 * @file index.ts
 * @description Process entry point (`npm start`, `npm run dev`, `node dist/index.js`).
 * Verifies the migration history, seeds the database, starts the cleanup job, binds the HTTP
 * listener and shuts everything down gracefully on SIGINT/SIGTERM.
 *
 * The Hono application itself lives in `app.ts`. This module deliberately has NO `default`
 * export: Bun serves an entry module's default export when it has a `fetch` method, which would
 * start a second listener next to the `serve()` call below (EADDRINUSE).
 */

import { serve } from "@hono/node-server";
import { app } from "./app.js";
import { env, features } from "./config/env.js";
import { applySqlitePragmas, prisma, seedDatabase } from "./db.js";
import { startCleanupJob } from "./jobs/cleanup.js";
import { logger as appLogger } from "./lib/logger.js";
import { assertMigrationsUpToDate } from "./lib/migrations.js";

// Type-safe RPC client type (hc<AppType>), kept importable from the entry point
export type { AppType } from "./app.js";

// WAL for local SQLite files before any concurrent traffic starts
await applySqlitePragmas();
// Configuration traps that would otherwise only surface as an incident: both are warnings, not
// startup failures, because existing deployments must keep booting after an upgrade.
if (features.accountSecurity && !env.MFA_ENCRYPTION_KEY) {
  appLogger.warn(
    "MFA_ENCRYPTION_KEY is unset, so TOTP secrets are encrypted with a key derived from JWT_SECRET: rotating JWT_SECRET makes every enrolled authenticator undecryptable and its 2FA login fails. Set a dedicated, stable MFA_ENCRYPTION_KEY.",
  );
}
if (env.NODE_ENV === "production" && env.MAIL_TRANSPORT === "log") {
  appLogger.warn(
    "MAIL_TRANSPORT=log in production writes every password-reset and verification link (a live credential) into the log stream. Use MAIL_TRANSPORT=smtp.",
  );
}
// Fail fast before touching data: an out-of-date database would otherwise surface later as
// random "no such table" errors in requests or background jobs
try {
  await assertMigrationsUpToDate();
} catch (err) {
  appLogger.fatal(
    { err },
    "❌ Database migration history does not match prisma/migrations. Resolve it before starting the server.",
  );
  process.exit(1);
}

await seedDatabase();

// Start recurring cleanup job to purge expired sessions every hour
const cleanupTimer = startCleanupJob(60 * 60 * 1000);

appLogger.info(`🚀 Hono server listening on http://localhost:${env.PORT}`);
appLogger.info(`📖 Interactive API documentation available at: http://localhost:${env.PORT}/docs`);

const server = serve({
  fetch: app.fetch,
  port: env.PORT,
});

/**
 * -------------------------------------------------------------
 * Graceful Process Shutdown
 * -------------------------------------------------------------
 * Intercepts OS signals (SIGINT, SIGTERM) to:
 * 1. Stop the recurring cleanup job so it cannot start a query against a closing client.
 * 2. Reject incoming requests.
 * 3. Allow in-flight requests to complete execution.
 * 4. Safely disconnect Prisma and close SQLite connection without data corruption.
 */
let isShuttingDown = false;

const gracefulShutdown = async (signal: string) => {
  if (isShuttingDown) return;
  isShuttingDown = true;

  appLogger.info(`\n🛑 Received ${signal}. Initiating graceful shutdown...`);

  clearInterval(cleanupTimer);

  try {
    server.close(async () => {
      appLogger.info("✔ HTTP listener closed.");
      try {
        await prisma.$disconnect();
        appLogger.info("✔ SQLite connection safely closed.");
        process.exit(0);
      } catch (dbErr) {
        appLogger.error({ err: dbErr }, "❌ Error during database disconnect");
        process.exit(1);
      }
    });

    // Forced exit timeout fallback after 10 seconds
    setTimeout(() => {
      appLogger.error("⚠️ Forcefully terminating after shutdown timeout limit.");
      process.exit(1);
    }, 10000).unref();
  } catch (err) {
    appLogger.error({ err }, "❌ Error during server shutdown");
    process.exit(1);
  }
};

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
