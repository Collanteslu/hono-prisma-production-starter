/**
 * @file requestId.ts
 * @description Request tracing and correlation middleware.
 * Assigns or propagates a unique UUID v4 identifier across headers for log tracing and observability.
 */

import { randomUUID } from "node:crypto";
import type { Context, Next } from "hono";
import type { AppEnv } from "../types/index.js";

export async function requestIdMiddleware(c: Context<AppEnv>, next: Next) {
  const start = performance.now();
  c.set("startTime", start);

  // Use incoming request ID from upstream load balancers or generate a fresh UUID v4
  const incomingId = c.req.header("X-Request-Id");
  const reqId = incomingId || randomUUID();

  // Store in context for application access and echo in response headers
  c.set("requestId", reqId);
  c.header("X-Request-Id", reqId);

  await next();

  // Calculate elapsed server duration and inject standard timing headers
  const elapsedMs = (performance.now() - start).toFixed(2);
  c.header("X-Response-Time", `${elapsedMs}ms`);
  c.header("Server-Timing", `total;dur=${elapsedMs}`);
}
