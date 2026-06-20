# user_service

Multi-provider authentication & user management service — **NestJS + TypeScript**.

- **Pluggable identity providers** — Google SSO is wired in; Microsoft, GitHub, Apple etc. drop in as new `@Injectable()` classes.
- **Pluggable data layer** — SQLite for dev, PostgreSQL for prod, via TypeORM. Driver chosen by `DB_DRIVER` env var.
- **Pluggable session store** — in-memory for dev, Redis for prod, or DB-backed. Chosen by `SESSION_STORE`.
- Cookie-based sessions (`httpOnly`, `SameSite=Lax`, `Secure` in prod).
- Production-ready: `helmet`, CORS, `nestjs-pino` structured logs, `@nestjs/throttler` rate limits, `class-validator` DTOs, graceful shutdown, `/health` + `/ready` probes.

Two ways to run:

1. **Local dev (npm)** — defaults to SQLite + in-memory sessions, zero infra needed.
2. **Docker compose** — full Postgres 16 + Redis 7 + app stack, one command.

Deeper docs live in [`docs/`](docs/):

- [`docs/architecture.md`](docs/architecture.md) — module map, dependency graph, key design choices.
- [`docs/adding-a-provider.md`](docs/adding-a-provider.md) — step-by-step for new SSO providers.
- [`docs/testing.md`](docs/testing.md) — browser/curl/Postman cheat sheet for every endpoint.
- [`docs/deployment.md`](docs/deployment.md) — production checklist, migrations, scaling.

---

## Quick start (local dev)

```powershell
cd F:\chunks\user_service
npm install
Copy-Item .env.example .env     # then edit GOOGLE_CLIENT_ID
npm run start:dev               # watches & restarts on change
# or one-shot: npm run build && npm start
```

Default URL: `http://localhost:4000`. Uses SQLite (`./data/users.db`) and
in-memory sessions — no Postgres or Redis needed.

Sanity checks:

```powershell
curl http://localhost:4000/health
curl http://localhost:4000/ready
curl http://localhost:4000/auth/providers
```

Prefer containers? Skip the section below and jump to **Run with Docker**.

---

## Run with Docker

A `Dockerfile` and `docker-compose.yml` are included. The compose stack brings up
**Postgres 16 + Redis 7 + the app** with health-gated startup ordering — no local
Node, Postgres, or Redis install needed.

```powershell
cd F:\chunks\user_service

# 1) Make sure your .env (next to docker-compose.yml) has at least:
#      GOOGLE_CLIENT_ID=YOUR_ID.apps.googleusercontent.com
#      CORS_ORIGINS=http://localhost:5500,http://127.0.0.1:5500
#    The same .env is shared with the local-dev (npm) workflow above.

# 2) Build & run.
docker compose up --build       # add -d to run detached

# 3) Verify.
curl http://localhost:4000/health
curl http://localhost:4000/ready    # → db:"postgres", sessions:"redis"

# 4) Tear down (keeps volumes).
docker compose down
# Tear down AND wipe data volumes.
docker compose down -v
```

**What you get:**

| Service    | Image                  | Port | Volume          |
|------------|------------------------|------|-----------------|
| `app`      | `user-service:local`   | 4000 | `app-data`      |
| `postgres` | `postgres:16-alpine`   | 5432 | `postgres-data` |
| `redis`    | `redis:7-alpine`       | 6379 | `redis-data`    |

When compose brings the app up, it overrides `DB_DRIVER=postgres` /
`SESSION_STORE=redis` so the app uses the bundled services automatically — your
local-dev `.env` (sqlite + memory) stays untouched.

**Notes on the image:**

- Multi-stage build: a `node:20-bookworm-slim` builder compiles TS, then a fresh
  `node:20-bookworm-slim` runtime gets only `dist/`, pruned `node_modules`, and the
  healthcheck script.
- Runs as the non-root `node` user (uid 1000).
- `HEALTHCHECK` pings `/health` every 15 s using a tiny Node script
  (`docker/healthcheck.js`) — no curl/wget needed inside the image.
- `app` waits for `postgres` and `redis` to report `healthy` before it starts
  (`depends_on: condition: service_healthy`).

**Overriding settings:** every value in `docker-compose.yml` reads from the env first,
so any of `GOOGLE_CLIENT_ID`, `CORS_ORIGINS`, `DB_DRIVER`, `DB_URL`, `SESSION_STORE`,
`REDIS_URL`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `PORT`, etc. in
`.env` overrides the defaults baked into the compose file.

To run the app alone against an external database/Redis (no bundled services):

```powershell
docker build -t user-service:local .
docker run --rm -p 4000:4000 `
  -e DB_DRIVER=postgres `
  -e DB_URL=postgres://user:pass@host.docker.internal:5432/userservice `
  -e SESSION_STORE=redis `
  -e REDIS_URL=redis://host.docker.internal:6379 `
  -e GOOGLE_CLIENT_ID=YOUR_ID.apps.googleusercontent.com `
  user-service:local
```

---

## Project layout

