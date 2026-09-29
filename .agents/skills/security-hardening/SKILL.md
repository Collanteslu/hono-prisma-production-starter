---
name: security-hardening
description: >-
  Security auditing runbook and hardening guidelines for Hono, JWT authentication,
  stateful session management, real-time access revocation, and rate limiting.
---

# Security Hardening Skill

Use this skill when auditing security, adding sensitive endpoints, or modifying authentication and session handling.
The reference implementations are `src/middleware/auth.ts`, `src/services/sessions.ts` and `src/routes/auth.ts`.

## Security Principles Enforced in this Architecture

### 1. Dual-Layer Token Architecture (Access + Refresh)
- **Short-lived access tokens**: 15 minutes (`ACCESS_TOKEN_TTL_SECONDS`), always bound to a `sessionId`.
- **Refresh tokens are stored hashed**: only the SHA-256 (`hashToken()`) is persisted in `RefreshToken.tokenHash`, never the JWT.
- **Atomic rotation with reuse detection** (`rotateRefreshToken()` in `src/services/sessions.ts`):
  - The token is claimed with a guarded `updateMany({ where: { usedAt: null, ... }, data: { usedAt } })` inside a transaction, so it can be exchanged exactly once.
  - Replaying a token rotated within `REFRESH_REUSE_GRACE_SECONDS` (default 10 s) returns `409`: a benign concurrent refresh, the session survives.
  - Replaying it later, or presenting an unknown/revoked token, is treated as theft: `revokeSession()` and an audit entry `TOKEN_REUSE_DETECTED`.
- Never store or log raw refresh tokens.

### 2. Real-Time Authorization (Instant Ban / Role Changes)
- JWTs are stateless, so `authMiddleware` re-reads the database on **every** protected request and treats the token only as an identity claim:
  - the user must exist, not be soft-deleted (`deletedAt`) and not be blocked (`isBlocked` → 403);
  - the session (`sessionId` is mandatory) must exist, belong to the user, be active and unexpired;
  - the **role is taken from the database**, not from the JWT, so demotions apply immediately.
- Use `requireAdmin` (route `middleware: [requireAdmin] as const`) for admin-only routes; do not re-check `role` by hand.
- Whenever an account is blocked or deleted, revoke its sessions **in the same transaction** with `userSessionRevocationOps(userId)`; use `revokeUserSessions()` / `revokeSession()` elsewhere. Never leave sessions half-revoked.
- Changing a password must revoke the user's other sessions (see `PUT /api/users/:id`).
- Never return `error.message` from token verification to clients.

### 3. Strict Resource Ownership (Tenant Isolation)
- **Never trust client-supplied user IDs**:
  ```typescript
  // ❌ VULNERABLE:
  const userId = c.req.query('userId') || (await c.req.json()).userId;

  // ✅ SECURE:
  const currentUser = c.get('user');
  const userId = currentUser.userId; // from the verified token + session
  ```
- Any access to single resources (`/:id`) must verify `entity.userId === currentUser.userId` before reading, mutating, or deleting (403 if mismatched). See `findOwnedTask()` in `src/routes/tasks.ts`.
- When building `where` clauses from user-controlled filters, apply the ownership field **after** the filters so they can never override it.
- Soft-deleted tasks are hidden (404) unless `?includeDeleted=true` is passed or they are restored; soft-deleted users cannot authenticate.

### 4. Brute-Force Protection
- Per-IP `rateLimiter(windowMs, max)` on `/login` (10/min), `/refresh` (30/min) and `/register` (5/hour); all limits are configurable via env vars. Responses: `429` with `Retry-After` and `X-RateLimit-*`.
- Per-account lockout (`createLoginLockout()`): 5 failed logins lock the email for 15 minutes.
- Login always runs a bcrypt comparison (`getDummyHash()` for unknown emails) to avoid timing leaks, and returns the same 401 for unknown email and wrong password.
- Rate limit state is in memory: it is per instance. Move it to a shared store before scaling horizontally.

### 5. Client IP and Proxies
- Always resolve the IP with `getClientIp(c)` (`src/lib/clientIp.ts`). `X-Forwarded-For`, `CF-Connecting-IP` and `X-Real-IP` are trusted **only** when `TRUST_PROXY=true`; otherwise they can be spoofed and would poison sessions, audit logs and rate limiting.

### 6. Passwords and Secrets
- Hash with `hashPassword()` from `src/utils/password.ts` (bcrypt, 12 rounds). Passwords are 8–72 characters (bcrypt ignores anything beyond 72 bytes).
- The Prisma client omits `User.password` from every query (`omit` in `src/db.ts`). Only login opts in with `omit: { password: false }`. Never add it back to a response.
- `JWT_SECRET` / `JWT_REFRESH_SECRET` have no defaults; in production they must be ≥ 32 characters and different (`src/config/env.ts`). Never commit real secrets (Compose reads them from the environment / `--env-file`), and never commit Bruno environment values or tokens.

### 7. Auditing
- Record security-relevant events with `recordAudit()`: `LOGIN`, `LOGIN_FAILED`, `LOGOUT`, `REGISTER`, `CREATE`, `UPDATE`, `PASSWORD_CHANGE`, `SOFT_DELETE`, `RESTORE`, `DELETE_PERMANENT`, `BLOCK`, `UNBLOCK`, `REVOKE_SESSION`, `REVOKE_ALL_SESSIONS`, `TOKEN_REUSE_DETECTED`. It never throws, so it cannot break the user's request.
- Do not put secrets or tokens in `details`.

## Review Checklist
- [ ] New protected route: ownership or `requireAdmin` enforced, declared with `security: secured`.
- [ ] Multi-step writes that must be all-or-nothing use `prisma.$transaction`.
- [ ] Inputs validated by a Zod schema with length limits; filters go through `parseFilters` (typed, whitelisted).
- [ ] No new place reads `X-Forwarded-For` directly.
- [ ] Tests cover the 401/403/404 paths (see `tests/security.test.ts`, `tests/users.test.ts`).
