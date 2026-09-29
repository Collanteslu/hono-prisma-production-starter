/**
 * @file index.ts
 * @description Main application entry point for the Hono REST API.
 * Configures global middleware (tracing, security headers, logging, CORS), OpenAPI scalar documentation,
 * routes mounting, error handling, background session cleanup, and graceful process shutdown.
 */

import { serve } from "@hono/node-server";
import { apiReference } from "@scalar/hono-api-reference";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";
import { prettyJSON } from "hono/pretty-json";
import { secureHeaders } from "hono/secure-headers";

// Environment configuration and database client
import { env } from "./config/env.js";
import { prisma, seedDatabase } from "./db.js";
import { openApiSpec } from "./docs/openapi.js";
import { Prisma } from "./generated/client/client.js";
import { startCleanupJob } from "./jobs/cleanup.js";
import { logger as appLogger } from "./lib/logger.js";
import { errorResponse } from "./lib/response.js";
import { API_VERSION } from "./lib/version.js";
// Middlewares
import { authMiddleware } from "./middleware/auth.js";
import { requestIdMiddleware } from "./middleware/requestId.js";
import { auditRoutes } from "./routes/audit.js";
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

// 3. HTTP access logger with response time calculation (routed through the structured Pino logger)
app.use(
  "*",
  logger((message, ...rest) => appLogger.info([message, ...rest].join(" "))),
);

// 4. Cross-Origin Resource Sharing (CORS) configuration (origins configurable via CORS_ORIGINS)
app.use(
  "*",
  cors({
    origin: env.CORS_ORIGINS.includes("*") ? "*" : env.CORS_ORIGINS,
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-Request-Id"],
  }),
);

// 5. Formatted readable JSON output
app.use("*", prettyJSON());

// 6. Payload size limiter: Prevents Memory Exhaustion / DoS attacks (100 KB limit for REST payloads)
app.use(
  "*",
  bodyLimit({
    maxSize: 100 * 1024,
    onError: (c) =>
      c.json(
        {
          success: false,
          message: "Payload Too Large: Request body exceeds the maximum permitted limit of 100 KB.",
        },
        413,
      ),
  }),
);

/**
 * -------------------------------------------------------------
 * Interactive OpenAPI Documentation (Scalar) & Healthcheck
 * -------------------------------------------------------------
 */
// Documentation is enabled by default outside production (override with ENABLE_DOCS)
if (env.ENABLE_DOCS ?? env.NODE_ENV !== "production") {
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
}

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
    // Details are logged server-side only; the public endpoint must not leak internals
    appLogger.error({ err: error }, "Healthcheck database probe failed");
    return c.json(
      {
        status: "unhealthy",
        timestamp: new Date().toISOString(),
        database: {
          status: "disconnected",
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
    version: API_VERSION,
    documentationUrl: "/docs",
    endpoints: {
      healthcheck: "/healthz",
      documentation: "/docs",
      auth: {
        register: "POST /api/auth/register",
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
      restoreTask: "POST /api/tasks/:id/restore",
      auditLogs: "GET /api/audit-logs",
    },
  });
});

/**
 * -------------------------------------------------------------
 * Route Module Mounting
 * -------------------------------------------------------------
 */
// Apply authentication middleware to protected route paths
// Both the exact prefix and its sub-paths are protected
for (const prefix of ["/api/sessions", "/api/users", "/api/tasks", "/api/audit-logs"]) {
  app.use(prefix, authMiddleware);
  app.use(`${prefix}/*`, authMiddleware);
}

// Public authentication routes and protected resource modules chained cleanly for Hono RPC
const routes = app
  .route("/api/auth", authRoutes)
  .route("/api/sessions", sessionRoutes)
  .route("/api/users", userRoutes)
  .route("/api/tasks", taskRoutes)
  .route("/api/audit-logs", auditRoutes);

/**
 * Export Type-Safe RPC Application Type for client consumption (hc<AppType>)
 */
export type AppType = typeof routes;

/**
 * -------------------------------------------------------------
 * Error and 404 Handlers
 * -------------------------------------------------------------
 */
app.notFound((c) => {
  return errorResponse(c, `Route not found: ${c.req.method} ${c.req.path}`, 404);
});

app.onError((err, c) => {
  // Expected HTTP errors (malformed JSON, invalid filters, body limits, ...) keep their status code
  if (err instanceof HTTPException) {
    return errorResponse(c, err.message || "Request could not be processed.", err.status);
  }

  // Map known database constraint errors (e.g. races between existence checks and writes)
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      return errorResponse(c, "Conflict: A record with the same unique value already exists.", 409);
    }
    if (err.code === "P2025") {
      return errorResponse(c, "Resource not found.", 404);
    }
  }

  appLogger.error({ err, requestId: c.get("requestId") }, "Unhandled request error");
  return errorResponse(
    c,
    "Internal server error.",
    500,
    env.NODE_ENV === "development" ? err.message : undefined,
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
