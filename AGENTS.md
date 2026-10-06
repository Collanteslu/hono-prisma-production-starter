# AGENTS.md

Guide for AI coding agents (and humans) working on this repository. It consolidates
[`.cursorrules`](.cursorrules) and [`.github/copilot-instructions.md`](.github/copilot-instructions.md);
those files stay as short entry points for their tools and must not contradict this one. The step-by-step
runbooks live in [`.agents/skills/`](.agents/skills/), and the [README](README.md) is the user-facing
reference (endpoints, configuration, security model).

**Stack:** Hono v4 · Prisma 7 with the libSQL driver adapter (SQLite file locally, optionally Turso) ·
Zod 4 + `@hono/zod-openapi` · Vitest · Biome · Node.js 22 (`engines.node >=22.12`; the Docker base image is still
`node:20-alpine` — bump it together with a `docker run` smoke test before deploying).

## Install and run

```bash
npm ci
cp .env.example .env
# Two distinct secrets (not needed with AUTH_MODE=none)
sed -i.bak "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -base64 48)|; s|^JWT_REFRESH_SECRET=.*|JWT_REFRESH_SECRET=$(openssl rand -base64 48)|" .env && rm .env.bak
npx prisma generate        # Prisma 7 never generates the client implicitly
npx prisma migrate deploy  # creates/updates dev.db
npm run dev                # http://localhost:3011 (docs at /docs)
```

Outside production an empty database is seeded with demo data (`admin@example.com` / `ana@example.com`,
password `password123`; with `AUTH_MODE=none`, two public tasks). Environment variables are validated in
`src/config/env.ts` and the process exits with a readable message when a combination is invalid.

## Checks (all must pass before opening a PR)

```bash
npx @biomejs/biome check --write .   # format + lint fixes
npx prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --exit-code
npm run typecheck                    # source + tests, including the typed hc<AppType> client
npm run lint
npm run build
npm audit --omit=dev --audit-level=high
npm run test:coverage                # or `npm test`
```

CI (`.github/workflows/ci.yml`) runs the same list plus a Docker image build. Tests create, migrate and
delete their own temporary SQLite database (`tests/setup/global-setup.ts`), so `dev.db` is never touched.
`npm run test:e2e` (`test-api.sh`) is an optional curl suite against a running dev server: it needs the
demo accounts and `AUTH_MODE=full`.

## Authentication modes (`AUTH_MODE`)

| Mode | Mounted | Not mounted (404, absent from `/openapi.json` and `GET /`) |
|---|---|---|
| `full` (default) | everything: auth, recovery/verification, MFA, sessions, users, tasks, audit | — |
| `basic` | `/api/auth` register/login/refresh/logout, `/api/sessions`, `/api/users`, `/api/tasks`, `/api/audit-logs` | recovery, email verification, `/api/auth/mfa/*`, `DELETE /api/users/:id/mfa` |
| `none` | `/api/tasks` (public, ownerless) and the system routes | every auth, user, session, recovery, MFA and audit route |

How it is wired, so new code follows the same pattern:

- `features` (exported from `src/config/env.ts`) is the only switch: `features.auth` (basic or full) and
  `features.accountSecurity` (full). Do not compare `env.AUTH_MODE` strings around the code.
- `src/index.ts` mounts every module through `whenEnabled(flag, router)` (`src/lib/openapi.ts`). A disabled
  module is replaced by an empty router, so it adds no route and nothing to the spec, while the chained
  `app.route(...)` keeps its type: `AppType` always describes the full build.
- Cross-field rules belong in the `superRefine` of `src/config/env.ts` (JWT secrets required unless
  `none`; `ADMIN_*` rejected with `none`; `REQUIRE_EMAIL_VERIFICATION` and the production `APP_URL`
  check only apply to `full`).
- The Prisma schema and the migrations are identical in every mode (`Task.userId` is optional so tasks
  can be ownerless with `none`). Switching modes needs no migration.
- A new module that only makes sense with users: guard it with `features.auth`, list it conditionally
  in `GET /` and the docs tags, and add a test to `tests/auth-mode-*.test.ts`.
- `AUTH_MODE` is read once at startup. Tests for another mode load the app with
  `vi.stubEnv("AUTH_MODE", …)` + `vi.resetModules()` + a dynamic `import()` (see `tests/auth-mode-none.test.ts`).

## Code conventions

1. **Routes are declared once with `createRoute`** and implemented with `router.openapi(route, handler)`
   using `createRouter()` from `src/lib/openapi.ts` (its default hook returns the standard 400 envelope).
   Use the helpers `jsonBody`, `jsonResponse`, `errorResponses` and `secured`. Declare every status code
   the handler can return. Never write OpenAPI by hand.
