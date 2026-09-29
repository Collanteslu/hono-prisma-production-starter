/**
 * @file requestId.ts
 * @description Request tracing and correlation middleware.
 * Assigns or propagates a unique UUID v4 identifier across headers for log tracing and observability.
 */

import { Context, Next } from 'hono';
import { randomUUID } from 'node:crypto';
import { AppEnv } from '../types/index.js';

export async function requestIdMiddleware(c: Context<AppEnv>, next: Next) {
  // Use incoming request ID from upstream load balancers or generate a fresh UUID v4
  const incomingId = c.req.header('X-Request-Id');
  const reqId = incomingId || randomUUID();

  // Store in context for application access and echo in response headers
  c.set('requestId', reqId);
  c.header('X-Request-Id', reqId);

  await next();
}