```
user_service/
├── docs/                                Architecture, deploy, adding providers
│   ├── architecture.md
│   ├── adding-a-provider.md
│   └── deployment.md
├── docker/
│   └── healthcheck.js                   Container HEALTHCHECK script
├── test/                                e2e tests live here (none wired yet)
│   └── README.md
├── Dockerfile                           Multi-stage build, non-root, slim runtime
├── docker-compose.yml                   app + Postgres 16 + Redis 7
├── .dockerignore
├── nest-cli.json
├── package.json
├── tsconfig.json
├── tsconfig.build.json
└── src/
    ├── main.ts                          Bootstrap (helmet, cookie-parser, CORS, global pipes)
    ├── app.module.ts                    Root module — wires features together
    │
    ├── common/                          Cross-cutting concerns
    │   ├── constants/
    │   │   └── tokens.ts                APP_CONFIG, IDENTITY_PROVIDERS, SESSION_STORE
    │   ├── decorators/
    │   │   └── current-user.decorator.ts
    │   ├── errors/
    │   │   └── auth.error.ts            AuthError, ProviderNotEnabledError
    │   ├── filters/
    │   │   └── all-exceptions.filter.ts
    │   └── index.ts                     barrel
    │
    ├── config/
    │   ├── env.config.ts                zod-validated AppConfig
    │   ├── config.module.ts             @Global() — exposes APP_CONFIG token
    │   └── index.ts
    │
    ├── database/
    │   ├── entities/
    │   │   ├── user.entity.ts
    │   │   ├── user-identity.entity.ts
    │   │   ├── session.entity.ts
    │   │   └── index.ts
    │   ├── migrations/                  TypeORM migrations (DB_SYNCHRONIZE=false in prod)
    │   ├── database.module.ts           TypeOrmModule.forRootAsync — swaps driver from env
    │   └── index.ts
    │
    ├── health/                          /health + /ready
    │   ├── health.controller.ts
    │   ├── health.module.ts
    │   └── index.ts
    │
    ├── users/                           Pure data layer
    │   ├── users.service.ts
    │   ├── users.module.ts
    │   └── index.ts
    │
    ├── sessions/                        Dynamic @Global() module — registers only the chosen store
    │   ├── interfaces/
    │   │   └── session-store.interface.ts   ISessionStore + SessionRecord
    │   ├── stores/
    │   │   ├── memory.store.ts
    │   │   ├── redis.store.ts
    │   │   ├── db.store.ts
    │   │   └── index.ts
    │   ├── sessions.service.ts          Facade over the chosen store
    │   ├── sessions.module.ts
    │   └── index.ts
    │
    ├── providers/                       Pluggable identity providers
    │   ├── interfaces/
    │   │   └── identity-provider.interface.ts   IIdentityProvider + ProviderIdentity
    │   ├── google/
    │   │   ├── google.provider.ts
    │   │   └── index.ts
    │   ├── providers.service.ts         name → impl lookup
    │   ├── providers.module.ts          Aggregates enabled implementations under IDENTITY_PROVIDERS
    │   └── index.ts
    │
    └── auth/
        ├── dto/
        │   └── login.dto.ts             class-validator: token: string, minLength 10
        ├── guards/
        │   └── session.guard.ts         @UseGuards(SessionGuard)
        ├── helpers/
        │   └── cookie.helper.ts         Session cookie set/clear/read
        ├── auth.service.ts              verify → upsert user + identity → issue session
        ├── auth.controller.ts           POST /auth/:provider/login, /auth/logout, GET /auth/providers
        ├── me.controller.ts             GET /api/me (guarded)
        ├── auth.module.ts
        └── index.ts
```

Every folder has an `index.ts` barrel, so imports stay short:

```ts
import { APP_CONFIG } from '../common/constants';
import { SessionsService } from '../sessions';
import { User, UserIdentity } from '../database/entities';
```

See `docs/architecture.md` for the dependency diagram and `docs/adding-a-provider.md`
for adding new SSO providers.

---

## API

| Method | Path | Description |
|---|---|---|
| `GET`  | `/health` | Liveness probe. |
| `GET`  | `/ready`  | Readiness probe — pings DB, reports active drivers + providers. |
| `GET`  | `/auth/providers` | Lists enabled identity providers. |
| `POST` | `/auth/:provider/login` | Body `{ "token": "<id-token>" }`. Verifies via the named provider, upserts user + identity, sets session cookie, returns user. Throttled to 20/min/IP. |
| `POST` | `/auth/logout` | Deletes the session row, clears the cookie. |
| `GET`  | `/api/me` | Returns the authenticated user + linked identities. `401` if not logged in. |

### Login example

```js
// After Google Identity Services returns response.credential:
const r = await fetch("http://localhost:4000/auth/google/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  credentials: "include",                                  // accept Set-Cookie
  body: JSON.stringify({ token: response.credential }),
});
const { user } = await r.json();
```

### Who am I

```js
const r = await fetch("http://localhost:4000/api/me", { credentials: "include" });
const me = await r.json();   // { user, identities: [...] }
```

