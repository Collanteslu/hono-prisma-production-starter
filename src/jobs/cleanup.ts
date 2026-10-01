/**
 * @file cleanup.ts
 * @description Background garbage collection task that purges expired sessions and stale refresh tokens.
 * Keeps the SQLite database performant and prevents storage bloat.
 */

import { env } from "../config/env.js";
import { prisma } from "../db.js";
import { logger } from "../lib/logger.js";
import { purgeExpiredBuckets } from "../lib/rateLimitStore.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Executes a cleanup cycle deleting expired sessions and tokens.
 * @returns Counts of purged database rows
 */
export async function cleanupExpiredSessions(): Promise<{
  deletedSessions: number;
  deletedTokens: number;
  deletedBuckets: number;
  deletedAuditLogs: number;
}> {
  try {
    const now = new Date();

    const [sessionsRes, tokensRes] = await prisma.$transaction([
      // 1. Purge sessions that are either naturally expired or marked inactive for >24 hours
      //    (refresh tokens of deleted sessions are removed by the ON DELETE CASCADE relation)
      prisma.session.deleteMany({
        where: {
          OR: [
            { expiresAt: { lt: now } },
            {
              isActive: false,
              updatedAt: { lt: new Date(now.getTime() - DAY_MS) },
            },
          ],
        },
      }),
      // 2. Purge expired tokens and tokens rotated more than 24 hours ago. A replay of a purged
      //    token is still detected as reuse because it no longer matches any stored hash.
      prisma.refreshToken.deleteMany({
        where: {
          OR: [{ expiresAt: { lt: now } }, { usedAt: { lt: new Date(now.getTime() - DAY_MS) } }],
        },
      }),
    ]);

    // 3. Purge ended rate-limit windows and audit entries past the retention period
    const deletedBuckets = await purgeExpiredBuckets();
    // Emailed tokens past their expiry (or used more than a day ago) are of no further use
    await prisma.authToken.deleteMany({
      where: {
        OR: [{ expiresAt: { lt: now } }, { usedAt: { lt: new Date(now.getTime() - DAY_MS) } }],
      },
    });
    const deletedAuditLogs =
      env.AUDIT_RETENTION_DAYS > 0
        ? (
            await prisma.auditLog.deleteMany({
              where: {
                createdAt: { lt: new Date(now.getTime() - env.AUDIT_RETENTION_DAYS * DAY_MS) },
              },
            })
          ).count
        : 0;

    if (sessionsRes.count > 0 || tokensRes.count > 0 || deletedAuditLogs > 0) {
      logger.info(
        {
          deletedSessions: sessionsRes.count,
          deletedTokens: tokensRes.count,
          deletedBuckets,
          deletedAuditLogs,
        },
        "🧹 Cleanup routine purged expired sessions, tokens and old audit entries",
      );
    }

    return {
      deletedSessions: sessionsRes.count,
      deletedTokens: tokensRes.count,
      deletedBuckets,
      deletedAuditLogs,
    };
  } catch (error) {
    logger.error({ err: error }, "❌ Error during session cleanup routine");
    return { deletedSessions: 0, deletedTokens: 0, deletedBuckets: 0, deletedAuditLogs: 0 };
  }
}

/**
 * Schedules periodic execution of the cleanup routine.
 * @param intervalMs Time between cycles in milliseconds (default: 1 hour)
 */
export function startCleanupJob(intervalMs: number = 60 * 60 * 1000): NodeJS.Timeout {
  // Run an initial non-blocking cycle on startup
  void cleanupExpiredSessions();

  // Schedule recurring timer
  const timer = setInterval(() => {
    void cleanupExpiredSessions();
  }, intervalMs);

  // Unref timer so it does not keep the Node process alive during shutdown
  timer.unref();

  return timer;
}
