---
name: docker-deployment
description: Docker containerization, multi-stage builds, non-root security, persistent volume management, migrations and backup operations for SQLite/Turso.
---

# Docker Deployment Runbook

## Overview
Standard procedures for building, deploying and maintaining the containerized REST API with Docker and Docker Compose.

---

## 1. Multi-Stage Dockerfile Architecture

Two stages:
1. **builder** (`node:24-alpine`, pinned by digest): `npm ci`, `prisma generate`, `npm run build` → `dist/`.
2. **runner** (same pinned `node:24-alpine`):
   - `NODE_ENV=production`, runs as the non-root `node` user.
   - Contains only production dependencies, `dist/`, the generated Prisma client, `prisma/` (schema + migrations) and the entrypoint.
   - The Prisma schema engine is downloaded **at build time** (`npm rebuild @prisma/engines prisma` after `npm ci --ignore-scripts`). Without it the first start tries to download it and fails on a read-only filesystem.
   - npm, corepack and yarn are deleted from the runtime image (no `npx`: the entrypoint runs `node node_modules/prisma/build/index.js`), and so is `typescript` (an optional Prisma peer that ships a native compiler). Do not reintroduce `npx`/`npm` calls at runtime.
   - `HEALTHCHECK` calls `GET /healthz` (verifies the process **and** the SQLite query).
   - `docker-entrypoint.sh` runs `prisma migrate deploy` before starting the server. If it finds an existing database created with the old `db push` flow (Prisma `P3005`), it baselines `0_init` and deploys the rest.

---

## 2. Docker Compose Deployment

### Secrets: use a dedicated env file
`docker-compose.yml` requires `JWT_SECRET` and `JWT_REFRESH_SECRET` (it refuses to start without them) and does **not** contain any secret. Compose also auto-loads a `.env` file next to it, which in a dev checkout holds *development* secrets, so keep production values in a separate git-ignored file and pass it on **every** compose command (Compose evaluates the whole file each time):

```bash
cat > .env.production <<EOF
JWT_SECRET=$(openssl rand -base64 48)
JWT_REFRESH_SECRET=$(openssl rand -base64 48)
ADMIN_EMAIL=admin@yourdomain.com
ADMIN_PASSWORD=change-me-please-12345
EOF
```

In production the app also refuses to boot with secrets shorter than 32 characters or identical to each other.

### Authentication level
Add `AUTH_MODE=none|basic|full` to the env file to choose the authentication level (empty = `full`; see the README "Authentication Modes"). Compose forwards it. With `AUTH_MODE=none` the JWT secrets are unused but Compose still requires them: set any value or remove those two lines from your copy of `docker-compose.yml`. With `full` and real emails (`MAIL_TRANSPORT=smtp`), production also needs `SMTP_URL` and an https `APP_URL`.

### Hardening already in `docker-compose.yml`
`read_only: true` (+ tmpfs `/tmp`; the only writable path is the `sqlite_data` volume), `cap_drop: ALL`, `no-new-privileges`, `mem_limit`/`cpus`, and the port published on `127.0.0.1` only. Put a reverse proxy in front for external traffic.

### Verify an image
```bash
docker build -t hono-api:ci .
scripts/docker-smoke.sh hono-api:ci      # --read-only run, migrations, admin login, HEALTHCHECK
```
Scan it before releasing: `trivy image --ignore-unfixed --severity HIGH,CRITICAL hono-api:ci` (0 findings at the time of writing).

### Starting, inspecting, stopping
```bash
docker compose --env-file .env.production up -d --build
docker compose --env-file .env.production logs -f api
curl -i http://localhost:3011/healthz
docker compose --env-file .env.production down
```

Optional variables (`AUTH_MODE`, `ENABLE_DOCS`, `LOG_LEVEL`, rate limits, `TRUST_PROXY`, `CORS_ORIGINS`, `TURSO_*`, …) are forwarded by the compose file; empty means "use the app default". `/docs` and `/openapi.json` are off in production unless `ENABLE_DOCS=true`.

---

## 3. Persistent Storage & SQLite Backup

The production database is `/app/data/prod.db`, stored in the named volume `sqlite_data` mounted at `/app/data` (Compose prefixes the project name: see `docker volume ls`).

The runtime image has **no `sqlite3` binary**, so back up the volume with a throwaway container (uses SQLite's online `.backup`, safe while the API runs):
```bash
mkdir -p backups
docker run --rm -v <project>_sqlite_data:/data -v "$PWD/backups:/backups" alpine \
  sh -c 'apk add --no-cache sqlite >/dev/null && sqlite3 /data/prod.db ".backup /backups/prod-$(date +%Y%m%d%H%M%S).db"'
```

To restore, stop the API, copy the backup over `prod.db` in the volume, and start it again.

---

## 4. Production Security Hardening Checklist
- [ ] Container runs as non-root user (`node`) with a read-only root filesystem and no capabilities (`docker-compose.yml` does this).
- [ ] No secrets or `.env` files are baked into image layers (`.dockerignore` excludes `.env`).
- [ ] Production secrets live in an untracked env file or the orchestrator's secret store, not in `docker-compose.yml`.
- [ ] `HEALTHCHECK` is defined in the `Dockerfile` (pings `/healthz`).
- [ ] `TRUST_PROXY=true` **only** behind a trusted reverse proxy, with `TRUST_PROXY_HOPS` equal to the number of proxies in front of the API; `CORS_ORIGINS` restricted to your frontends.
- [ ] Memory and CPU limits are specified in your orchestrator (Kubernetes / Docker Swarm).
- [ ] Backups of the `sqlite_data` volume are scheduled and restore-tested.
