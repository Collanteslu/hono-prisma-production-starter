/**
 * @file rateLimit.ts
 * @description In-memory IP rate limiter middleware designed to protect sensitive endpoints
 * (e.g. login, token refresh) against brute-force and Denial-of-Service attacks.
 */

import type { Context, Next } from "hono";

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
  setInterval(() => {
    const now = Date.now();
    for (const [ip, record] of ipStore.entries()) {
      if (now > record.resetAt) {
        ipStore.delete(ip);
      }
    }
  }, windowMs);

  return async (c: Context, next: Next) => {
    // Extract client IP address with proxy support
    const ip =
      c.req.header("x-forwarded-for")?.split(",")[0].trim() ||
      c.req.header("x-real-ip") ||
      "localhost";

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
