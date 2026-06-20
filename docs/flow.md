# Auth flow — short version

## Pre-flight

| Need | Where |
|---|---|
| Backend running | `docker compose up -d` (port 4000) |
| Real Google ID token | OAuth Playground → tick *your own creds*, scope `email profile`, copy `id_token` |
| Postman env | Import `postman/user_service.postman_environment.json`, paste token into `googleIdToken` |

## The 6 calls (in order)

| # | Call | What it does |
|---|---|---|
| 1 | `GET /health` | Process alive? |
| 2 | `GET /ready` | DB + session store + providers wired? |
| 3 | `GET /auth/providers` | Which providers are enabled? |
| 4 | `POST /auth/google/login` `{token}` | Verify token → upsert user → create session → set `uid_session` cookie |
| 5 | `GET /api/me` | Cookie → session → user + linked identities |
| 6 | `POST /auth/logout` | Drop session from store, clear cookie |

## What happens inside call #4 (the only interesting one)

```
client  → POST /auth/google/login  { token: "<JWT>" }
            │
backend ┤ 1. fetch Google's public keys (cached)
        │ 2. verify JWT signature + aud == GOOGLE_CLIENT_ID + exp not expired
        │ 3. upsert user_identities (provider='google', provider_user_id=jwt.sub)
        │ 4. upsert users (email/name/picture from JWT claims)
        │ 5. create session row in store (memory | redis | db)
        │ 6. Set-Cookie: uid_session=<sessionId>; HttpOnly; SameSite=Lax
        ↓
client  ← 200 { user, session }   + cookie stored in Postman jar
```

## What happens inside call #5

```
client  → GET /api/me   (cookie auto-attached)
            │
backend ┤ 1. SessionGuard: read cookie → lookup session in store
        │ 2. session valid + not expired? → load user
        │ 3. fetch linked identities for user
        ↓
client  ← 200 { user: {…}, identities: [{provider, providerUserId, …}] }
```

## What happens inside call #6

```
client  → POST /auth/logout   (cookie auto-attached)
            │
backend ┤ 1. read session id from cookie
        │ 2. delete from session store
        │ 3. Set-Cookie: uid_session=; Max-Age=0
        ↓
client  ← 200 { ok: true }
```

## Common gotchas

| Symptom | Fix |
|---|---|
| `401 auth_failed` on #4 | Token expired (1 h life) OR `aud` ≠ backend's `GOOGLE_CLIENT_ID`. Get a fresh token from OAuth Playground; confirm same client ID. |
| `401` on #5 | Cookie wasn't sent. In Postman: Settings → "Automatically follow cookies" ON. Or use the same collection so the jar is shared. |
| Curl version: cookie lost between calls | Use `-c cookies.txt` on #4, `-b cookies.txt` on #5/#6. |
| CORS error from browser | Origin not in backend `CORS_ORIGINS`. Add it, recreate app container. |
