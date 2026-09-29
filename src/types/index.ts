/**
 * @file index.ts
 * @description Core TypeScript type definitions for JWT authentication payloads,
 * Hono application context variables, and response metadata.
 */

export type Role = "admin" | "user";

/**
 * JWT payload structure signed into access tokens.
 * Includes sessionId to enable real-time session checking against SQLite.
 */
export interface JwtPayload {
  userId: string;
  sessionId: string;
  email: string;
  role: Role;
  exp: number;
}

/**
 * Strongly typed context variables accessible via `c.get()` and `c.set()`.
 */
export type AppVariables = {
  user: JwtPayload;
  requestId: string;
  startTime: number;
};

/**
 * Custom Hono environment type binding AppVariables into Hono handlers and middleware.
 */
export type AppEnv = {
  Variables: AppVariables;
};

/**
 * Standardized pagination metadata returned in list endpoints.
 */
export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

/**
 * Standardized metadata envelope attached to API responses for observability and telemetry.
 */
export interface ResponseMeta {
  requestId: string;
  timestamp: string;
  durationMs: number;
  apiVersion?: string;
}
