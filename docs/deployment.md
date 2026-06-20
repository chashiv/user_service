# Deployment

For local Docker quick-start, see the **Run with Docker** section in the root
`README.md`. This document covers the production checklist.

## Pre-flight checklist

- [ ] `NODE_ENV=production`
- [ ] Real `GOOGLE_CLIENT_ID` (and any other provider client IDs)
- [ ] `DB_DRIVER=postgres`, `DB_URL=postgres://...`
- [ ] `DB_SYNCHRONIZE=false` — use migrations instead (see below)
- [ ] `SESSION_STORE=redis`, `REDIS_URL=redis://...`
- [ ] `SESSION_COOKIE_SECURE=true` (requires HTTPS)
- [ ] `CORS_ORIGINS` is your **actual** frontend origin(s), no wildcards
- [ ] Behind a reverse proxy that terminates TLS

## Migrations (replacing `DB_SYNCHRONIZE`)

`DB_SYNCHRONIZE=true` is for dev only — it does `CREATE TABLE` / `ALTER TABLE`
on boot and can drop columns. In production:

1. Generate a migration: `npx typeorm migration:generate -d <data-source-config> src/database/migrations/<name>`
2. Commit the generated SQL.
3. Run on deploy: `npx typeorm migration:run -d <data-source-config>`
4. Flip `DB_SYNCHRONIZE=false`.

Migration files live in `src/database/migrations/` (folder already created).

## Scaling

- The app is **stateless** as long as `SESSION_STORE=redis` (or `db`). Run
  multiple replicas behind a load balancer; sticky sessions are *not* required.
- Sessions live in Redis with TTL = `SESSION_TTL_SECONDS`. No external cleanup
  job needed.
- Postgres: a single primary is fine for tens of thousands of users; add a read
  replica only if `/api/me` traffic is your bottleneck.

## Observability

- Structured JSON logs via `nestjs-pino`. Pipe stdout into your log aggregator.
- `/health` — process is alive (no DB call, good for k8s liveness probe).
- `/ready` — also pings the database; use as the readiness probe.

## Security hardening already in place

- `helmet()` — sensible default headers
- `@nestjs/throttler` global 100 req/min/IP, login endpoint 20 req/min/IP
- `ValidationPipe { whitelist, forbidNonWhitelisted, transform }` on every DTO
- HttpOnly + SameSite=Lax + Secure (in prod) session cookies
- Graceful shutdown via `app.enableShutdownHooks()`
