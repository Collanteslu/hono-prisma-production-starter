# ⚡ Hono + Prisma 7 (SQLite) Production REST API Starter Template

[![CI & Typecheck](https://github.com/Collanteslu/hono-prisma-production-starter/actions/workflows/ci.yml/badge.svg)](https://github.com/Collanteslu/hono-prisma-production-starter/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Hono](https://img.shields.io/badge/Hono-v4-E36002.svg)](https://hono.dev/)
[![Prisma](https://img.shields.io/badge/Prisma-v7-2D3748.svg)](https://www.prisma.io/)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-blue.svg)](https://www.typescriptlang.org/)
[![OpenAPI / Scalar](https://img.shields.io/badge/Docs-Scalar%20OpenAPI-6366f1.svg)](https://scalar.com/)

> **A production-ready, batteries-included REST API GitHub template** built with **TypeScript**, **[Hono](https://hono.dev/)**, **[Prisma 7](https://www.prisma.io/)** (embedded SQLite via LibSQL Driver Adapter), **[Zod 4](https://zod.dev/)** (with an OpenAPI spec generated from the routes), **Bcrypt**, **Stateful Sessions with real-time revocation and user blocking**, **email verification, password recovery and TOTP 2FA**, a **selectable authentication level** (`AUTH_MODE=none | basic | full`), **Rate Limiting**, **Graceful Shutdown**, **Docker containerization**, and interactive **[Scalar OpenAPI](https://scalar.com/)** documentation.

---

## 🎯 Why Use This Template?

Starting a backend project often requires reimplementing the same boilerplate: authentication, password hashing, session revocation, input validation, rate limiting, and database models.

This template gives you an **opinionated, robust, production-grade foundation**:
- **Zero External Dependencies to Run**: Uses embedded SQLite with Prisma 7 Driver Adapters. Anyone can clone and run it instantly without configuring Docker, PostgreSQL, or Redis.
- **Enterprise-Grade Authentication**: Access Tokens (15 min) + Refresh Tokens (7 days) with **Token Rotation** and **Stateful Session tracking** in SQLite.
- **Instant Revocation & Real-Time Suspension**: Suspend accounts or revoke active sessions immediately; requests are rejected in real-time without waiting for JWT expiration.
- **Strict User Ownership**: Standard users can only interact with tasks they own.
- **Pick Your Auth Level**: `AUTH_MODE=full` (default: + email verification, password recovery, 2FA), `basic` (users and sessions only) or `none` (a public API without users). Disabled modules are not mounted and disappear from the docs. See [Authentication Modes](#-authentication-modes-auth_mode).
- **OpenAPI 3.0 Generated from Code**: Each route is declared once (validation + types + docs), so the interactive Scalar console at `/docs` can never drift from the implementation.
- **End-to-End Typed Client**: `hc<AppType>` gives frontends fully typed requests and responses with no codegen.
- **Git-Integrated API Testing**: Full collection included for **[Bruno API Client](https://www.usebruno.com/)** with automated token propagation.

---

## 📑 Table of Contents
1. [Architecture & Project Structure](#-architecture--project-structure)
2. [Quickstart (3 Steps)](#-quickstart-in-3-steps)
3. [Authentication Modes (`AUTH_MODE`)](#-authentication-modes-auth_mode)
4. [Starting a New Project from the Template](#-starting-a-new-project-from-the-template)
5. [Interactive API Documentation (Scalar)](#-interactive-api-documentation-scalar)
6. [Testing with Bruno API Client](#-testing-with-bruno-api-client)
7. [Stateful Sessions & Security Model](#-stateful-sessions--security-model)
8. [Type-Safe RPC Client](#-type-safe-rpc-client-hc)
9. [Relational Expansion](#-relational-expansion-include)
10. [Response Envelope & Telemetry](#-standard-response-envelope--telemetry)
11. [Endpoints Reference](#-endpoints-reference)
12. [Automated Testing & Code Quality](#-automated-testing--code-quality)
13. [Configuration](#-configuration)
14. [Docker Deployment](#-docker-deployment)
15. [What's New](#-whats-new)
16. [Contributing & Development Guidelines](#-contributing--development-guidelines)
17. [License](#-license)
18. [AI Agent Skills & Runbooks](#-ai-agent-skills--runbooks-agentsskills)

---

## 🏗️ Architecture & Project Structure

```text
hono-prisma-production-starter/
├── AGENTS.md                         # Guide for AI agents and contributors (install, checks, conventions, safety)
├── .env.example                      # Environment template (secrets intentionally blank)
├── .github/
│   ├── workflows/ci.yml              # CI: audit, migration drift, typecheck, build, lint, tests + coverage, Docker image build
│   ├── ISSUE_TEMPLATE/               # Bug report & feature request forms
│   └── PULL_REQUEST_TEMPLATE.md      # Standard PR checklist
├── .agents/skills/                   # Runbooks for AI assistants and contributors
├── .husky/pre-commit                 # lint-staged (Biome) on commit
├── prisma.config.ts                  # Prisma 7 configuration file
├── prisma/
│   ├── schema.prisma                 # Models: User, Session, RefreshToken, Task, AuditLog, RateLimitBucket,
│   │                                 # AuthToken, RecoveryCode (same schema for every AUTH_MODE)
│   └── migrations/                   # Versioned SQL migrations (applied with `migrate deploy`)
├── bruno/                            # Collection for the Bruno API Client
│   ├── bruno.json                    # Collection metadata
│   ├── collection.bru                # Global `Authorization: Bearer {{token}}` header
│   ├── environments/Local.bru        # Only `baseUrl` (tokens are never stored on disk)
│   ├── Auth/                         # Register, Login Admin, Login User, Refresh Token, Logout,
│   │                                 # Forgot/Reset Password, Verify Email, Resend Verification, MFA Setup/Enable/Disable
│   ├── Sessions/                     # My Sessions, Revoke Session, Revoke All Sessions
│   ├── Users/                        # List/Get/Create/Update/Delete, Block/Unblock, Revoke User Sessions, Reset User MFA
│   ├── Tasks/                        # List/Get/Create/Update/Delete, Restore Task
│   └── Audit/                        # List Audit Logs
├── src/
│   ├── config/env.ts                 # Zod-validated environment variables (fails fast on bad config), AUTH_MODE `features`
│   ├── db.ts                         # Prisma 7 client (password hashes omitted globally) & dev seeder
│   ├── index.ts                      # Entrypoint: global middleware, OpenAPI docs, error handling, shutdown
│   ├── jobs/cleanup.ts               # Background purge of expired sessions, rotated/emailed tokens, used recovery codes, old audit logs
│   ├── lib/
│   │   ├── audit.ts                  # recordAudit() helper
│   │   ├── clientIp.ts               # Client IP resolution (proxy headers only if TRUST_PROXY=true)
│   │   ├── logger.ts                 # Pino logger
│   │   ├── mailer.ts                 # Mail transports: none, log, smtp (nodemailer, loaded lazily), memory (tests)
│   │   ├── openapi.ts                # createRouter(), route helpers (jsonBody, jsonResponse, errorResponses), whenEnabled()
│   │   ├── query.ts                  # Typed filter[...] and sort parsing
│   │   ├── relations.ts              # ?include= whitelist parser
│   │   ├── response.ts               # successResponse / errorResponse / pagination helpers
│   │   ├── totp.ts                   # RFC 6238 TOTP, secret encryption, recovery codes
│   │   ├── validator.ts              # Zod issue formatter for the 400 envelope
│   │   └── version.ts                # API_VERSION constant
│   ├── middleware/
│   │   ├── auth.ts                   # Stateful auth (role/block/session read from DB) + requireAdmin
│   │   ├── rateLimit.ts              # Per-IP rate limiter and per-account login lockout (DB-backed counters)
│   │   └── requestId.ts              # X-Request-Id / timing headers
│   ├── routes/                       # auth, recovery (reset/verification), mfa, sessions, users, tasks, audit
│   ├── schemas/
│   │   ├── index.ts                  # Zod request schemas (registered as OpenAPI components)
│   │   └── responses.ts              # Zod response schemas (documented and type-checked)
│   ├── services/
│   │   ├── sessions.ts               # Token issuing, atomic refresh rotation, session revocation
│   │   ├── authTokens.ts             # Single-use emailed tokens (reset / verification), bound to the address
│   │   ├── accountMail.ts            # Reset and verification emails
│   │   └── mfa.ts                    # Second-factor verification (TOTP or recovery code)
│   ├── types/index.ts                # JWT payload, Hono AppEnv, response metadata types
│   └── utils/password.ts             # Bcrypt hashing utilities
├── tests/                            # Vitest suites (isolated temporary SQLite DB per run)
│   ├── setup/global-setup.ts         # Creates and migrates the temporary database
│   ├── tsconfig.json                 # Type-checks tests too (`npm run typecheck`)
│   └── *.test.ts                     # auth, security, users, tasks, account security, auth modes, unit, health, openapi, rpc
├── test-api.sh                       # End-to-end bash suite against a running server
├── biome.json                        # Linter / formatter configuration
├── Dockerfile                        # Multi-stage production image (non-root, HEALTHCHECK)
├── docker-entrypoint.sh              # Applies migrations, then starts the server
├── docker-compose.yml                # Production Compose configuration
└── LICENSE                           # MIT License
```

---

## ⚡ Quickstart in 3 Steps

### Prerequisites
- **Node.js** v22.12 or higher (CI runs on Node 22; `vitest@5` requires `^22.12 || ^24 || >=26` and
  `@scalar/hono-api-reference` requires `>=22`)
- **npm** v9 or higher

```bash
# 1. Clone or generate your repository
git clone https://github.com/your-username/your-repo-name.git
cd your-repo-name

# 2. Install dependencies & initialize SQLite database (versioned migrations)
npm install
cp .env.example .env
# Generate two distinct signing secrets (the app refuses to start without them, unless AUTH_MODE=none)
sed -i.bak "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -base64 48)|; s|^JWT_REFRESH_SECRET=.*|JWT_REFRESH_SECRET=$(openssl rand -base64 48)|" .env && rm .env.bak
npx prisma generate
npx prisma migrate deploy

# 3. Start development server with hot-reload
npm run dev
```


The API will be running on:
```text
http://localhost:3011
```

*(Outside production, an empty database is seeded on first startup with demo accounts and tasks — see [Pre-seeded Demo Credentials](#pre-seeded-demo-credentials). With `AUTH_MODE=none` it seeds two public tasks instead. In production nothing is seeded; bootstrap the first admin with `ADMIN_EMAIL` / `ADMIN_PASSWORD`.)*

### Database migrations

Schema changes are tracked in [`prisma/migrations`](prisma/migrations) (never use `db push` against real data):

```bash
# After editing prisma/schema.prisma, create and apply a new migration locally...
npm run db:migrate -- --name describe_your_change
# ...and regenerate the typed client (Prisma 7 no longer does this automatically)
npm run db:generate

# Apply pending migrations (CI / production — the Docker entrypoint does this automatically)
npm run db:deploy
```

> **Upgrading an existing database created with `db push`?** The Docker entrypoint detects it (Prisma error `P3005`), marks `0_init` as applied and deploys the remaining migrations. Manually: `npx prisma migrate resolve --applied 0_init && npx prisma migrate deploy`. The `hash_refresh_tokens_and_indexes` migration discards stored refresh tokens, so clients must sign in again once.

---

## 🔐 Authentication Modes (`AUTH_MODE`)

One variable decides how much of the authentication stack the API runs. The default, `full`, is exactly the behaviour of previous versions, so existing deployments need no change.

| | `none` | `basic` | `full` (default) |
|---|---|---|---|
| Use it for | Public/internal APIs, prototypes, services behind an API gateway that already authenticates | Apps that need accounts and roles but handle email and 2FA elsewhere (or not at all) | The complete account-security stack |
| `/api/tasks` (example resource) | Public, tasks have no owner | Bearer, owner-scoped (admins can read everything) | Same as `basic` |
| `/api/auth` register / login / refresh / logout | — | ✅ | ✅ |
| `/api/sessions`, `/api/users`, `/api/audit-logs` | — | ✅ | ✅ |
| Forgot/reset password, verify / resend verification | — | — | ✅ |
| `/api/auth/mfa/*`, `DELETE /api/users/:id/mfa` | — | — | ✅ |
| `JWT_SECRET` / `JWT_REFRESH_SECRET` | Not needed | Required | Required |
| Emails (`MAIL_TRANSPORT`, `SMTP_URL`, `APP_URL`) | Not used | Not used (nodemailer is never loaded) | Used |

What it means in practice:

- **Routes that are not mounted answer `404`** and are absent from `/openapi.json`, `/docs` (tags included) and the `GET /` index, which also reports the active `authMode`. In `none` mode the `BearerAuth` security scheme and the `401` responses disappear from the spec too.
- **The database schema is identical in every mode.** All tables exist, migrations are the same, and switching modes never needs a migration. `Task.userId` is optional for that reason: with `none` new tasks are created without an owner, and tasks that belong to a user (e.g. created earlier in `basic`/`full`) are never shown by the public API.
- **`none`**: every task route is public; `?userId=` and `?scope=all` return `400` and `?include=user` is ignored. Task changes are still written to the `AuditLog` table (without a user), but there is no endpoint to read it. Outside production two example tasks are seeded instead of the demo accounts. `ADMIN_EMAIL` / `ADMIN_PASSWORD` are rejected at startup because there are no users.
- **`basic`**: registration and email changes send no verification email and `REQUIRE_EMAIL_VERIFICATION=true` is rejected at startup. Accounts that enabled 2FA while running `full` **still need their second factor at login** (downgrading the mode never silently removes a protection); their TOTP codes and recovery codes keep working, but disabling or resetting 2FA requires switching back to `full`.
- **Invalid combinations fail fast** (Zod `superRefine` in `src/config/env.ts`): missing JWT secrets in `basic`/`full`, `ADMIN_*` with `none`, `REQUIRE_EMAIL_VERIFICATION` outside `full`. The https `APP_URL` requirement for SMTP in production only applies to `full`.
- **Typed client**: `AppType` always describes the `full` build (TypeScript types cannot depend on a runtime variable). Calling a route of a disabled module through `hc<AppType>` compiles but returns `404`.

```bash
AUTH_MODE=none npm run dev    # public API, no secrets needed
AUTH_MODE=basic npm run dev   # accounts and sessions, no email/2FA
```

> Code that depends on the mode reads the flags `features.auth` / `features.accountSecurity` from `src/config/env.ts`; modules are mounted with `whenEnabled(flag, router)` in `src/index.ts`. See [`AGENTS.md`](AGENTS.md#authentication-modes-auth_mode).

---

## 📋 Starting a New Project from the Template

1. Click **"Use this template" → "Create a new repository"** on GitHub, then clone your new repository.
2. **Rename the project**:
   - `package.json`: `name`, `description`, `version` (keep `src/lib/version.ts` in sync), `author`, `repository`.
   - `src/index.ts`: the `GET /` `name` and the OpenAPI `info.title` / `description`.
   - `docker-compose.yml`: `container_name`.
   - This README (title, badges pointing at `Collanteslu/hono-prisma-production-starter`) and `LICENSE` holder.
3. **Pick an auth level** with `AUTH_MODE` (see above) and create your `.env` from `.env.example`:

   | Variable | `none` | `basic` | `full` |
   |---|---|---|---|
   | `JWT_SECRET`, `JWT_REFRESH_SECRET` (two different `openssl rand -base64 48`) | — | required | required |
   | `CORS_ORIGINS` (your frontends; required in production) | ✅ | ✅ | ✅ |
   | `ADMIN_EMAIL`, `ADMIN_PASSWORD` (first admin in production) | not allowed | ✅ | ✅ |
   | `MAIL_TRANSPORT=smtp`, `SMTP_URL`, `MAIL_FROM`, `APP_URL` (https) | — | — | ✅ for real emails |
   | `MFA_ISSUER` (your product name in authenticator apps), `MFA_ENCRYPTION_KEY` | — | — | ✅ |
   | `TRUST_PROXY` / `TRUST_PROXY_HOPS`, `TURSO_*`, `ENABLE_DOCS` | as needed | as needed | as needed |

4. **Replace the example resource**: `Task` (model, `src/routes/tasks.ts`, its schemas, `bruno/Tasks/`, `tests/tasks.test.ts`) is there to show the conventions — ownership, soft delete, filters, includes, audit. Copy its shape for your own models (see [`.agents/skills/api-endpoint-creator`](.agents/skills/api-endpoint-creator/SKILL.md)), then delete it.
5. **Reset the migration history** if you changed the models before your first deployment: delete `prisma/migrations/*` (keep `migration_lock.toml`) and run `npm run db:migrate -- --name init && npm run db:generate`. Once something is deployed, only add new migrations.

### Removing modules you will never use

`AUTH_MODE` already keeps unused modules out of the running API, so deleting code is optional. If you want a leaner codebase, remove them from the top down and let `npm run typecheck` guide you:

- **2FA (MFA)**: `src/routes/mfa.ts` (+ its two mounts in `src/index.ts`), `src/services/mfa.ts`, `src/lib/totp.ts`, the second-factor block of the login handler and `totpCode`/`recoveryCode` in the login schema, the MFA schemas in `src/schemas/`, `MFA_*` env variables, `bruno/Auth/MFA *.bru` and `bruno/Users/Reset User MFA (Admin).bru`, the MFA tests in `tests/account-security*.test.ts`. Schema: `RecoveryCode` and the `totp*` columns of `User` (plus the purge in `src/jobs/cleanup.ts`).
- **Email verification and password recovery**: `src/routes/recovery.ts` (+ mount), `src/services/accountMail.ts`, `src/services/authTokens.ts`, `src/lib/mailer.ts`, the `sendVerificationEmail` / `deletePendingAuthTokensOp` calls in `auth.ts` and `users.ts`, the `MAIL_*`/`SMTP_URL`/`APP_URL`/`*_TTL_*`/`REQUIRE_EMAIL_VERIFICATION` variables, `npm uninstall nodemailer @types/nodemailer`, the matching Bruno requests and tests (`tests/email-verification-required.test.ts`). Schema: `AuthToken` and `User.emailVerifiedAt`.
- **All authentication** (a permanent `none`): the routes `auth`, `recovery`, `mfa`, `sessions`, `users`, `audit`, `src/middleware/auth.ts`, `src/services/`, `src/utils/password.ts`, `src/lib/totp.ts`, `src/lib/mailer.ts`, the login rate limiters/lockout, the `JWT_*` and `ADMIN_*` variables, the user seeder in `src/db.ts`, the ownership helpers (`viewerOf`, `secured`) in your resources and the corresponding tests and Bruno folders. Schema: `User`, `Session`, `RefreshToken`, `AuthToken`, `RecoveryCode` and `Task.userId`.

Each schema removal needs a migration (`npm run db:migrate -- --name drop_<module>`), then `npm run db:generate`. After that, drop the `AUTH_MODE` values that no longer make sense from `src/config/env.ts` and the docs, and run the full check list in [`AGENTS.md`](AGENTS.md#checks-all-must-pass-before-opening-a-pr).

---

## 📖 Interactive API Documentation (Scalar)

The API ships with an interactive, modern web console powered by **[Scalar](https://scalar.com/)**:

- **Interactive API Console:** [http://localhost:3011/docs](http://localhost:3011/docs)
- **OpenAPI 3.0 JSON Spec:** [http://localhost:3011/openapi.json](http://localhost:3011/openapi.json)

You can explore endpoints, inspect request and response schemas, and execute live HTTP calls with Bearer Token authorization directly from your browser.

**The specification is generated from the code** (`@hono/zod-openapi` + Zod 4): each route is declared once with `createRoute`, and that single definition validates the request, types the handler and documents the endpoint. The compiler rejects handlers returning a status/body that is not declared, and `tests/openapi.test.ts` validates the spec, fails if a registered route is undocumented and checks real responses against the published schemas. See [`.agents/skills/openapi-documentation`](.agents/skills/openapi-documentation/SKILL.md).

---

## 🐶 Testing with Bruno API Client

### What is Bruno?
**[Bruno](https://www.usebruno.com/)** is an open-source, lightweight, fast API client built as a modern, offline-first alternative to Postman and Insomnia.
- **Git-Friendly**: Collections are stored as human-readable `.bru` plain-text files inside your repository.
- **No Cloud Required**: Your requests, headers, and secrets remain 100% on your local machine.

> 🌐 **Official Links:**  
> - Official Website: [https://www.usebruno.com/](https://www.usebruno.com/)  
> - Documentation: [https://docs.usebruno.com/](https://docs.usebruno.com/)

### How to use the included collection
1. Open **Bruno**.
2. Click **Open Collection** and select the [`bruno/`](bruno/) folder in the repository.
3. Select the **`Local`** environment from the top-right environment picker (it only defines `baseUrl`, `http://localhost:3011`).
4. Run `Login Admin` or `Login User` under `Auth/`:
   - A post-response script stores `token`, `refreshToken` and `sessionId` as Bruno **runtime variables**: they live in memory only, are **never written to the repository**, and are lost when Bruno closes (just log in again).
   - All other requests send `Authorization: Bearer {{token}}` automatically (global header in `collection.bru`).

Some things to know before running requests:

| Request | Needs |
|---|---|
| `Users/List Users`, `Create User`, `Block User`, `Unblock User`, `Change User Role`, `Reset User MFA`, `Get User By ID` (uses `user-1`), `Audit/*` | **Login Admin** |
| `Tasks/Get Task By ID`, `Update Task`, `Delete Task`, `Restore Task` | `task-1` belongs to the admin → **Login Admin** (with Login User use `task-3`) |
| `Tasks/Restore Task` | Run `Delete Task` first (without `permanent`) |
| `Sessions/Revoke Session`, `Revoke All Sessions`, `Auth/Logout` | End the current session: log in again afterwards |
| `Auth/Refresh Token` | Refresh tokens are single-use; run `Login *` again to get a fresh one |
| `Auth/*` (except login/register/refresh/logout), `Users/Reset User MFA` | Only exist with `AUTH_MODE=full` (404 otherwise) |
| `Tasks/*` with `AUTH_MODE=none` | No login needed; use an `id` returned by `List Tasks` (the demo `task-*` ids are not seeded) |

Demo accounts only exist outside production (see [Pre-seeded Demo Credentials](#pre-seeded-demo-credentials)). You can also run the collection headless: `npx @usebruno/cli run --env Local` from the `bruno/` folder (note that `Auth/Logout` invalidates the token used by the requests that follow it, so run folders individually).

---

## 🛡️ Stateful Sessions & Security Model

```mermaid
sequenceDiagram
    autonumber
    actor Client
    participant Hono as Hono Router & Auth Middleware
    participant SQLite as SQLite Database (Prisma 7)

    Client->>Hono: POST /api/auth/login { email, password }
    Hono->>SQLite: Verify credentials (bcrypt) & create Session
    SQLite-->>Hono: Session created (ID, UserAgent, IP)
    Hono-->>Client: Returns Access Token (15m) + Refresh Token (7d, stored only as SHA-256 hash)

    Client->>Hono: GET /api/tasks (Bearer Access Token)
    Hono->>Hono: Verify JWT signature & expiration
    Hono->>SQLite: Check user is active (role read from DB) AND session.isActive === true
    alt User is blocked OR session is inactive
        SQLite-->>Hono: Rejected (Blocked: 403 / Inactive: 401)
        Hono-->>Client: Immediate Access Denied (Real-Time Revocation)
    else Active & Valid
        SQLite-->>Hono: OK
        Hono->>SQLite: Fetch tasks where userId === currentUser.userId
        SQLite-->>Hono: Return user tasks
        Hono-->>Client: 200 OK (Paginated tasks)
    end
```

### Security guarantees

- **Refresh token rotation with reuse detection**: each refresh token can be exchanged exactly once (atomic claim). Replaying a rotated token within `REFRESH_REUSE_GRACE_SECONDS` (default 10s) returns `409` (benign concurrent refresh); after that it is treated as theft and the whole session is revoked.
- **Hashed refresh tokens**: only SHA-256 digests are persisted, so a database leak does not expose usable tokens.
- **Real-time authorization**: blocking, soft-deleting, role changes and session revocation take effect on the very next request (role is read from the database, not from the JWT).
- **Brute-force protection**: per-IP rate limits on `/login`, `/refresh` and `/register`, plus a per-account lockout after 5 failed logins (15 min). Counters are stored in the database (`RateLimitBucket`), so limits hold across every instance sharing it (e.g. Turso) and survive restarts; a broken counter store fails open and is logged. The lockout is keyed by email, so someone can deliberately lock a known address (`LOGIN_LOCKOUT_MAX_FAILURES` / `LOGIN_LOCKOUT_MINUTES` tune it); this is the usual trade-off against credential stuffing.
- **Trusted client IP**: `X-Forwarded-For` is only honoured when `TRUST_PROXY=true`, and it is read **from the right** (`TRUST_PROXY_HOPS` trusted proxies, default 1) because the leftmost entries are client-controlled. `CF-Connecting-IP` and `X-Real-IP` are ignored, since clients can set them and many proxies forward them untouched. Used for sessions, the audit log and rate limiting.
- **Password policy**: 8–72 characters and at most 72 UTF-8 bytes (bcrypt cost 12). Changing your own password requires `currentPassword`; the update and the revocation of every other session run in one transaction. Admins can reset another user's password without it.
- **Absolute sessions**: a session lasts 7 days from login; rotated refresh tokens are capped to that expiry, so users must log in again after day 7.
- **Startup guards**: the app refuses to boot without `JWT_SECRET` / `JWT_REFRESH_SECRET` (unless `AUTH_MODE=none`, where nothing is signed), and in production requires both to be at least 32 characters and different from each other. Inconsistent settings (see [Authentication Modes](#-authentication-modes-auth_mode)) also stop the boot. `.env.example` ships with blank secrets on purpose.
- **Admin safety**: the last active administrator cannot delete their account; deleted accounts cannot be reactivated.
- **Password recovery** *(`AUTH_MODE=full`)*: `POST /api/auth/forgot-password` always answers 202 (exists or not) and sends the email in the background, so neither the body nor the latency reveals which addresses are registered; at most 3 emails per address per hour. The emailed token is single-use, stored only as SHA-256 and expires after `PASSWORD_RESET_TTL_MINUTES`. Resetting revokes every session, lifts the login lockout and keeps 2FA enforced.
- **Email verification** *(`AUTH_MODE=full`)*: registration (and any email change) sends a single-use link. Set `REQUIRE_EMAIL_VERIFICATION=true` to forbid login until it is used (needs `MAIL_TRANSPORT=smtp`). Existing accounts are grandfathered as verified by the migration. Changing your own email or password needs `currentPassword`, so a stolen access token cannot redirect password resets to an attacker's mailbox. Emailed links are bound to the address they were sent to, and changing the email or the password (including via reset) deletes every pending link, so a link sent to a previous address never works.
- **Two-factor authentication (TOTP, RFC 6238)** *(`AUTH_MODE=full`; enrolled accounts keep needing their code in `basic`)*: `POST /api/auth/mfa/setup` (needs the password) → scan the `otpauth://` URI → `POST /api/auth/mfa/enable` returns 10 one-time recovery codes and signs out other devices. Login then needs `totpCode` or `recoveryCode`. Codes cannot be replayed (the accepted time step is stored atomically), wrong codes count towards the lockout, secrets are AES-256-GCM encrypted at rest (`MFA_ENCRYPTION_KEY`, defaults to a key derived from `JWT_SECRET`) and recovery codes (80 random bits each) are stored hashed. An admin can reset a user who lost their device with `DELETE /api/users/:id/mfa` (not their own: admins use `/mfa/disable` like everyone else).
- **No existence oracle**: a task or session that belongs to someone else answers 404, exactly like a missing one.
- **Audit trail**: logins (successful and failed), logout, registration, user creation, block/unblock, role changes, password changes and resets, MFA enable/disable/reset, email verification, session revocations, token reuse and task changes. Entries older than `AUDIT_RETENTION_DAYS` (default 90, `0` keeps everything) are purged by the cleanup job.
- **Roles**: `PATCH /api/users/:id/role` promotes or demotes; the system can never be left without an active administrator (delete, suspend and demote are all checked inside a transaction).

### Pre-seeded Demo Credentials

Created automatically **only when `NODE_ENV` is not `production`** and the database has no users. Never rely on them outside local development.

| Role | Name | Email | Password | Permissions |
|---|---|---|---|---|
| **Admin** | Luis Admin | `admin@example.com` | `password123` | Full access, user management, account suspension, session revocation |
| **User** | Ana García | `ana@example.com` | `password123` | Standard access, owns personal tasks and sessions |

---

## ⚡ Type-Safe RPC Client (`hc`)

The starter exports `AppType` from `src/index.ts`. Any TypeScript frontend (Next.js, Vite, React, Astro, mobile) can consume the `/api/*` routes with **end-to-end static type safety** — request params, query, JSON bodies and per-status response bodies — without manual type generation or Swagger codegen:

```ts
import { hc } from "hono/client";
import type { AppType } from "./src/index.js";

const client = hc<AppType>("http://localhost:3011", {
  headers: { Authorization: `Bearer ${accessToken}` },
});

const res = await client.api.tasks.$get({
  query: { limit: "10", completed: "false" },
});

// Responses are typed per status code: narrow before reading `data`
if (res.ok) {
  const { data, pagination } = await res.json();
  console.log(data[0].title, pagination?.total);
}

const created = await client.api.tasks.$post({ json: { title: "Typed task" } });
if (created.status === 201) console.log((await created.json()).data.id);
```

This works because every router in `src/routes/` is exported as one **chained** expression (`createRouter().openapi(...).openapi(...)`), which is what lets TypeScript accumulate the route types. Keep that shape when adding routes. `tests/rpc.test.ts` exercises the client at runtime and `npm run typecheck` fails if `AppType` stops carrying the routes.

---

## 🔗 Relational Expansion (`?include=...`)

Just like in NestJS / Prisma Eager Loading, endpoints support dynamic relational expansion via the `?include=` query parameter, avoiding N+1 roundtrips:

- **List users with embedded tasks and active sessions:**
  ```http
  GET /api/users?include=tasks,sessions
  ```
- **List tasks with embedded user profile:**
  ```http
  GET /api/tasks?include=user
  ```

Supported securely via the reusable whitelist helper `src/lib/relations.ts`; only whitelisted relations can be requested. Password hashes are never returned: the Prisma client omits `User.password` from every query unless explicitly requested (`omit: { password: false }`, used only by login).

---

## 📦 Standard Response Envelope & Telemetry

Following API conventions (JSON:API, RFC 7807), responses include telemetry metadata (`meta`) and standard HTTP headers (`Server-Timing`, `X-Response-Time`, `X-Request-Id`).

**Success** (resources and lists):

```json
{
  "success": true,
  "message": "Task created successfully.",
  "data": [ ... ],
  "pagination": {
    "total": 42,
    "page": 1,
    "limit": 10,
    "totalPages": 5,
    "hasNextPage": true,
    "hasPrevPage": false
  },
  "meta": {
    "requestId": "e15822e1-4560-4416-836b-67a6d80ff0a9",
    "timestamp": "2026-09-29T20:00:00.000Z",
    "durationMs": 4.12,
    "apiVersion": "2.0.0"
  }
}
```

`message` and `pagination` appear only when applicable. **Authentication endpoints** (`/login`, `/refresh`) return their token fields at the top level instead of under `data`:

```json
{ "success": true, "message": "Authentication successful", "accessToken": "…", "refreshToken": "…",
  "expiresIn": 900, "sessionId": "…", "user": { "id": "…", "name": "…", "email": "…", "role": "user" }, "meta": { … } }
```

**Errors** always have `success: false` and a `message`; validation failures (400) add `errors` grouped by field:

```json
{ "success": false, "message": "Validation error in request payload",
  "errors": { "email": ["El formato del correo electrónico no es válido"] } }
```

Most errors also carry `meta`. A few are produced by infrastructure middleware and omit it — request validation (400), rate limiting (429) and the 100 KB body limit (413) — so use the `X-Request-Id` response header to correlate requests. The full contract of every endpoint is in `/openapi.json`.

### HTTP Response Headers
- `X-Request-Id`: Unique request trace identifier (an incoming `X-Request-Id` is reused only if it matches `[A-Za-z0-9._:-]{1,128}`).
- `X-Response-Time`: Server-side processing duration (e.g., `4.12ms`).
- `Server-Timing`: Standard W3C timing header (`total;dur=4.12`) displayed natively in Chrome DevTools Network panel.
- `X-RateLimit-Limit` / `X-RateLimit-Remaining` (and `Retry-After` on 429): on rate-limited endpoints.

---

## 📡 Endpoints Reference

The tables describe the default `AUTH_MODE=full`. With `basic`, the recovery, verification and MFA endpoints are not mounted; with `none`, only the health/docs endpoints and the (public) task endpoints exist. See [Authentication Modes](#-authentication-modes-auth_mode).

### Health & Observability
| Method | Endpoint | Description | Auth |
|---|---|---|---|
| `GET` | `/` | Service overview: name, version, `authMode` and the index of the endpoints mounted in that mode | No |
| `GET` | `/healthz` | Uptime check & active SQLite query latency in ms (`503` if the database is unreachable) | No |
| `GET` | `/docs` | Interactive Scalar OpenAPI web documentation (disabled in production unless `ENABLE_DOCS=true`) | No |
| `GET` | `/openapi.json` | Raw OpenAPI 3.0 schema (same toggle as `/docs`) | No |

### Authentication (`/api/auth`)
| Method | Endpoint | Description | Rate Limit |
|---|---|---|---|
| `POST` | `/api/auth/register` | Public sign-up (always `user` role) | 5 req/hour |
| `POST` | `/api/auth/login` | Authenticate, create database session, issue tokens (account lockout after 5 failures) | 10 req/min |
| `POST` | `/api/auth/refresh` | Renew token pair with **Token Rotation** (`409` on concurrent refresh) | 30 req/min |
| `POST` | `/api/auth/logout` | Deactivate session and revoke refresh tokens | No |
| `POST` | `/api/auth/forgot-password` | Email a single-use reset link (always `202`) | 10 req/hour |
| `POST` | `/api/auth/reset-password` | Set a new password with the emailed token; revokes all sessions | 20 req/hour |
| `POST` | `/api/auth/verify-email` | Verify the address with the emailed token | 30 req/hour |
| `POST` | `/api/auth/resend-verification` | Email a new verification link (always `202`) | 10 req/hour |
| `POST` | `/api/auth/mfa/setup` | Start 2FA enrolment (password required): returns secret and `otpauth://` URI | Bearer, 10 req/min |
| `POST` | `/api/auth/mfa/enable` | Confirm with the first code; returns 10 recovery codes once | Bearer, 10 req/min |
| `POST` | `/api/auth/mfa/disable` | Disable 2FA (password + code or recovery code) | Bearer, 10 req/min |


### Session Management (`/api/sessions`)
| Method | Endpoint | Description | Auth |
|---|---|---|---|
| `GET` | `/api/sessions/me` | List all active/inactive sessions with IP & User-Agent | Bearer |
| `DELETE` | `/api/sessions/:sessionId` | **Revoke specific session**: Instantly kicks device (own sessions; Admin can revoke any) | Bearer |
| `POST` | `/api/sessions/revoke-all` | **Revoke all sessions**: Closes all active devices | Bearer |

### Tasks (`/api/tasks`)
*Strict user ownership: Authenticated users only see and manage their own tasks. With `AUTH_MODE=none` the routes are public, tasks have no owner, `userId`/`scope=all` return `400` and `include` is ignored.*

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| `GET` | `/api/tasks` | Paginated list (`?page=1&limit=10&search=text&completed=true&include=user&includeDeleted=true&sort=-createdAt,title&filter[completed]=true`) | Bearer |
| `GET` | `/api/tasks?userId=…` or `?scope=all` | *Admin only*: list another user's (or everyone's) tasks; `403` for everyone else | Admin |
| `GET` | `/api/tasks/:id` | Get single task (`?include=user`, `?includeDeleted=true` for soft-deleted; 404 if missing or belonging to another user, admins can read any) | Bearer |
| `POST` | `/api/tasks` | Create task (automatically assigned to token's userId, generates AuditLog) | Bearer |
| `PUT` | `/api/tasks/:id` | Update title, description, or completed state (generates AuditLog) | Bearer |
| `DELETE` | `/api/tasks/:id` | **Soft-delete** task (`deletedAt: now()`). Add `?permanent=true` for physical delete | Bearer |
| `POST` | `/api/tasks/:id/restore` | Restore a soft-deleted task | Bearer |

### Users (`/api/users`)
| Method | Endpoint | Description | Auth |
|---|---|---|---|
| `GET` | `/api/users` | Paginated users list (`?page=1&limit=10&search=ana&role=user&include=tasks,sessions&includeDeleted=true&sort=-createdAt,name&filter[role]=user`) | Admin |
| `GET` | `/api/users/:id` | Get user details (`?include=tasks,sessions`); Admin, or the user themselves | Bearer |
| `POST` | `/api/users` | Create user with any role (public sign-up lives at `/api/auth/register`) | Admin |
| `PUT` | `/api/users/:id` | Update own user profile (or any profile if Admin). Changing your own password or email needs `currentPassword`; a password change revokes other sessions | Bearer |
| `DELETE` | `/api/users/:id/mfa` | *Admin only*: remove a user's 2FA (lost device) and revoke their sessions | Admin |
| `PATCH` | `/api/users/:id/role` | **Promote / demote** *(Admin only)*: cannot change your own role or demote the last active admin | Admin |
| `PATCH` | `/api/users/:id/block` | **Suspend / Reactivate User** *(Admin only)*: Immediately revokes all active sessions | Admin |
| `POST` | `/api/users/:id/revoke-sessions` | Terminate all active sessions for a target user (self or Admin) | Bearer |
| `DELETE` | `/api/users/:id` | Delete own account (or any if Admin). **Soft-delete** by default, `?permanent=true` for cascade | Bearer |


### Audit & Security Logs (`/api/audit-logs`)
| Method | Endpoint | Description | Auth |
|---|---|---|---|
| `GET` | `/api/audit-logs` | Query audit trail (`?page=1&limit=20&entity=Task&action=SOFT_DELETE&userId=...`) | Admin |

> **Filters** (`filter[field]` / `filter[field][op]`) are typed per field: booleans accept `eq`, strings `eq|contains|in`, numbers `eq|gte|lte|in`, dates `eq|gte|lte`. Filterable fields — tasks: `title`, `description`, `completed`, `createdAt`; users: `name`, `email`, `role`, `isBlocked`, `createdAt`. Unknown fields are ignored; invalid operators or values return `400`. Pagination `limit` is capped at 100 on every list endpoint (out-of-range values return `400`).


---

## 🧪 Automated Testing & Code Quality

### 1. In-Memory Native Tests (Vitest)
Executes high-speed TypeScript unit and integration tests using Hono's in-memory `app.request()` without needing an external HTTP listener. Each run creates, migrates and deletes its own temporary SQLite database, so your `dev.db` is never touched:

```bash
# Run all tests once
npm test

# Run tests with V8 coverage report
npm run test:coverage

# Type-check source and tests (also verifies the typed RPC client)
npm run typecheck

# Run tests in interactive watch mode
npm run test:watch
```

### 2. End-to-End Shell Suite (curl)
Runs end-to-end HTTP tests against an active server instance:

```bash
# Ensure server is running (npm run dev), then execute:
npm run test:e2e
```

The script targets `http://localhost:3011` and relies on the **demo accounts, so it only works outside production**. It changes data (it suspends and reactivates Ana and revokes one of her sessions) and signs in five times, so wait a minute between runs to stay under the login rate limit (10/min per IP).

### 3. Code Formatting & Linting (Biome)
Fast Rust-powered linter and formatter:

```bash
# Check code style and lint rules
npm run lint

# Automatically format and fix issues
npm run lint:fix
```

**Test Coverage Highlights:**
- [x] Deep healthcheck with SQLite latency measurement
- [x] OpenAPI specification & `/docs` availability
- [x] `X-Request-Id` and HTTP security headers
- [x] Bcrypt password verification during login
- [x] IP Rate limiting headers (`X-RateLimit-*`)
- [x] Token Rotation and one-time refresh token validation
- [x] Active session listing and individual session termination (instant 401)
- [x] Admin account suspension (instant 403 on existing tokens & login block)
- [x] Account reactivation
- [x] Task ownership enforcement, pagination, text search, and filters
- [x] Concurrent refresh handling, hashed refresh tokens, and account lockout
- [x] Typed filters (400 on invalid input), malformed JSON handling, multi-field sorting
- [x] Admin-only user creation, public registration, last-admin protection, password-change session revocation
- [x] Soft-deleted task visibility and restore
- [x] OpenAPI spec validity, no code/spec drift, and response contracts checked against schemas
- [x] Password recovery, email verification and TOTP two-factor authentication with recovery codes
- [x] Typed RPC client (`hc<AppType>`) at runtime and at compile time
- [x] Suspended accounts rejected at login and on existing tokens
- [x] Each `AUTH_MODE`: unmounted routes answer 404 and are missing from the spec and `GET /`, public ownerless tasks in `none`, no emails in `basic`, env combinations rejected at startup (`tests/auth-mode-*.test.ts`)

---

## ⚙️ Configuration

All settings are environment variables, validated at startup (the process exits with a clear message if something is wrong). Copy [`.env.example`](.env.example) to `.env` for local development.

| Variable | Default | Description |
|---|---|---|
| `AUTH_MODE` | `full` | `none` (no users, public API), `basic` (users and sessions, no email/recovery/2FA) or `full`. See [Authentication Modes](#-authentication-modes-auth_mode) |
| `JWT_SECRET` / `JWT_REFRESH_SECRET` | — (**required unless `AUTH_MODE=none`**) | HS256 signing secrets, at least 16 characters. **In production: at least 32 characters and different from each other.** Generate with `openssl rand -base64 48` |
| `NODE_ENV` | `development` | `development`, `production` or `test`. Production disables the demo seeder and, by default, the docs |
| `PORT` | `3011` | HTTP port |
| `DATABASE_URL` | `file:./dev.db` (`file:/app/data/prod.db` in the Docker image) | Local SQLite file (relative paths resolve from the working directory) |
| `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` | — | Use a remote Turso/libSQL database instead of the local file |
| `TRUST_PROXY` | `false` | Trust `X-Forwarded-For` for client IPs (enable only behind a trusted reverse proxy that appends to it, e.g. Traefik or Nginx) |
| `TRUST_PROXY_HOPS` | `1` | Number of trusted proxies in front of the API (`2` for e.g. Cloudflare + Traefik). Without a proxy header of that depth the socket address is used |
| `CORS_ORIGINS` | `*` outside production, none in production | Comma-separated allowed origins. In production you must list your frontends (or set `*` explicitly) |
| `ENABLE_DOCS` | `true` outside production | Expose `/docs` and `/openapi.json` |
| `LOGIN_RATE_LIMIT_MAX` / `REFRESH_RATE_LIMIT_MAX` / `REGISTER_RATE_LIMIT_MAX` | `10` / `30` / `5` | Per-IP limits (login and refresh per minute; register per hour) |
| `RECOVERY_RATE_LIMIT_MAX` / `MFA_RATE_LIMIT_MAX` | `10` / `10` | Per-IP limits for the recovery endpoints (per hour) and the MFA endpoints (per minute) |
| `MAIL_TRANSPORT` | `log` outside production, `none` in production | `none`, `log` (prints messages, tokens included: development only), `smtp` or `memory` (tests). Recovery and verification need `smtp` to reach anyone. Only `AUTH_MODE=full` sends account emails |
| `SMTP_URL` / `MAIL_FROM` | — / `Hono API <no-reply@localhost>` | SMTP connection (e.g. `smtps://user:pass@host:465`) and sender |
| `APP_URL` | `http://localhost:3000` (**required, https, in production with `AUTH_MODE=full` and `MAIL_TRANSPORT=smtp`**) | Frontend base URL for the emailed links (`/reset-password?token=…`, `/verify-email?token=…`) |
| `PASSWORD_RESET_TTL_MINUTES` / `EMAIL_VERIFY_TTL_HOURS` | `60` / `24` | Lifetime of the emailed tokens |
| `REQUIRE_EMAIL_VERIFICATION` | `false` | Refuse login until the email is verified (requires `AUTH_MODE=full` and `MAIL_TRANSPORT=smtp`) |
| `MFA_ENCRYPTION_KEY` / `MFA_ISSUER` | derived from `JWT_SECRET` / `Hono API` | Key (≥ 32 chars) encrypting TOTP secrets at rest, and the name shown in authenticator apps. Changing the key invalidates enrolled secrets |
| `LOGIN_LOCKOUT_MAX_FAILURES` / `LOGIN_LOCKOUT_MINUTES` | `5` / `15` | Failed passwords before an account is locked, and for how long |
| `AUDIT_RETENTION_DAYS` | `90` | Days to keep audit entries (`0` = forever) |
| `REFRESH_REUSE_GRACE_SECONDS` | `10` | Window in which reusing a just-rotated refresh token is treated as a concurrent refresh instead of theft |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | — | Bootstrap the first admin in production on an empty database (password 8–72 chars). Rejected with `AUTH_MODE=none` |
| `LOG_LEVEL` | `info` in production, `debug` otherwise | Pino log level (`trace` … `fatal`, `silent`) |

An empty value (`VAR=`) is treated as unset, which is what lets Docker Compose forward optional variables without overriding defaults.

---

## 🐳 Docker Deployment

The template includes an optimized multi-stage `Dockerfile` (Alpine-based, non-root user, `HEALTHCHECK` on `/healthz`) and `docker-compose.yml`. Secrets are **never** committed: Compose refuses to start unless `JWT_SECRET` and `JWT_REFRESH_SECRET` are provided (with `AUTH_MODE=none` they are unused: set any value or remove those two lines from your copy).

> **Use a dedicated env file for production.** Docker Compose automatically reads a `.env` file next to `docker-compose.yml`, which in a development checkout holds your *development* secrets. Keep production values in a separate file and pass it explicitly. `.env.*` files are git-ignored.

```bash
# 1. Create the production env file (never commit it)
cat > .env.production <<EOF
JWT_SECRET=$(openssl rand -base64 48)
JWT_REFRESH_SECRET=$(openssl rand -base64 48)
ADMIN_EMAIL=admin@yourdomain.com
ADMIN_PASSWORD=change-me-please-12345
EOF

# 2. Build and start in detached mode
docker compose --env-file .env.production up -d --build

# View container logs
docker compose --env-file .env.production logs -f

# Stop container
docker compose --env-file .env.production down
```

Compose evaluates the whole file on every command, so pass `--env-file` to all of them (or `export COMPOSE_ENV_FILES=.env.production` once). The compose file forwards every variable of the [Configuration](#-configuration) table except `PORT` (fixed to `3011` inside the container) and `DATABASE_URL` (fixed to `file:/app/data/prod.db` on the persistent volume; the image also defaults to it, so even `docker run` without the variable keeps data on the volume). The named volume `sqlite_data` keeps your SQLite database across restarts, and on startup the entrypoint runs `prisma migrate deploy` (see [Database migrations](#database-migrations)). Docs are off in production unless you set `ENABLE_DOCS=true`.

**Backups:** the image has no `sqlite3` binary. Back up the volume with a throwaway container (replace `<project>_sqlite_data` with the volume name shown by `docker volume ls`):

```bash
mkdir -p backups
docker run --rm -v <project>_sqlite_data:/data -v "$PWD/backups:/backups" alpine \
  sh -c 'apk add --no-cache sqlite >/dev/null && sqlite3 /data/prod.db ".backup /backups/prod-$(date +%Y%m%d%H%M%S).db"'
```

---

## 🆕 What's New

> **Version 2.0.0.** Major bump because some changes break existing API clients: `PUT /api/users/:id` needs `currentPassword` to change your own email or password, validation messages are now in English, and `Task.userId` can be `null` (also in the typed `hc<AppType>` client). Apply the new migrations (`npm run db:deploy`, automatic in Docker) and review the new variables (`AUTH_MODE`, mail, MFA) in [Configuration](#-configuration).

**Selectable authentication level and agent guide**
- `AUTH_MODE=none | basic | full` (default `full`, the previous behaviour). Disabled modules are not mounted, answer `404` and are absent from `/openapi.json`, `/docs` and `GET /` (which now reports `authMode`). Env combinations are validated at startup.
- `Task.userId` is optional (migration `optional_task_owner`, existing rows are copied unchanged) so the example resource can be public and ownerless in `none` mode. The schema is the same in every mode.
- nodemailer is loaded only when `MAIL_TRANSPORT=smtp` is actually used; `basic` never sends account emails.
- The admin route `DELETE /api/users/:id/mfa` now lives in `src/routes/mfa.ts` (same path and behaviour), so the whole MFA module can be switched off or deleted at once.
- [`AGENTS.md`](AGENTS.md): install, checks, conventions, auth modes, migrations, Bruno and safety rules for AI agents and contributors; `.cursorrules` and `.github/copilot-instructions.md` point to it.
- New guide: [Starting a New Project from the Template](#-starting-a-new-project-from-the-template), including how to remove modules.

**Account security** (PRs #14–#17)
- Password recovery (`forgot-password` / `reset-password`) and email verification (`verify-email` / `resend-verification`, optional `REQUIRE_EMAIL_VERIFICATION`) with single-use, SHA-256-hashed tokens, non-enumerating `202` answers and a pluggable mail transport (`none` / `log` / `smtp`).
- Emailed tokens are bound to the address they were sent to and are deleted when the email or the password changes (also by an admin or via reset); changing your own email or password requires `currentPassword`.
- TOTP two-factor authentication (RFC 6238): enrolment, second factor at login, replay protection, secrets encrypted at rest (`MFA_ENCRYPTION_KEY`), 10 recovery codes of 80 bits stored hashed and unique per user, atomic enable (`409` for the loser of a race), admin reset `DELETE /api/users/:id/mfa` (`403` on yourself: use `/mfa/disable`).
- Admins can list other users' tasks (`?userId=`, `?scope=all`) and read any task; writes stay owner-only.
- Production requires an https `APP_URL` when SMTP is used; `resend-verification` skips suspended accounts; the MFA routes document the `403` for suspended accounts.
- The cleanup job also purges expired emailed tokens and recovery codes used more than 30 days ago.
- Validation messages unified in English; `GET /` lists the new endpoints; Bruno requests for every new endpoint (a test enforces it for `/api/auth`).
- Migrations: `account_security` (existing accounts are grandfathered as verified), `bind_auth_tokens_to_email` (pending emailed tokens are discarded: users request a new link) and `recovery_codes_unique_per_user`.

---

## 🤝 Contributing & Development Guidelines

Contributions are welcome! [`AGENTS.md`](AGENTS.md) has the full list of conventions and checks (it is written for AI agents, but it is the shortest complete guide for humans too). Please follow these steps:

1. **Fork the Repository** and create a feature branch (`git checkout -b feature/amazing-feature`).
2. **Ensure Type Safety**: Run `npm run build` to verify there are zero TypeScript errors.
3. **Run the checks**: `npm run typecheck && npm run lint && npm test`, or the full CI list from [`AGENTS.md`](AGENTS.md#checks-all-must-pass-before-opening-a-pr) (plus `npm run test:e2e` against a running dev server if you touch auth or sessions). CI runs the same checks, an `npm audit`, and verifies that migrations match `schema.prisma`.
   - Schema change? Create a migration with `npm run db:migrate -- --name <change>`, run `npm run db:generate`, and commit the migration.
   - New or changed endpoint? Declare it with `createRoute` (docs update themselves) and add it to the Bruno collection.
4. **Follow Commits Conventions**: Use Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`).
5. **Open a Pull Request**: GitHub will automatically load the [Pull Request Template](.github/PULL_REQUEST_TEMPLATE.md).

---

## 📄 License

Distributed under the **MIT License**. See [`LICENSE`](LICENSE) for more information.

---

## 🧠 AI Agent Skills & Runbooks (`.agents/skills/`)

Start with [`AGENTS.md`](AGENTS.md) (read automatically by most coding agents; `.cursorrules` and `.github/copilot-instructions.md` summarise it). This repository is also equipped with built-in agent **Skills** located in [`.agents/skills/`](.agents/skills/). These runbooks enable AI coding assistants (such as Antigravity / Gemini CLI) and human contributors to follow standardized procedures:

| Skill | Folder | Purpose |
|---|---|---|
| **API Endpoint Creator** | [`.agents/skills/api-endpoint-creator`](.agents/skills/api-endpoint-creator/SKILL.md) | Standard 6-step checklist to design, validate with Zod, and mount new routes |
| **Security Hardening** | [`.agents/skills/security-hardening`](.agents/skills/security-hardening/SKILL.md) | Security auditing runbook: token rotation, real-time blocking, rate limiting, and ownership isolation |
| **OpenAPI Documentation** | [`.agents/skills/openapi-documentation`](.agents/skills/openapi-documentation/SKILL.md) | Procedures for maintaining OpenAPI 3.0 schemas and the interactive Scalar UI |
| **Prisma Database Ops** | [`.agents/skills/prisma-database-ops`](.agents/skills/prisma-database-ops/SKILL.md) | Runbook for schema changes, SQLite Driver Adapters, Studio inspection, and resets |
| **Bruno API Testing** | [`.agents/skills/bruno-testing`](.agents/skills/bruno-testing/SKILL.md) | Guide for creating offline-first Git-versioned requests in Bruno with auto-token propagation |
| **Docker Deployment** | [`.agents/skills/docker-deployment`](.agents/skills/docker-deployment/SKILL.md) | Runbook for containerization, multi-stage builds, non-root security, and SQLite backups |
| **SQL to API Generator** | [`.agents/skills/sql-to-api-generator`](.agents/skills/sql-to-api-generator/SKILL.md) | Runbook to reverse-engineer any SQL/DDL file into full Prisma models, Zod validation, and Hono CRUD routes |
