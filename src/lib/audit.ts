/**
 * @file audit.ts
 * @description Audit logging helper for recording system actions and traceability.
 */

import type { Context } from "hono";
import { prisma } from "../db.js";
import { getClientIp } from "./clientIp.js";
import { logger } from "./logger.js";

export interface LogAuditOptions {
  userId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  details?: Record<string, unknown> | string;
}

/**
 * Records an audit log entry in the database.
 * Does not throw errors to prevent interrupting user transactions.
 */
export async function recordAudit(c: Context, options: LogAuditOptions): Promise<void> {
  try {
    const ipAddress = getClientIp(c) ?? null;

    const userAgent = c.req.header("user-agent") || null;
    const details =
      typeof options.details === "object"
        ? JSON.stringify(options.details)
        : options.details || null;

    await prisma.auditLog.create({
      data: {
        userId: options.userId ?? null,
        action: options.action,
        entity: options.entity,
        entityId: options.entityId ?? null,
        details,
        ipAddress,
        userAgent,
      },
    });
  } catch (error) {
    logger.error({ err: error }, "Failed to persist audit log entry");
  }
}

/**
 * Parses a stored audit `details` value, which may be a JSON document or a plain string.
 */
export function parseAuditDetails(details: string | null): unknown {
  if (!details) return null;
  try {
    return JSON.parse(details);
  } catch {
    return details;
  }
}
