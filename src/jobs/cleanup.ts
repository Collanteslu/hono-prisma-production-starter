/**
 * @file cleanup.ts
 * @description Background garbage collection task that purges expired sessions and orphaned refresh tokens.
 * Keeps the SQLite database performant and prevents storage bloat.
 */

import { prisma } from "../db.js";

/**
 * Executes a cleanup cycle deleting expired sessions and tokens.
 * @returns Counts of purged database rows
 */
export async function cleanupExpiredSessions(): Promise<{
  deletedSessions: number;
  deletedTokens: number;
}> {
  try {
    const now = new Date();

    const [sessionsRes, tokensRes] = await Promise.all([
      // 1. Purge sessions that are either naturally expired or marked inactive for >24 hours
      prisma.session.deleteMany({
        where: {
          OR: [
            { expiresAt: { lt: now } },
            {
              isActive: false,
              updatedAt: { lt: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
            },
          ],
        },
      }),
      // 2. Purge expired refresh tokens
      prisma.refreshToken.deleteMany({
        where: {
          expiresAt: { lt: now },
        },
      }),
    ]);

    if (sessionsRes.count > 0 || tokensRes.count > 0) {
      console.log(
        `🧹 [Cleanup Routine] Purged ${sessionsRes.count} expired session(s) and ${tokensRes.count} token(s).`,
      );
    }

    return {
      deletedSessions: sessionsRes.count,
      deletedTokens: tokensRes.count,
    };
  } catch (error) {
    console.error("❌ Error during session cleanup routine:", error);
    return { deletedSessions: 0, deletedTokens: 0 };
  }
}

/**
 * Schedules periodic execution of the cleanup routine.
 * @param intervalMs Time between cycles in milliseconds (default: 1 hour)
 */
export function startCleanupJob(intervalMs: number = 60 * 60 * 1000): NodeJS.Timeout {
  // Run an initial non-blocking cycle on startup
  cleanupExpiredSessions();

  // Schedule recurring timer
  const timer = setInterval(() => {
    cleanupExpiredSessions();
  }, intervalMs);

  // Unref timer so it does not keep the Node process alive during shutdown
  timer.unref();

  return timer;
}
