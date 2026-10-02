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
- Changing your own password requires `currentPassword`, and must revoke the user's other sessions in the same transaction as the update (see `PUT /api/users/:id`). Refresh tokens never outlive the session: it is absolute, fixed at login.
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
- Any access to single resources (`/:id`) must verify `entity.userId === currentUser.userId` before reading, mutating, or deleting (answer **404**, never 403, if mismatched, so IDs cannot be probed). See `findOwnedTask()` in `src/routes/tasks.ts`.
- When building `where` clauses from user-controlled filters, apply the ownership field **after** the filters so they can never override it.
- Soft-deleted tasks are hidden (404) unless `?includeDeleted=true` is passed or they are restored; soft-deleted users cannot authenticate.

### 4. Brute-Force Protection
- Per-IP `rateLimiter(name, windowMs, max)` on `/login` (10/min), `/refresh` (30/min) and `/register` (5/hour); all limits are configurable via env vars. Responses: `429` with `Retry-After` and `X-RateLimit-*`.
- Per-account lockout (`createLoginLockout()`): `LOGIN_LOCKOUT_MAX_FAILURES` failed logins lock the email for `LOGIN_LOCKOUT_MINUTES`.
- Login always runs a bcrypt comparison (`getDummyHash()` for unknown emails) to avoid timing leaks, and returns the same 401 for unknown email and wrong password.
- Rate limit and lockout counters live in the database (`RateLimitBucket`, `src/lib/rateLimitStore.ts`), so they are shared by every instance using the same database. Give every limiter a stable, unique `name`.
- Anything that can leave the system without an active admin (delete, suspend, demote) must run `isLastActiveAdmin(tx, user)` inside the same transaction as the write.

### 4b. Account Recovery and Two-Factor Authentication
- Flows that start from an email address (`forgot-password`, `resend-verification`) must answer identically whether or not the account exists, and must send the mail in the background (`inBackground()`), so neither the body nor the latency leaks. Throttle per address as well as per IP.
- Emailed tokens come from `createAuthToken()` and are claimed with `consumeAuthToken()` (single atomic statement, stored only as SHA-256). Never log or return them outside the `log`/`memory` mail transports.
- Changing your own password **or email** requires `currentPassword`; a password reset revokes every session in the same transaction as the update.
- TOTP lives in `src/lib/totp.ts` (RFC 6238, no dependency). A time step is accepted once (`verifyUserTotp` updates `totpLastStep` conditionally); secrets are encrypted at rest and, like `password`, omitted from the Prisma client by default (`omit` in `src/db.ts`): opt in explicitly and never return them.
- Login with 2FA: wrong factor counts towards the lockout, a missing one answers `401` with `details.code = "MFA_REQUIRED"`.

### 5. Client IP and Proxies
- Always resolve the IP with `getClientIp(c)` (`src/lib/clientIp.ts`). `X-Forwarded-For` is trusted **only** when `TRUST_PROXY=true`, and read from the right (`TRUST_PROXY_HOPS` trusted proxies): the leftmost entries are client-controlled. `CF-Connecting-IP` and `X-Real-IP` are ignored on purpose (a client can set them and many proxies forward them untouched). Otherwise spoofed values would poison sessions, audit logs and rate limiting.

### 6. Passwords and Secrets
- Hash with `hashPassword()` from `src/utils/password.ts` (bcrypt, 12 rounds). Passwords are 8–72 characters and at most 72 UTF-8 bytes (bcrypt ignores anything beyond 72 bytes, so the schema checks bytes, not just characters).
- The Prisma client omits `User.password` from every query (`omit` in `src/db.ts`). Only login opts in with `omit: { password: false }`. Never add it back to a response.
- `JWT_SECRET` / `JWT_REFRESH_SECRET` have no defaults and are required unless `AUTH_MODE=none` (no tokens are signed there; a random per-process value fills them); in production they must be ≥ 32 characters and different (`src/config/env.ts`). Cross-field rules for `AUTH_MODE` live in the same `superRefine`: never relax them to make a deployment boot. Never commit real secrets (Compose reads them from the environment / `--env-file`), and never commit Bruno environment values or tokens.

### 7. Auditing
- Record security-relevant events with `recordAudit()`: `LOGIN`, `LOGIN_FAILED`, `LOGOUT`, `REGISTER`, `CREATE`, `UPDATE`, `PASSWORD_CHANGE`, `ROLE_CHANGE`, `PASSWORD_RESET_REQUESTED`, `PASSWORD_RESET`, `EMAIL_VERIFIED`, `MFA_ENABLED`, `MFA_DISABLED`, `MFA_RESET`, `SOFT_DELETE`, `RESTORE`, `DELETE_PERMANENT`, `BLOCK`, `UNBLOCK`, `REVOKE_SESSION`, `REVOKE_ALL_SESSIONS`, `TOKEN_REUSE_DETECTED`. It never throws, so it cannot break the user's request.
- Do not put secrets or tokens in `details`.

## Review Checklist
- [ ] New protected route: ownership or `requireAdmin` enforced, declared with `security: secured`.
- [ ] Multi-step writes that must be all-or-nothing use `prisma.$transaction`.
- [ ] Inputs validated by a Zod schema with length limits; filters go through `parseFilters` (typed, whitelisted).
- [ ] No new place reads `X-Forwarded-For` directly.
- [ ] Tests cover the 401/403/404 paths (see `tests/security.test.ts`, `tests/users.test.ts`).
