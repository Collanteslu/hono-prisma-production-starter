/**
 * @file response.ts
 * @description Standard API response helpers following JSON envelope best practices.
 * Automatically injects telemetry metadata (requestId, ISO timestamp, processing duration in ms, and apiVersion).
 */

import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppEnv, PaginationMeta, ResponseMeta } from "../types/index.js";
import { API_VERSION } from "./version.js";

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
    apiVersion: API_VERSION,
  };
}

/**
 * Builds pagination metadata for list endpoints.
 */
export function buildPagination(total: number, page: number, limit: number): PaginationMeta {
  const totalPages = Math.ceil(total / limit) || 1;
  return {
    total,
    page,
    limit,
    totalPages,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
  };
}

/**
 * Helper to return a standardized success JSON response with data and telemetry metadata.
 */
export function successResponse<T, S extends 200 | 201 = 200>(
  c: Context<AppEnv>,
  data: T,
  options?: {
    message?: string;
    pagination?: PaginationMeta;
    status?: S;
  },
) {
  const status = (options?.status ?? 200) as S;
  return c.json(
    {
      success: true as const,
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
export function errorResponse<S extends ContentfulStatusCode = 400>(
  c: Context<AppEnv>,
  message: string,
  status: S = 400 as S,
  details?: unknown,
) {
  return c.json(
    {
      success: false as const,
      message,
      details,
      meta: buildMeta(c),
    },
    status,
  );
}
