/**
 * @file response.ts
 * @description Standard API response helpers following JSON envelope best practices.
 * Automatically injects telemetry metadata (requestId, ISO timestamp, processing duration in ms, and apiVersion).
 */

import type { Context } from "hono";
import type { AppEnv, PaginationMeta, ResponseMeta } from "../types/index.js";

/**
 * Builds standard telemetry metadata for an HTTP response based on context variables.
 */
export function buildMeta(c: Context<AppEnv>): ResponseMeta {
  const startTime = c.get("startTime") || performance.now();
  const durationMs = Number((performance.now() - startTime).toFixed(2));
  const requestId = c.get("requestId") || "unknown";

  return {
    requestId,
    timestamp: new Date().toISOString(),
    durationMs,
    apiVersion: "1.1.0",
  };
}

/**
 * Helper to return a standardized success JSON response with data and telemetry metadata.
 */
export function successResponse<T>(
  c: Context<AppEnv>,
  data: T,
  options?: {
    message?: string;
    pagination?: PaginationMeta;
    status?: 200 | 201;
  },
) {
  const status = options?.status || 200;
  return c.json(
    {
      success: true,
      message: options?.message,
      data,
      pagination: options?.pagination,
      meta: buildMeta(c),
    },
    status,
  );
}

/**
 * Helper to return a standardized error JSON response with telemetry metadata.
 */
export function errorResponse(
  c: Context<AppEnv>,
  message: string,
  status: 400 | 401 | 403 | 404 | 409 | 413 | 422 | 429 | 500 = 400,
  details?: unknown,
) {
  return c.json(
    {
      success: false,
      message,
      details,
      meta: buildMeta(c),
    },
    status,
  );
}
