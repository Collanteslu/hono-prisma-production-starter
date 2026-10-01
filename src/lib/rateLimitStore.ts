/**
 * @file rateLimitStore.ts
 * @description Fixed-window counters kept in the database instead of process memory, so rate limits
 * and the login lockout hold across several API instances sharing one database (e.g. Turso).
 * Every operation is a single atomic statement (no read-modify-write in application code).
 */

import { prisma } from "../db.js";
import { Prisma } from "../generated/client/client.js";

export interface Bucket {
  count: number;
  resetAt: Date;
}

/**
 * Counts one hit against `key`, opening a new window of `windowMs` when none is active.
 * @returns The bucket after the hit
 */
export async function hitBucket(key: string, windowMs: number): Promise<Bucket> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const now = new Date();

    // Atomic increment of a live window
    const updated = await prisma.rateLimitBucket.updateMany({
      where: { key, resetAt: { gt: now } },
      data: { count: { increment: 1 } },
    });

    if (updated.count === 0) {
      // No live window: drop a stale row (if any) and open a new one
      await prisma.rateLimitBucket.deleteMany({ where: { key, resetAt: { lte: now } } });
      try {
        return await prisma.rateLimitBucket.create({
          data: { key, count: 1, resetAt: new Date(now.getTime() + windowMs) },
          select: { count: true, resetAt: true },
        });
      } catch (error) {
        // Another instance opened the window first: retry as an increment
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          continue;
        }
        throw error;
      }
    }

    const bucket = await prisma.rateLimitBucket.findUnique({
      where: { key },
      select: { count: true, resetAt: true },
    });
    if (bucket) return bucket;
  }
  throw new Error(`Could not update rate limit bucket '${key}'`);
}

/** Returns the live bucket for `key`, or null when there is none (or its window has ended) */
export async function peekBucket(key: string): Promise<Bucket | null> {
  const bucket = await prisma.rateLimitBucket.findUnique({
    where: { key },
    select: { count: true, resetAt: true },
  });
  return bucket && bucket.resetAt.getTime() > Date.now() ? bucket : null;
}

export async function clearBucket(key: string): Promise<void> {
  await prisma.rateLimitBucket.deleteMany({ where: { key } });
}

/** Deletes buckets whose window has ended. @returns Number of rows purged */
export async function purgeExpiredBuckets(): Promise<number> {
  const { count } = await prisma.rateLimitBucket.deleteMany({
    where: { resetAt: { lte: new Date() } },
  });
  return count;
}