2. **Schemas:** request schemas in `src/schemas/index.ts`, response schemas in `src/schemas/responses.ts`;
   import `z` from `@hono/zod-openapi` there.
3. **Chained routers:** export each router as ONE chained expression
   (`createRouter().openapi(a, …).openapi(b, …)`) and mount it in the chained `app.route(...)` of
   `src/index.ts`, keeping `export type AppType = typeof routes;`. Standalone `router.openapi(...)`
   statements silently break `hc<AppType>` (`tests/rpc.test.ts` and `npm run typecheck` catch it).
4. **Envelope:** `successResponse(c, data, { status, message, pagination })` / `errorResponse(c, message,
   status)` and `buildPagination()` from `src/lib/response.ts`. Never return raw objects without `success`
   and `meta` (the token endpoints keep their documented top-level shape).
5. **Relations:** `parseIncludes(c.req.query("include"), allowedMap)` from `src/lib/relations.ts` with an
   explicit whitelist. `User.password` is omitted globally by the Prisma client (`src/db.ts`); only login
   opts back in.
6. **Filters and sorting:** `parseFilters(query, { allowedFields: { title: "string", completed: "boolean" } })`
   (typed records, invalid values → 400) and `parseSorting(sort, { allowedFields: [...] })` from
   `src/lib/query.ts`. Apply ownership conditions AFTER user filters. Exclude soft-deleted rows
   (`deletedAt: null`) unless `includeDeleted === "true"`.
7. **Security:** enforce ownership (`resource.userId === c.get("user").userId`; a resource of someone else
   answers 404); admin routes use `middleware: [requireAdmin] as const` (the role is read from the database,
   not the JWT); client IPs only via `getClientIp(c)`; multi-step writes (block/delete + session
   revocation, token rotation, password/email change + token invalidation) inside `prisma.$transaction`.
8. **Audit:** mutating and security-relevant actions call `recordAudit(c, { … })` from `src/lib/audit.ts`.
9. **API messages** (errors and validation) are in English.
10. **Commits:** Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `test:`). Husky runs Biome on
    staged files.

## Database changes

1. Edit `prisma/schema.prisma`.
2. `npm run db:migrate -- --name <change>` (or `--create-only` to review the SQL first, then apply it with
   `npm run db:migrate`), then `npm run db:generate`.
3. Commit the migration folder. When a migration rewrites or discards data, say so in a SQL comment at
   the top and in the PR.
4. Never use `prisma db push` on real data, never edit an applied migration, and keep
   `prisma migrate diff … --exit-code` green.

SQLite is the only provider (`provider = "sqlite"`, libSQL adapter); Turso is selected at runtime with
`TURSO_DATABASE_URL`. See [`.agents/skills/prisma-database-ops`](.agents/skills/prisma-database-ops/SKILL.md).

## Bruno collection

Every new or changed endpoint needs a request in `bruno/<Module>/` (see
[`.agents/skills/bruno-testing`](.agents/skills/bruno-testing/SKILL.md)). Tokens are runtime variables set
by the `Login *` post-response scripts and are never written to disk; `environments/Local.bru` only holds
`baseUrl`. `tests/account-security-docs.test.ts` fails if a documented `/api/auth/*` endpoint has no
request in `bruno/Auth/` — that parity check covers the Auth module only, so keep the other modules'
requests in sync by hand.

## Safety rules

- Never commit secrets, `.env*` files, tokens, SMTP credentials or Bruno runtime values. `.env.example`
  keeps the secrets blank on purpose.
- Never run anything against production data or production credentials; use the local `dev.db` or the
  temporary test database.
- Never relax a startup guard in `src/config/env.ts` to make something work; fix the configuration.
- Work on a feature branch and open a pull request (the template lists the checks); never push to `main`
  directly and never merge your own PR. Describe data-changing migrations and behaviour changes in the PR.

## Useful files

| Path | What |
|---|---|
| `src/config/env.ts` | Env schema, cross-field validation, `features` |
| `src/lib/migrations.ts` | Startup guard: DB migration history vs `prisma/migrations` |
| `src/index.ts` | Middleware, docs, `GET /`, conditional mounting, `AppType` |
| `src/lib/openapi.ts` | `createRouter`, route helpers, `whenEnabled` |
| `src/routes/*.ts` | One chained router per module (`mfa.ts` also exports the admin `userMfaRoutes`) |
| `src/services/` | Sessions/tokens, emailed tokens, MFA |
| `tests/` | Vitest suites; `auth-mode-*.test.ts` cover each `AUTH_MODE` |
| `.agents/skills/` | Runbooks: endpoint creation, security, OpenAPI, Prisma, Bruno, Docker, SQL → API |
