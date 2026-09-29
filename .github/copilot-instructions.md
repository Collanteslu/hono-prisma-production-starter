# GitHub Copilot Instructions for Hono + Prisma Starter

This repository is a production REST API boilerplate using Hono, Prisma 7 with Driver Adapters (@prisma/adapter-libsql), SQLite/Turso, Zod 4 with @hono/zod-openapi, and Biome.

## Conventions to Follow:
- **Routes**: Declare every route with `createRoute` and implement it with `router.openapi(route, handler)` (`createRouter()` from `src/lib/openapi.ts`). The OpenAPI spec is generated from these definitions; do not write it by hand. Declare all status codes the handler returns.
- **Typed client**: Export each router as one chained expression and keep `AppType = typeof routes` in `src/index.ts`, so `hc<AppType>` stays typed (`npm run typecheck` verifies it).
- **Schemas**: Request schemas in `src/schemas/index.ts`, response schemas in `src/schemas/responses.ts`; import `z` from `@hono/zod-openapi`.
- **Envelopes**: Use `successResponse` / `errorResponse` / `buildPagination` from `src/lib/response.ts` (meta timing: `durationMs`, `requestId`).
- **Relational Expansion**: Use `parseIncludes` from `src/lib/relations.ts` with explicit whitelists. Password hashes are omitted globally by the Prisma client.
- **Filtering & Sorting**: `parseFilters` takes typed fields (`{ title: "string", completed: "boolean" }`); `parseSorting` returns a Prisma `orderBy` array.
- **Soft Deletes**: Entities with `deletedAt` must exclude soft-deleted records unless `includeDeleted=true`.
- **Authorization**: Enforce ownership, use `requireAdmin` for admin routes, resolve IPs with `getClientIp(c)`, wrap multi-step writes in `prisma.$transaction`.
- **Audit Logs**: Mutating and security-relevant actions must call `recordAudit` in `src/lib/audit.ts`.
- **Database**: Schema changes need a migration (`npm run db:migrate -- --name x`) and `npm run db:generate`; never `prisma db push`.
- **Checks**: `npm run typecheck`, `npm run lint` and `npm test` must pass.
