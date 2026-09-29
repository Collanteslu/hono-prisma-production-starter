/**
 * @file index.ts
 * @description Core TypeScript type definitions and interfaces for domain models,
 * JWT authentication payloads, Hono application context variables, and pagination metadata.
 */

/**
 * User domain entity model representing application accounts.
 */
export interface User {
  id: string;
  name: string;
  email: string;
  password: string;
  role: string;
  isBlocked: boolean;
  blockedReason?: string | null;
  createdAt: string;
}

/**
 * Session domain entity representing active login sessions persisted in SQLite.
 * Used for stateful session validation and real-time revocation.
 */
export interface Session {
  id: string;
  userId: string;
  userAgent?: string | null;
  ipAddress?: string | null;
  isActive: boolean;
  expiresAt: string;
  createdAt: string;
}

/**
 * Task domain entity model representing items associated with a specific User.
 */
export interface Task {
  id: string;
  userId: string;
  title: string;
  description: string;
  completed: boolean;
  createdAt: string;
}

/**
 * JWT payload structure signed into access and refresh tokens.
 * Includes sessionId to enable real-time session checking against SQLite.
 */
export interface JwtPayload {
  userId: string;
  sessionId: string;
  email: string;
  role: "admin" | "user";
  exp: number;
}

/**
 * Strongly typed context variables accessible via `c.get()` and `c.set()`.
 */
export type AppVariables = {
  user: JwtPayload;
  requestId: string;
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
