/**
 * @file rateLimit.ts
 * @description Rate limiter and login lockout protecting sensitive endpoints (login, token refresh,
 * registration) against brute force and denial of service.
 *
 * Counters live in the database (see lib/rateLimitStore.ts), not in process memory, so limits are
 * shared by every instance that uses the same database.
 */

import type { Context, Next } from "hono";
import { getClientIp } from "../lib/clientIp.js";
import { logger } from "../lib/logger.js";
import { clearBucket, hitBucket, peekBucket } from "../lib/rateLimitStore.js";

/**
 * Creates an IP-based rate limiting middleware.
 * @param name Stable identifier of this limiter (part of the shared counter key)
 * @param windowMs Time window in milliseconds (e.g., 60,000 for 1 minute)
 * @param maxRequests Maximum allowable requests within the time window
 */
export function rateLimiter(name: string, windowMs: number = 60_000, maxRequests: number = 10) {
  return async (c: Context, next: Next) => {
    // Proxy headers are only honoured when TRUST_PROXY is enabled (see getClientIp)
    const ip = getClientIp(c) || "127.0.0.1";

    let bucket: Awaited<ReturnType<typeof hitBucket>>;
    try {
      bucket = await hitBucket(`rl:${name}:${ip}`, windowMs);
    } catch (error) {
      // A broken counter store must not take the API down: fail open and make noise
      logger.error({ err: error }, "Rate limit store unavailable, allowing request");
      await next();
      return;
    }

    c.header("X-RateLimit-Limit", maxRequests.toString());
    c.header("X-RateLimit-Remaining", Math.max(0, maxRequests - bucket.count).toString());

    if (bucket.count > maxRequests) {
      const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt.getTime() - Date.now()) / 1000));
      c.header("Retry-After", retryAfterSec.toString());

      return c.json(
        {
          success: false,
          message: "Too many requests. Please slow down and try again later.",
          retryAfterSeconds: retryAfterSec,
        },
        429,
      );
    }

    await next();
  };
}

/**
 * Tracks failed login attempts per account to lock out credential stuffing
 * that rotates source IPs. Successful logins clear the counter.
 *
 * Trade-off: because the key is the account, someone who knows an email can keep it locked for
 * `lockoutMs`. Tune the threshold and duration (LOGIN_LOCKOUT_*) to your risk.
 */
export function createLoginLockout(maxFailures = 5, lockoutMs = 15 * 60_000) {
  const keyOf = (account: string) => `lockout:${account}`;

  return {
    /** Seconds until the account unlocks, or 0 if login attempts are allowed */
    async retryAfterSeconds(account: string): Promise<number> {
      const bucket = await peekBucket(keyOf(account));
      if (!bucket || bucket.count < maxFailures) return 0;
      return Math.max(1, Math.ceil((bucket.resetAt.getTime() - Date.now()) / 1000));
    },
    async recordFailure(account: string): Promise<void> {
      await hitBucket(keyOf(account), lockoutMs);
    },
    async reset(account: string): Promise<void> {
      await clearBucket(keyOf(account));
    },
  };
}