---

## Configuration

All settings come from `.env`. See `.env.example` for the full list.

| Variable | Default | Notes |
|---|---|---|
| `NODE_ENV` | `development` | |
| `PORT` | `4000` | |
| `LOG_LEVEL` | `info` | pino level |
| `CORS_ORIGINS` | `http://localhost:5500` | Comma-separated; cookies require credentials so wildcard isn't allowed |
| `DB_DRIVER` | `sqlite` | `sqlite` \| `postgres` |
| `DB_URL` | `./data/users.db` | File path for SQLite, `postgres://…` for Postgres |
| `DB_SYNCHRONIZE` | `true` | Auto-create schema (turn off in prod, use migrations) |
| `SESSION_STORE` | `memory` | `memory` \| `redis` \| `db` |
| `REDIS_URL` | — | Required when `SESSION_STORE=redis` |
| `SESSION_COOKIE_NAME` | `uid_session` | |
| `SESSION_TTL_SECONDS` | `604800` | 7 days |
| `SESSION_COOKIE_SECURE` | `false` | Set to `true` in prod (HTTPS) |
| `ENABLED_PROVIDERS` | `google` | Comma-separated list |
| `GOOGLE_CLIENT_ID` | — | Required when `google` is enabled |

---

## Going to production

Full pre-flight checklist + migrations + scaling notes in
[`docs/deployment.md`](docs/deployment.md). The short version — flip env vars,
no code changes:

```env
NODE_ENV=production
DB_DRIVER=postgres
DB_URL=postgres://app:pass@db.internal:5432/users
DB_SYNCHRONIZE=false               # use migrations (see src/database/migrations/)
SESSION_STORE=redis
REDIS_URL=redis://redis.internal:6379
SESSION_COOKIE_SECURE=true
CORS_ORIGINS=https://app.example.com
GOOGLE_CLIENT_ID=...apps.googleusercontent.com
```

Recommended deployment:

- **Postgres** behind PgBouncer or a managed service (RDS, Cloud SQL, Neon, Supabase).
- **Redis** managed (Elasticache, MemoryStore, Upstash).
- Front the service with a reverse proxy / TLS terminator (Nginx, Caddy, ALB, Cloud Run).
- Run multiple replicas — sessions live in Redis so any replica can serve any request.
- Replace `DB_SYNCHRONIZE=true` with TypeORM migrations under `src/database/migrations/`.

---

## Adding a new provider

Three steps — full walkthrough with code in [`docs/adding-a-provider.md`](docs/adding-a-provider.md).

1. **Implement** `IIdentityProvider` as `@Injectable()` at
   `src/providers/<name>/<name>.provider.ts` — verify the token, map claims into
   a `ProviderIdentity`.
2. **Register** it by adding the class to `ALL_PROVIDERS` in
   `src/providers/providers.module.ts`.
3. **Enable** it by adding the name to `ENABLED_PROVIDERS` in `.env` (and
   any provider-specific env vars, with cross-field validation in
   `src/config/env.config.ts`).

The new endpoint `POST /auth/<name>/login` and the `/auth/providers` listing
update themselves — controllers, sessions, DB, guards stay untouched.

---

## Data model

```
users                                    one row per human
├── id          (uuid)
├── email       (unique when not null)
├── name
├── picture
├── createdAt
└── updatedAt

user_identities                          one row per provider link
├── id                   (uuid)
├── userId               → users.id
├── provider             'google' | 'microsoft' | ...
├── providerUserId       JWT `sub` from the provider
├── emailAtProvider
├── rawProfile           JSON of original claims
├── createdAt
└── UNIQUE (provider, providerUserId)

sessions
├── id          (uuid, value of the cookie)
├── userId      → users.id
├── createdAt
└── expiresAt
```

A single human can have multiple identities pointing at the same `users` row — when a new provider sign-in returns a verified email matching an existing user, we auto-link the new identity to that user.

---

## Security notes

- Google ID-token signature is **always** verified server-side via `google-auth-library` — we never trust the client's decoded JWT.
- Session cookie is `httpOnly` so frontend JS can't read it (XSS mitigation).
- `SameSite=Lax` blocks most CSRF; for cross-site POSTs add a CSRF token or use `SameSite=Strict`.
- `helmet` sets standard security headers.
- `@nestjs/throttler` rate-limits the login endpoint to 20 req/min/IP; `/health` & `/ready` are exempt.
- `ValidationPipe` with `whitelist: true, forbidNonWhitelisted: true` rejects unexpected body fields.
- In production set `SESSION_COOKIE_SECURE=true` so cookies only travel over HTTPS.
- Use a strict `CORS_ORIGINS` allowlist — wildcards are incompatible with `credentials: include`.

---

## Scripts

| Command | What it does |
|---|---|
| `npm run start:dev` | Start with watch + auto-restart |
| `npm run build`     | TypeScript compile to `dist/` |
| `npm start`         | Run via `nest start` |
| `npm run start:prod`| Run compiled output: `node dist/main.js` |
