---
name: security-hardening
description: >-
  Security auditing runbook and hardening guidelines for Hono, JWT authentication,
  stateful session management, real-time access revocation, and rate limiting.
---

# Security Hardening Skill

Use this skill when auditing security, adding sensitive endpoints, or modifying authentication and session handling.

## Security Principles Enforced in this Architecture

### 1. Dual-Layer Token Architecture (Access + Refresh)
- **Short-Lived Access Tokens**: Maximum 15 minutes validity (`exp = now + 900`).
- **Refresh Token Rotation**:
  - Every time a refresh token is exchanged at `POST /api/auth/refresh`, the old token row in SQLite **must be deleted**.
  - A newly generated refresh token is inserted in the database.
  - If a revoked token is used, trigger immediate session invalidation.

### 2. Real-Time Account Suspension (Instant Ban)
- JWT tokens are naturally stateless, which creates a window of vulnerability when a user is banned.
- To prevent this, `src/middleware/auth.ts` queries SQLite on every protected request:
  ```typescript
  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { isBlocked: true, blockedReason: true }
  });
  if (user?.isBlocked) {
    return c.json({ success: false, message: 'Account suspended' }, 403);
  }
  ```
- **Rule**: Whenever `user.isBlocked` is set to `true`, delete all refresh tokens and set all `Session.isActive = false`.

### 3. Strict Resource Ownership (Tenant Isolation)
- **Never trust client-supplied user IDs**:
  ```typescript
  // ❌ VULNERABLE:
  const userId = c.req.query('userId') || (await c.req.json()).userId;

  // ✅ SECURE:
  const currentUser = c.get('user');
  const userId = currentUser.userId; // Extracted directly from verified JWT
  ```
- Any access to single resources (`/:id`) must verify `entity.userId === currentUser.userId` before reading, mutating, or deleting. Return `403 Forbidden` if mismatched.

### 4. Brute-Force Rate Limiting
- Sensitive public endpoints (e.g. `/api/auth/login`) must be protected with `rateLimiter(windowMs, maxRequests)`.
- Default: 30 requests per minute per IP.
- Return `429 Too Many Requests` with `Retry-After` header.

### 5. Password Hashing
- Always use `hashPassword()` from `src/utils/password.ts` (bcrypt with 10 salt rounds).
- Never log passwords or return password hashes in JSON responses (always filter through `sanitizeUser()`).
