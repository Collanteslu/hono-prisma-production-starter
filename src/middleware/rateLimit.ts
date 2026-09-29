/**
 * @file rateLimit.ts
 * @description In-memory rate limiter middleware designed to protect sensitive endpoints
 * (e.g. login, token refresh, registration) against brute-force and Denial-of-Service attacks.
 *
 * Note: counters live in process memory, so limits apply per instance. Use a shared store
 * (e.g. Redis) if the API is ever scaled horizontally.
 */

import type { Context, Next } from "hono";
import { getClientIp } from "../lib/clientIp.js";

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

/**
 * Creates an IP-based rate limiting middleware.
 * @param windowMs Time window in milliseconds (e.g., 60,000 for 1 minute)
 * @param maxRequests Maximum allowable requests within the time window
 */
export function rateLimiter(windowMs: number = 60_000, maxRequests: number = 10) {
  const ipStore = new Map<string, RateLimitRecord>();

  // Periodically clean up expired IP records to prevent memory leak
  const interval = setInterval(() => {
    const now = Date.now();
    for (const [ip, record] of ipStore.entries()) {
      if (now > record.resetAt) {
        ipStore.delete(ip);
      }
    }
  }, windowMs);
  interval.unref?.();

  return async (c: Context, next: Next) => {
    // Proxy headers are only honoured when TRUST_PROXY is enabled (see getClientIp)
    const ip = getClientIp(c) || "127.0.0.1";

    const now = Date.now();
    const clientRecord = ipStore.get(ip);

    // Initial request or window expired
    if (!clientRecord || now > clientRecord.resetAt) {
      ipStore.set(ip, {
        count: 1,
        resetAt: now + windowMs,
      });
      c.header("X-RateLimit-Limit", maxRequests.toString());
      c.header("X-RateLimit-Remaining", (maxRequests - 1).toString());
      await next();
      return;
    }

    // Rate limit exceeded
    if (clientRecord.count >= maxRequests) {
      const retryAfterSec = Math.ceil((clientRecord.resetAt - now) / 1000);
      c.header("Retry-After", retryAfterSec.toString());
      c.header("X-RateLimit-Limit", maxRequests.toString());
      c.header("X-RateLimit-Remaining", "0");

      return c.json(
        {
          success: false,
          message: "Too many requests. Please slow down and try again later.",
          retryAfterSeconds: retryAfterSec,
        },
        429,
      );
    }

    // Increment request count within active window
    clientRecord.count++;
    c.header("X-RateLimit-Limit", maxRequests.toString());
    c.header("X-RateLimit-Remaining", (maxRequests - clientRecord.count).toString());

    await next();
  };
}

/**
 * Tracks failed login attempts per account to lock out credential stuffing
 * that rotates source IPs. Successful logins clear the counter.
 */
export function createLoginLockout(maxFailures = 5, lockoutMs = 15 * 60_000) {
  const failures = new Map<string, RateLimitRecord>();

  const interval = setInterval(() => {
    const now = Date.now();
    for (const [key, record] of failures.entries()) {
      if (now > record.resetAt) failures.delete(key);
    }
  }, lockoutMs);
  interval.unref?.();

  return {
    /** Seconds until the account unlocks, or 0 if login attempts are allowed */
    retryAfterSeconds(key: string): number {
      const record = failures.get(key);
      if (!record || Date.now() > record.resetAt || record.count < maxFailures) return 0;
      return Math.ceil((record.resetAt - Date.now()) / 1000);
    },
    recordFailure(key: string) {
      const now = Date.now();
      const record = failures.get(key);
      if (!record || now > record.resetAt) {
        failures.set(key, { count: 1, resetAt: now + lockoutMs });
      } else {
        record.count++;
      }
    },
    reset(key: string) {
      failures.delete(key);
    },
  };
}
