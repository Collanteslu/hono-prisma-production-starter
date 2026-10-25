/**
 * @file app.ts
 * @description The Hono application: global middleware (tracing, security headers, logging, CORS),
 * OpenAPI/Scalar documentation, route mounting and error handling.
 *
 * Importing this module has no side effects beyond building the app: it binds no port and starts
 * no job. The process entry point is `index.ts`. They are separate files because Bun serves the
 * `default` export of its entry module on its own (`export default` with a `fetch` method), which
 * collided with the `serve()` call of `@hono/node-server` (EADDRINUSE). Tests import this module.
 */

import { createRoute } from "@hono/zod-openapi";
import { apiReference } from "@scalar/hono-api-reference";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";
import { prettyJSON } from "hono/pretty-json";
import { secureHeaders } from "hono/secure-headers";

// Environment configuration and database client
import { env, features } from "./config/env.js";
import { prisma, seedDatabase } from "./db.js";
import { Prisma } from "./generated/client/client.js";
import { logger as appLogger } from "./lib/logger.js";
import { createRouter, jsonResponse, whenEnabled } from "./lib/openapi.js";
import { buildMeta, errorResponse } from "./lib/response.js";
import { API_VERSION } from "./lib/version.js";
// Middlewares
import { authMiddleware } from "./middleware/auth.js";
import { requestIdMiddleware } from "./middleware/requestId.js";
import { auditRoutes } from "./routes/audit.js";
// Route modules
import { authRoutes } from "./routes/auth.js";
import { mfaRoutes, userMfaRoutes } from "./routes/mfa.js";
import { recoveryRoutes } from "./routes/recovery.js";
import { sessionRoutes } from "./routes/sessions.js";
import { taskRoutes } from "./routes/tasks.js";
import { userRoutes } from "./routes/users.js";
import { healthResponseSchema } from "./schemas/responses.js";

/**
 * Initialize main Hono application instance bound with AppEnv types
 */
const app = createRouter();

// Bearer JWT scheme referenced by every protected route (`security: [{ BearerAuth: [] }]`).
// AUTH_MODE=none has no protected route, so the scheme is not published either.
if (features.auth) {
  app.openAPIRegistry.registerComponent("securitySchemes", "BearerAuth", {
    type: "http",
    scheme: "bearer",
    bearerFormat: "JWT",
    description: "Access Token JWT obtenido en POST /api/auth/login",
  });
}

/**
 * -------------------------------------------------------------
 * Global Middlewares (Security & Observability)
 * -------------------------------------------------------------
 */
// 1. Request tracing: Generates or forwards X-Request-Id (UUID v4)
app.use("*", requestIdMiddleware);

// 2. HTTP Security: Injects HSTS, XSS Protection, CSP, No-Sniff, and Frameguard headers
app.use("*", secureHeaders());

