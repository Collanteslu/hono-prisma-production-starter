# GitHub Copilot Instructions for Hono + Prisma Starter

This repository is a production REST API boilerplate using Hono, Prisma 7 with Driver Adapters (@prisma/adapter-libsql), SQLite/Turso, Zod validation, and Biome.

## Conventions to Follow:
- **Envelopes**: Every API response must use `successResponse` from `src/lib/response.ts` including meta timing (`durationMs`, `requestId`).
- **Relational Expansion**: Use `parseIncludes` from `src/lib/relations.ts` with explicit whitelists.
- **Filtering & Sorting**: Use `parseFilters` and `parseSorting` from `src/lib/query.ts`.
- **Soft Deletes**: Entities with `deletedAt` must exclude soft-deleted records unless `includeDeleted=true`.
- **Audit Logs**: Mutating actions must record traceability logs using `recordAudit` in `src/lib/audit.ts`.
- **Typing**: Keep `AppType` updated in `src/index.ts` for End-to-End type safety with `hono/client`.
