/**
 * @file index.ts
 * @description Main application entry point for the Hono REST API.
 * Configures global middleware (tracing, security headers, logging, CORS), OpenAPI scalar documentation,
 * routes mounting, error handling, background session cleanup, and graceful process shutdown.
 */

import { serve } from "@hono/node-server";
import { apiReference } from "@scalar/hono-api-reference";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { prettyJSON } from "hono/pretty-json";
import { secureHeaders } from "hono/secure-headers";

// Environment configuration and database client
import { env } from "./config/env.js";
import { prisma, seedDatabase } from "./db.js";
import { openApiSpec } from "./docs/openapi.js";
import { startCleanupJob } from "./jobs/cleanup.js";
import { logger as appLogger } from "./lib/logger.js";
// Middlewares
import { authMiddleware } from "./middleware/auth.js";
import { requestIdMiddleware } from "./middleware/requestId.js";
// Route modules
import { authRoutes } from "./routes/auth.js";
import { sessionRoutes } from "./routes/sessions.js";
import { taskRoutes } from "./routes/tasks.js";
import { userRoutes } from "./routes/users.js";
import type { AppEnv } from "./types/index.js";

/**
 * Initialize main Hono application instance bound with AppEnv types
 */
const app = new Hono<AppEnv>();

/**
 * -------------------------------------------------------------
 * Global Middlewares (Security & Observability)
 * -------------------------------------------------------------
 */
// 1. Request tracing: Generates or forwards X-Request-Id (UUID v4)
app.use("*", requestIdMiddleware);

// 2. HTTP Security: Injects HSTS, XSS Protection, CSP, No-Sniff, and Frameguard headers
app.use("*", secureHeaders());

// 3. HTTP access logger with response time calculation
app.use("*", logger());

// 4. Cross-Origin Resource Sharing (CORS) configuration
app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-Request-Id"],
  }),
);

// 5. Formatted readable JSON output
app.use("*", prettyJSON());

/**
 * -------------------------------------------------------------
 * Interactive OpenAPI Documentation (Scalar) & Healthcheck
 * -------------------------------------------------------------
 */
// Raw OpenAPI 3.0 specification endpoint
app.get("/openapi.json", (c) => c.json(openApiSpec));

// Interactive web console at /docs powered by Scalar
app.get(
  "/docs",
  apiReference({
    pageTitle: "API Reference | Hono + Prisma",
    spec: {
      url: "/openapi.json",
    },
  }),
);

// Deep Healthcheck endpoint verifying process uptime and SQLite latency
app.get("/healthz", async (c) => {
  try {
    const startTime = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    const dbLatencyMs = Date.now() - startTime;

    return c.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      database: {
        status: "connected",
        latencyMs: dbLatencyMs,
      },
    });
  } catch (error) {
    return c.json(
      {
        status: "unhealthy",
        timestamp: new Date().toISOString(),
        database: {
          status: "disconnected",
          error: error instanceof Error ? error.message : "Database connection error",
        },
      },
      503,
    );
  }
});

// Root welcome and overview endpoint
app.get("/", (c) => {
  return c.json({
    status: "online",
    name: "Production REST API Template with Hono, Prisma 7, SQLite & Stateful Sessions",
    version: "1.2.0",
    documentationUrl: "/docs",
    endpoints: {
      healthcheck: "/healthz",
      documentation: "/docs",
      auth: {
        login: "POST /api/auth/login",
        refresh: "POST /api/auth/refresh",
        logout: "POST /api/auth/logout",
      },
      sessions: {
        mySessions: "GET /api/sessions/me",
        revokeSession: "DELETE /api/sessions/:sessionId",
        revokeAll: "POST /api/sessions/revoke-all",
      },
      users: {
        crud: "GET, POST, PUT, DELETE /api/users",
        blockUser: "PATCH /api/users/:id/block",
        revokeAllUserSessions: "POST /api/users/:id/revoke-sessions",
      },
      tasks: "GET, POST, PUT, DELETE /api/tasks",
    },
  });
});

/**
 * -------------------------------------------------------------
 * Route Module Mounting
 * -------------------------------------------------------------
 */
// Public authentication routes
app.route("/api/auth", authRoutes);

// Protected routes guarded by JWT and stateful session middleware
app.use("/api/sessions/*", authMiddleware);
app.use("/api/users/*", authMiddleware);
app.use("/api/tasks/*", authMiddleware);

app.route("/api/sessions", sessionRoutes);
app.route("/api/users", userRoutes);
app.route("/api/tasks", taskRoutes);

/**
 * -------------------------------------------------------------
 * Error and 404 Handlers
 * -------------------------------------------------------------
 */
app.notFound((c) => {
  return c.json(
    {
      success: false,
      message: `Route not found: ${c.req.method} ${c.req.url}`,
      requestId: c.get("requestId"),
    },
    404,
  );
});

app.onError((err, c) => {
  console.error(`[Error] RequestId: ${c.get("requestId")}:`, err);
  return c.json(
    {
      success: false,
      message: "Internal server error.",
      requestId: c.get("requestId"),
      error: env.NODE_ENV === "development" ? err.message : undefined,
    },
    500,
  );
});

/**
 * -------------------------------------------------------------
 * Server Initialization and Background Jobs
 * -------------------------------------------------------------
 * When executed directly (development, production), seed database, start cleanup job,
 * and bind HTTP listener. In test environments (Vitest), the exported app is tested directly.
 */
await seedDatabase();

let server: ReturnType<typeof serve> | undefined;

if (process.env.NODE_ENV !== "test") {
  // Start recurring cleanup job to purge expired sessions every hour
  startCleanupJob(60 * 60 * 1000);

  appLogger.info(`🚀 Hono server listening on http://localhost:${env.PORT}`);
  appLogger.info(
    `📖 Interactive API documentation available at: http://localhost:${env.PORT}/docs`,
  );

  server = serve({
    fetch: app.fetch,
    port: env.PORT,
  });

  /**
   * -------------------------------------------------------------
   * Graceful Process Shutdown
   * -------------------------------------------------------------
   * Intercepts OS signals (SIGINT, SIGTERM) to:
   * 1. Reject incoming requests.
   * 2. Allow in-flight requests to complete execution.
   * 3. Safely disconnect Prisma and close SQLite connection without data corruption.
   */
  let isShuttingDown = false;

  const gracefulShutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    appLogger.info(`\n🛑 Received ${signal}. Initiating graceful shutdown...`);

    try {
      server?.close(async () => {
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
}

export default app;
