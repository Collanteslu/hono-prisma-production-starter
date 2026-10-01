# ⚡ Hono + Prisma 7 (SQLite) Production REST API Starter Template

[![CI & Typecheck](https://github.com/Collanteslu/hono-prisma-production-starter/actions/workflows/ci.yml/badge.svg)](https://github.com/Collanteslu/hono-prisma-production-starter/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Hono](https://img.shields.io/badge/Hono-v4-E36002.svg)](https://hono.dev/)
[![Prisma](https://img.shields.io/badge/Prisma-v7-2D3748.svg)](https://www.prisma.io/)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-blue.svg)](https://www.typescriptlang.org/)
[![OpenAPI / Scalar](https://img.shields.io/badge/Docs-Scalar%20OpenAPI-6366f1.svg)](https://scalar.com/)

> **A production-ready, batteries-included REST API GitHub template** built with **TypeScript**, **[Hono](https://hono.dev/)**, **[Prisma 7](https://www.prisma.io/)** (embedded SQLite via LibSQL Driver Adapter), **[Zod 4](https://zod.dev/)** (with an OpenAPI spec generated from the routes), **Bcrypt**, **Stateful Sessions with real-time revocation and user blocking**, **Rate Limiting**, **Graceful Shutdown**, **Docker containerization**, and interactive **[Scalar OpenAPI](https://scalar.com/)** documentation.

---

## 🎯 Why Use This Template?

Starting a backend project often requires reimplementing the same boilerplate: authentication, password hashing, session revocation, input validation, rate limiting, and database models.

This template gives you an **opinionated, robust, production-grade foundation**:
- **Zero External Dependencies to Run**: Uses embedded SQLite with Prisma 7 Driver Adapters. Anyone can clone and run it instantly without configuring Docker, PostgreSQL, or Redis.
- **Enterprise-Grade Authentication**: Access Tokens (15 min) + Refresh Tokens (7 days) with **Token Rotation** and **Stateful Session tracking** in SQLite.
- **Instant Revocation & Real-Time Suspension**: Suspend accounts or revoke active sessions immediately; requests are rejected in real-time without waiting for JWT expiration.
- **Strict User Ownership**: Standard users can only interact with tasks they own.
- **OpenAPI 3.0 Generated from Code**: Each route is declared once (validation + types + docs), so the interactive Scalar console at `/docs` can never drift from the implementation.
- **End-to-End Typed Client**: `hc<AppType>` gives frontends fully typed requests and responses with no codegen.
- **Git-Integrated API Testing**: Full collection included for **[Bruno API Client](https://www.usebruno.com/)** with automated token propagation.

---

## 📑 Table of Contents
1. [Architecture & Project Structure](#-architecture--project-structure)
2. [Quickstart (3 Steps)](#-quickstart-in-3-steps)
3. [Using as a GitHub Template](#-using-as-a-github-template)
4. [Interactive API Documentation (Scalar)](#-interactive-api-documentation-scalar)
5. [Testing with Bruno API Client](#-testing-with-bruno-api-client)
6. [Stateful Sessions & Security Model](#-stateful-sessions--security-model)
7. [Type-Safe RPC Client](#-type-safe-rpc-client-hc)
8. [Relational Expansion](#-relational-expansion-include)
9. [Response Envelope & Telemetry](#-standard-response-envelope--telemetry)
10. [Endpoints Reference](#-endpoints-reference)
11. [Automated Testing & Code Quality](#-automated-testing--code-quality)
12. [Configuration](#-configuration)
13. [Docker Deployment](#-docker-deployment)
14. [Contributing & Development Guidelines](#-contributing--development-guidelines)
15. [License](#-license)
16. [AI Agent Skills & Runbooks](#-ai-agent-skills--runbooks-agentsskills)

---

## 🏗️ Architecture & Project Structure

```text
hono-prisma-production-starter/
├── .env.example                      # Environment template (secrets intentionally blank)
├── .github/
│   ├── workflows/ci.yml              # CI: audit, migration drift, typecheck, build, lint, tests + coverage, Docker image build
│   ├── ISSUE_TEMPLATE/               # Bug report & feature request forms
│   └── PULL_REQUEST_TEMPLATE.md      # Standard PR checklist
├── .agents/skills/                   # Runbooks for AI assistants and contributors
├── .husky/pre-commit                 # lint-staged (Biome) on commit
├── prisma.config.ts                  # Prisma 7 configuration file
├── prisma/
│   ├── schema.prisma                 # Models: User, Session, RefreshToken, Task, AuditLog
│   └── migrations/                   # Versioned SQL migrations (applied with `migrate deploy`)
├── bruno/                            # Collection for the Bruno API Client
│   ├── bruno.json                    # Collection metadata
│   ├── collection.bru                # Global `Authorization: Bearer {{token}}` header
│   ├── environments/Local.bru        # Only `baseUrl` (tokens are never stored on disk)
│   ├── Auth/                         # Register, Login Admin, Login User, Refresh Token, Logout
│   ├── Sessions/                     # My Sessions, Revoke Session, Revoke All Sessions
│   ├── Users/                        # List/Get/Create/Update/Delete, Block/Unblock, Revoke User Sessions
│   ├── Tasks/                        # List/Get/Create/Update/Delete, Restore Task
│   └── Audit/                        # List Audit Logs
├── src/
│   ├── config/env.ts                 # Zod-validated environment variables (fails fast on bad config)
│   ├── db.ts                         # Prisma 7 client (password hashes omitted globally) & dev seeder
│   ├── index.ts                      # Entrypoint: global middleware, OpenAPI docs, error handling, shutdown
│   ├── jobs/cleanup.ts               # Background purge of expired sessions and rotated tokens
│   ├── lib/
│   │   ├── audit.ts                  # recordAudit() helper
│   │   ├── clientIp.ts               # Client IP resolution (proxy headers only if TRUST_PROXY=true)
│   │   ├── logger.ts                 # Pino logger
│   │   ├── openapi.ts                # createRouter(), route helpers (jsonBody, jsonResponse, errorResponses)
│   │   ├── query.ts                  # Typed filter[...] and sort parsing
│   │   ├── relations.ts              # ?include= whitelist parser
│   │   ├── response.ts               # successResponse / errorResponse / pagination helpers
│   │   ├── validator.ts              # Zod issue formatter for the 400 envelope
│   │   └── version.ts                # API_VERSION constant
│   ├── middleware/
│   │   ├── auth.ts                   # Stateful auth (role/block/session read from DB) + requireAdmin
│   │   ├── rateLimit.ts              # Per-IP rate limiter and per-account login lockout (DB-backed counters)
│   │   └── requestId.ts              # X-Request-Id / timing headers
│   ├── routes/                       # auth, sessions, users, tasks, audit (createRoute + router.openapi)
│   ├── schemas/
│   │   ├── index.ts                  # Zod request schemas (registered as OpenAPI components)
│   │   └── responses.ts              # Zod response schemas (documented and type-checked)
│   ├── services/sessions.ts          # Token issuing, atomic refresh rotation, session revocation
│   ├── types/index.ts                # JWT payload, Hono AppEnv, response metadata types
│   └── utils/password.ts             # Bcrypt hashing utilities
├── tests/                            # Vitest suites (isolated temporary SQLite DB per run)
│   ├── setup/global-setup.ts         # Creates and migrates the temporary database
│   ├── tsconfig.json                 # Type-checks tests too (`npm run typecheck`)
│   └── *.test.ts                     # auth, security, users, tasks, unit, health, openapi, rpc
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
- **Node.js** v20.0.0 or higher (CI runs on Node 20 LTS)
- **npm** v9 or higher

```bash
# 1. Clone or generate your repository
git clone https://github.com/your-username/your-repo-name.git
cd your-repo-name

# 2. Install dependencies & initialize SQLite database (versioned migrations)
npm install
cp .env.example .env
# Generate two distinct signing secrets (the app refuses to start without them)
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

*(Outside production, an empty database is seeded on first startup with demo accounts and tasks — see [Pre-seeded Demo Credentials](#pre-seeded-demo-credentials). In production nothing is seeded; bootstrap the first admin with `ADMIN_EMAIL` / `ADMIN_PASSWORD`.)*

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

## 📋 Using as a GitHub Template

1. Click the green **"Use this template"** button at the top of the repository in GitHub.
2. Choose **"Create a new repository"**.
3. Name your repository and clone it to your local machine.
4. Update `package.json` with your project's name and details.
5. You now have a complete, secure API architecture ready to build features upon.

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
- **Startup guards**: the app refuses to boot without `JWT_SECRET` / `JWT_REFRESH_SECRET`, and in production requires both to be at least 32 characters and different from each other. `.env.example` ships with blank secrets on purpose.
- **Admin safety**: the last active administrator cannot delete their account; deleted accounts cannot be reactivated.
- **Password recovery**: `POST /api/auth/forgot-password` always answers 202 (exists or not) and sends the email in the background, so neither the body nor the latency reveals which addresses are registered; at most 3 emails per address per hour. The emailed token is single-use, stored only as SHA-256 and expires after `PASSWORD_RESET_TTL_MINUTES`. Resetting revokes every session, lifts the login lockout and keeps 2FA enforced.
- **Email verification**: registration (and any email change) sends a single-use link. Set `REQUIRE_EMAIL_VERIFICATION=true` to forbid login until it is used (needs `MAIL_TRANSPORT=smtp`). Existing accounts are grandfathered as verified by the migration. Changing your own email or password needs `currentPassword`, so a stolen access token cannot redirect password resets to an attacker's mailbox.
- **Two-factor authentication (TOTP, RFC 6238)**: `POST /api/auth/mfa/setup` (needs the password) → scan the `otpauth://` URI → `POST /api/auth/mfa/enable` returns 10 one-time recovery codes and signs out other devices. Login then needs `totpCode` or `recoveryCode`. Codes cannot be replayed (the accepted time step is stored atomically), wrong codes count towards the lockout, secrets are AES-256-GCM encrypted at rest (`MFA_ENCRYPTION_KEY`, defaults to a key derived from `JWT_SECRET`) and recovery codes are stored hashed. An admin can reset a user who lost their device with `DELETE /api/users/:id/mfa`.
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
    "apiVersion": "1.2.0"
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

### Health & Observability
| Method | Endpoint | Description | Auth |
|---|---|---|---|
| `GET` | `/` | Service overview: name, version and endpoint index | No |
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
*Strict user ownership: Authenticated users only see and manage their own tasks.*

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

---

## ⚙️ Configuration

All settings are environment variables, validated at startup (the process exits with a clear message if something is wrong). Copy [`.env.example`](.env.example) to `.env` for local development.

| Variable | Default | Description |
|---|---|---|
| `JWT_SECRET` / `JWT_REFRESH_SECRET` | — (**required**) | HS256 signing secrets, at least 16 characters. **In production: at least 32 characters and different from each other.** Generate with `openssl rand -base64 48` |
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
| `MAIL_TRANSPORT` | `log` outside production, `none` in production | `none`, `log` (prints messages, tokens included: development only), `smtp` or `memory` (tests). Recovery and verification need `smtp` to reach anyone |
| `SMTP_URL` / `MAIL_FROM` | — / `Hono API <no-reply@localhost>` | SMTP connection (e.g. `smtps://user:pass@host:465`) and sender |
| `APP_URL` | `http://localhost:3000` | Frontend base URL for the emailed links (`/reset-password?token=…`, `/verify-email?token=…`) |
| `PASSWORD_RESET_TTL_MINUTES` / `EMAIL_VERIFY_TTL_HOURS` | `60` / `24` | Lifetime of the emailed tokens |
| `REQUIRE_EMAIL_VERIFICATION` | `false` | Refuse login until the email is verified (requires `MAIL_TRANSPORT=smtp`) |
| `MFA_ENCRYPTION_KEY` / `MFA_ISSUER` | derived from `JWT_SECRET` / `Hono API` | Key (≥ 32 chars) encrypting TOTP secrets at rest, and the name shown in authenticator apps. Changing the key invalidates enrolled secrets |
| `LOGIN_LOCKOUT_MAX_FAILURES` / `LOGIN_LOCKOUT_MINUTES` | `5` / `15` | Failed passwords before an account is locked, and for how long |
| `AUDIT_RETENTION_DAYS` | `90` | Days to keep audit entries (`0` = forever) |
| `REFRESH_REUSE_GRACE_SECONDS` | `10` | Window in which reusing a just-rotated refresh token is treated as a concurrent refresh instead of theft |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | — | Bootstrap the first admin in production on an empty database (password 8–72 chars) |
| `LOG_LEVEL` | `info` in production, `debug` otherwise | Pino log level (`trace` … `fatal`, `silent`) |

An empty value (`VAR=`) is treated as unset, which is what lets Docker Compose forward optional variables without overriding defaults.

---

## 🐳 Docker Deployment

The template includes an optimized multi-stage `Dockerfile` (Alpine-based, non-root user, `HEALTHCHECK` on `/healthz`) and `docker-compose.yml`. Secrets are **never** committed: Compose refuses to start unless `JWT_SECRET` and `JWT_REFRESH_SECRET` are provided.

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

## 🤝 Contributing & Development Guidelines

Contributions are welcome! Please follow these steps:

1. **Fork the Repository** and create a feature branch (`git checkout -b feature/amazing-feature`).
2. **Ensure Type Safety**: Run `npm run build` to verify there are zero TypeScript errors.
3. **Run the checks**: `npm run typecheck && npm run lint && npm test` (plus `npm run test:e2e` against a running dev server if you touch auth or sessions). CI runs the same checks, an `npm audit`, and verifies that migrations match `schema.prisma`.
   - Schema change? Create a migration with `npm run db:migrate -- --name <change>`, run `npm run db:generate`, and commit the migration.
   - New or changed endpoint? Declare it with `createRoute` (docs update themselves) and add it to the Bruno collection.
4. **Follow Commits Conventions**: Use Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`).
5. **Open a Pull Request**: GitHub will automatically load the [Pull Request Template](.github/PULL_REQUEST_TEMPLATE.md).

---

## 📄 License

Distributed under the **MIT License**. See [`LICENSE`](LICENSE) for more information.

---

## 🧠 AI Agent Skills & Runbooks (`.agents/skills/`)

This repository is equipped with built-in agent **Skills** located in [`.agents/skills/`](.agents/skills/). These runbooks enable AI coding assistants (such as Antigravity / Gemini CLI) and human contributors to follow standardized procedures:

| Skill | Folder | Purpose |
|---|---|---|
| **API Endpoint Creator** | [`.agents/skills/api-endpoint-creator`](.agents/skills/api-endpoint-creator/SKILL.md) | Standard 6-step checklist to design, validate with Zod, and mount new routes |
| **Security Hardening** | [`.agents/skills/security-hardening`](.agents/skills/security-hardening/SKILL.md) | Security auditing runbook: token rotation, real-time blocking, rate limiting, and ownership isolation |
| **OpenAPI Documentation** | [`.agents/skills/openapi-documentation`](.agents/skills/openapi-documentation/SKILL.md) | Procedures for maintaining OpenAPI 3.0 schemas and the interactive Scalar UI |
| **Prisma Database Ops** | [`.agents/skills/prisma-database-ops`](.agents/skills/prisma-database-ops/SKILL.md) | Runbook for schema changes, SQLite Driver Adapters, Studio inspection, and resets |
| **Bruno API Testing** | [`.agents/skills/bruno-testing`](.agents/skills/bruno-testing/SKILL.md) | Guide for creating offline-first Git-versioned requests in Bruno with auto-token propagation |
| **Docker Deployment** | [`.agents/skills/docker-deployment`](.agents/skills/docker-deployment/SKILL.md) | Runbook for containerization, multi-stage builds, non-root security, and SQLite backups |
| **SQL to API Generator** | [`.agents/skills/sql-to-api-generator`](.agents/skills/sql-to-api-generator/SKILL.md) | Runbook to reverse-engineer any SQL/DDL file into full Prisma models, Zod validation, and Hono CRUD routes |
