/**
 * @file clientIp.ts
 * @description Resolves the client IP address for rate limiting, sessions and audit logs.
 * Reverse-proxy headers are only trusted when TRUST_PROXY is enabled to prevent IP spoofing.
 */

import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";
import { env } from "../config/env.js";

export function getClientIp(c: Context): string | undefined {
  if (env.TRUST_PROXY) {
    const forwarded =
      c.req.header("cf-connecting-ip")?.trim() ||
      c.req.header("x-forwarded-for")?.split(",")[0].trim() ||
      c.req.header("x-real-ip")?.trim();
    if (forwarded) return forwarded;
  }

  try {
    return getConnInfo(c).remote.address;
  } catch {
    // Non-socket environments (e.g. app.request() in unit tests)
    return undefined;
  }
}
