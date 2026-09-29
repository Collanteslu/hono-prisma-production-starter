---
name: docker-deployment
description: Enterprise Docker containerization, multi-stage builds, non-root security, persistent volume management, and backup operations for SQLite/Turso.
---

# Docker Deployment Runbook

## Overview
This runbook provides standardized procedures for building, testing, deploying, and maintaining the containerized REST API using Docker and Docker Compose.

---

## 1. Multi-Stage Dockerfile Architecture

The `Dockerfile` is structured in three stages:
1. **deps**: Installs production & development dependencies and generates the Prisma 7 client.
2. **builder**: Compiles TypeScript files into `dist/` using strict checking (`npm run build`).
3. **runner**: Minimal Alpine Linux runtime:
   - Sets `NODE_ENV=production`.
   - Runs as non-privileged system user (`USER node`).
   - Only includes compiled `dist/`, production `node_modules/`, and SQLite storage folder.

---

## 2. Docker Compose Deployment

### Starting the Container
```bash
docker compose up -d --build
```

### Checking Container Health & Logs
```bash
# View real-time logs
docker compose logs -f api

# Verify HTTP healthcheck status
curl -i http://localhost:3011/healthz
```

### Stopping the Services
```bash
docker compose down
```

---

## 3. Persistent Storage & SQLite Backup Procedures

The SQLite database (`dev.db`) is stored inside the named Docker volume `sqlite_data` mounted at `/app`.

### Performing a Hot Safe Backup
To back up the SQLite database without stopping the container:
```bash
docker compose exec api npx sqlite3 dev.db ".backup '/app/backup-$(date +%Y%m%d%H%M%S).db'"
```

### Copying Backup to Host Machine
```bash
docker compose cp api:/app/backup-<TIMESTAMP>.db ./backups/
```

---

## 4. Production Security Hardening Checklist for Docker
- [ ] Container runs as non-root user (`node`).
- [ ] No secrets or `.env` files are baked into Docker image layers.
- [ ] `healthcheck` instruction is configured in `docker-compose.yml` pinging `/healthz`.
- [ ] Memory and CPU limits are specified in orchestrators (Kubernetes / Docker Swarm).