// 3. HTTP access logger with response time calculation (routed through the structured Pino logger).
// hono/logger colours the status code with ANSI escapes; they are noise in the JSON lines that
// log aggregators ingest in production (and break grep/jq on the message), so they are stripped.
const ANSI_ESCAPES = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
app.use(
  "*",
  logger((message, ...rest) => {
    const line = [message, ...rest].join(" ");
    appLogger.info(env.NODE_ENV === "production" ? line.replace(ANSI_ESCAPES, "") : line);
  }),
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
          success: false as const,
          message: "Payload Too Large: Request body exceeds the maximum permitted limit of 100 KB.",
          meta: buildMeta(c),
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
const docsEnabled = env.ENABLE_DOCS ?? env.NODE_ENV !== "production";
if (docsEnabled) {
  // OpenAPI 3.0 specification generated from the route definitions and Zod schemas
  app.doc("/openapi.json", {
    openapi: "3.0.3",
    info: {
      title: "Hono REST API - Gestión de Usuarios y Tareas",
      version: API_VERSION,
      description: features.auth
        ? `API REST con Hono, Prisma 7 (SQLite), TypeScript, Zod, autenticación JWT con refresh tokens rotativos, sesiones con estado y rate limiting (AUTH_MODE=${env.AUTH_MODE}).`
        : "API REST con Hono, Prisma 7 (SQLite), TypeScript y Zod, sin autenticación (AUTH_MODE=none): todas las rutas son públicas.",
    },
    servers: [
      {
        // In production the spec must not advertise localhost (Scalar "try it" would fail silently)
        url:
          env.NODE_ENV === "production"
            ? (env.APP_URL ?? `http://localhost:${env.PORT}`)
            : `http://localhost:${env.PORT}`,
        description: env.NODE_ENV === "production" ? "Production" : "Local development",
      },
    ],
    // Only the tags of the mounted modules
    tags: [
      ...(features.auth ? [{ name: "Auth" }] : []),
      ...(features.accountSecurity ? [{ name: "MFA" }] : []),
      ...(features.auth ? [{ name: "Sessions" }, { name: "Users" }] : []),
      { name: "Tasks" },
      ...(features.auth ? [{ name: "Audit" }] : []),
      { name: "System" },
    ],
  });

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
const healthRoute = createRoute({
  method: "get",
  path: "/healthz",
  tags: ["System"],
  summary: "Healthcheck",
  description: "Estado del proceso y latencia de la consulta a SQLite.",
  responses: {
    200: jsonResponse(healthResponseSchema, "Servicio saludable"),
    503: jsonResponse(healthResponseSchema, "Base de datos no disponible"),
  },
});

// The return value is kept on purpose: `hc<AppType>` only sees routes whose type flows into the
// chained expression below, and a discarded `app.openapi(...)` statement registers /healthz at
// runtime while leaving it out of the typed client.
const withHealth = app.openapi(healthRoute, async (c) => {
  try {
    const startTime = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    const dbLatencyMs = Date.now() - startTime;

    return c.json(
      {
        status: "healthy" as const,
        timestamp: new Date().toISOString(),
        uptimeSeconds: Math.floor(process.uptime()),
        database: {
          status: "connected" as const,
          latencyMs: dbLatencyMs,
        },
      },
      200,
    );
  } catch (error) {
    // Details are logged server-side only; the public endpoint must not leak internals
    appLogger.error({ err: error }, "Healthcheck database probe failed");
    return c.json(
      {
        status: "unhealthy" as const,
        timestamp: new Date().toISOString(),
        database: {
          status: "disconnected" as const,
        },
      },
      503,
    );
  }
});

// Root welcome and overview endpoint: lists only the endpoints mounted for the current AUTH_MODE
app.get("/", (c) => {
  return c.json({
    status: "online",
    name: "Production REST API Template with Hono, Prisma 7, SQLite & Stateful Sessions",
    version: API_VERSION,
    authMode: env.AUTH_MODE,
    // Only advertised when the docs are actually served (they are off in production by default)
    ...(docsEnabled && { documentationUrl: "/docs" }),
    endpoints: {
      healthcheck: "/healthz",
      ...(docsEnabled && { documentation: "/docs" }),
      ...(features.auth && {
        auth: {
          register: "POST /api/auth/register",
          login: "POST /api/auth/login",
          refresh: "POST /api/auth/refresh",
          logout: "POST /api/auth/logout",
          ...(features.accountSecurity && {
            forgotPassword: "POST /api/auth/forgot-password",
            resetPassword: "POST /api/auth/reset-password",
            verifyEmail: "POST /api/auth/verify-email",
            resendVerification: "POST /api/auth/resend-verification",
          }),
        },
      }),
      ...(features.accountSecurity && {
        mfa: {
          setup: "POST /api/auth/mfa/setup",
          enable: "POST /api/auth/mfa/enable",
          disable: "POST /api/auth/mfa/disable",
        },
      }),
      ...(features.auth && {
        sessions: {
          mySessions: "GET /api/sessions/me",
          revokeSession: "DELETE /api/sessions/:sessionId",
          revokeAll: "POST /api/sessions/revoke-all",
        },
        users: {
          crud: "GET, POST, PUT, DELETE /api/users",
          blockUser: "PATCH /api/users/:id/block",
          revokeAllUserSessions: "POST /api/users/:id/revoke-sessions",
          ...(features.accountSecurity && { resetUserMfa: "DELETE /api/users/:id/mfa" }),
        },
      }),
      tasks: "GET, POST, PUT, DELETE /api/tasks",
      restoreTask: "POST /api/tasks/:id/restore",
      ...(features.auth && { auditLogs: "GET /api/audit-logs" }),
    },
  });
});

/**
 * -------------------------------------------------------------
 * Route Module Mounting
 * -------------------------------------------------------------
 */
// Apply authentication middleware to protected route paths (both the exact prefix and its
// sub-paths). With AUTH_MODE=none nothing is protected: the remaining routes are public.
if (features.auth) {
  for (const prefix of ["/api/sessions", "/api/users", "/api/tasks", "/api/audit-logs"]) {
    app.use(prefix, authMiddleware);
    app.use(`${prefix}/*`, authMiddleware);
  }
}

// Route modules chained cleanly for Hono RPC. Modules disabled by AUTH_MODE are mounted as empty
// routers (see whenEnabled): their paths answer 404 and are absent from /openapi.json.
//   basic: auth, sessions, users, audit | full: basic + recovery/verification and MFA
const routes = withHealth
  .route("/api/auth", whenEnabled(features.auth, authRoutes))
  .route("/api/auth", whenEnabled(features.accountSecurity, recoveryRoutes))
  .route("/api/auth", whenEnabled(features.accountSecurity, mfaRoutes))
  .route("/api/sessions", whenEnabled(features.auth, sessionRoutes))
  .route("/api/users", whenEnabled(features.auth, userRoutes))
  .route("/api/users", whenEnabled(features.accountSecurity, userMfaRoutes))
  .route("/api/tasks", taskRoutes)
  .route("/api/audit-logs", whenEnabled(features.auth, auditRoutes));

/**
 * Export Type-Safe RPC Application Type for client consumption (hc<AppType>).
 * It always describes the full build (AUTH_MODE=full); routes of disabled modules answer 404.
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

// Vitest imports this module directly and needs the demo data. In every other environment the
// entry point (index.ts) seeds the database, but only after its startup checks have passed.
if (process.env.NODE_ENV === "test") {
  await seedDatabase();
}

export { app };
export default app;
