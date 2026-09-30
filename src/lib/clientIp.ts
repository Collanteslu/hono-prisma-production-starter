/**
 * @file clientIp.ts
 * @description Resolves the client IP address for rate limiting, sessions and audit logs.
 *
 * Proxy headers are only trusted when TRUST_PROXY is enabled. Even then, only `X-Forwarded-For`
 * is used, and it is read from the RIGHT: every trusted proxy appends the address it saw, so the
 * leftmost entries are attacker-controlled while the last `TRUST_PROXY_HOPS` entries are not.
 * `CF-Connecting-IP` and `X-Real-IP` are deliberately ignored because a client can set them
 * and most proxies (e.g. Traefik) forward them untouched.
 */

import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";
import { env } from "../config/env.js";

/**
 * Picks the client address from an `X-Forwarded-For` value, counting `hops` trusted proxies from
 * the right (1 = the entry added by the nearest proxy). Returns undefined when the header has
 * fewer entries than trusted proxies, so callers fall back to the socket address.
 */
export function pickForwardedIp(header: string | undefined, hops: number): string | undefined {
  const parts = header
    ?.split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts || parts.length < hops) return undefined;
  return parts[parts.length - hops];
}

export function getClientIp(c: Context): string | undefined {
  if (env.TRUST_PROXY) {
    const forwarded = pickForwardedIp(c.req.header("x-forwarded-for"), env.TRUST_PROXY_HOPS);
    if (forwarded) return forwarded;
  }

  try {
    return getConnInfo(c).remote.address;
  } catch {
    // Non-socket environments (e.g. app.request() in unit tests)
    return undefined;
  }
}
