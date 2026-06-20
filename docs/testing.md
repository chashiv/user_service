# Testing the running stack

Once the service is running (either via `npm run start:dev` or `docker compose up`),
use the steps below to exercise every endpoint.

All examples assume `http://localhost:4000`. Adjust if you changed `PORT`.

---

## 0. Pre-flight: is the stack up?

```powershell
# Docker stack:
cd F:\chunks\user_service
docker compose ps              # all three containers should say "healthy"

# Either stack:
curl.exe http://localhost:4000/health   # → {"ok":true}
```

If `/health` 200s, you're good.

---

## 🌐 Browser (paste in Chrome's address bar)

Only **GET** endpoints work from the address bar (browsers can't issue POST navigations).

| URL | Expected |
|---|---|
| `http://localhost:4000/health` | `200 {"ok":true}` |
| `http://localhost:4000/ready` | `200 {"ok":true,"db":"…","sessions":"…","providers":["google"]}` |
| `http://localhost:4000/auth/providers` | `200 {"enabled":["google"]}` |
| `http://localhost:4000/api/me` | `401 {"error":"unauthorized"}` — no session cookie yet |
| `http://localhost:4000/nope` | `404 Cannot GET /nope` |

Tip: install the **JSON Viewer** Chrome extension to pretty-print the responses,
or use Firefox (it prettifies JSON by default).

---

## 💻 curl

> ⚠️ In **PowerShell**, `curl` is aliased to `Invoke-WebRequest` — always type
> `curl.exe` so you get the real curl. In `cmd.exe` or bash, plain `curl` works.

The `-i` flag prints the response status + headers + body, so you can see things
like `HTTP/1.1 401 Unauthorized` next to `{"error":"unauthorized"}`.

### GET endpoints

```powershell
curl.exe -i http://localhost:4000/health
curl.exe -i http://localhost:4000/ready
curl.exe -i http://localhost:4000/auth/providers
curl.exe -i http://localhost:4000/api/me
curl.exe -i http://localhost:4000/nope
```

### POST: login with a junk token

Proves the Google verifier actually fires (and rejects bad tokens).

```powershell
curl.exe -i -X POST http://localhost:4000/auth/google/login `
  -H "Content-Type: application/json" `
  -d '{"token":"not-a-real-jwt-but-long-enough"}'
```

Expected: `401 {"error":"auth_failed","message":"Invalid Google ID token: …"}`.

### POST: login with empty body

Proves the `class-validator` DTO + global `ValidationPipe` fires.

```powershell
curl.exe -i -X POST http://localhost:4000/auth/google/login `
  -H "Content-Type: application/json" `
  -d '{}'
```

Expected: `400 {"message":["token is required","token must be a string"],…}`.

### POST: hit a provider that isn't enabled

```powershell
curl.exe -i -X POST http://localhost:4000/auth/microsoft/login `
  -H "Content-Type: application/json" `
  -d '{"token":"any-token-here-please"}'
```

Expected: `404 {"error":"provider_not_enabled","enabled":["google"]}`.

### POST: logout

```powershell
curl.exe -i -X POST http://localhost:4000/auth/logout
```

Expected: `201 {"ok":true}`.

---

## 🔐 Full real-login flow (requires a real Google ID token)

The login endpoint sets an **httpOnly** session cookie. To carry it between
calls with curl, save it to a cookie jar with `-c` and read it back with `-b`.

```powershell
# 1. Log in → cookie gets saved to cookies.txt
curl.exe -c cookies.txt -X POST http://localhost:4000/auth/google/login `
  -H "Content-Type: application/json" `
  -d '{"token":"<paste-real-google-id-token-here>"}'

# 2. Use that cookie to call /api/me → 200 with your user + identities
curl.exe -b cookies.txt http://localhost:4000/api/me

# 3. Log out — destroys the session row server-side
curl.exe -b cookies.txt -X POST http://localhost:4000/auth/logout
```

### How to get a real Google ID token (without writing a frontend)

1. Open <https://developers.google.com/oauthplayground>.
2. In the left sidebar, expand **Google OAuth2 API v2** and tick `email` + `profile`.
3. (Top right ⚙) Tick **"Use your own OAuth credentials"** and paste your
   `GOOGLE_CLIENT_ID` + client secret.
4. Click **"Authorize APIs"** → sign in with Google.
5. Click **"Exchange authorization code for tokens"**.
6. Copy the value of `id_token` — that's exactly what your frontend would
   normally POST to `/auth/google/login`.

Make sure the same `GOOGLE_CLIENT_ID` is set in your `user_service` `.env`
(or `docker-compose.yml` env), otherwise the token's audience won't match and
verification will fail.

---

## 📨 Postman / Thunder Client / Insomnia

If you prefer a GUI client:

| Method | URL                                          | Body (raw JSON)            |
|--------|----------------------------------------------|----------------------------|
| GET    | `http://localhost:4000/health`               | —                          |
| GET    | `http://localhost:4000/ready`                | —                          |
| GET    | `http://localhost:4000/auth/providers`       | —                          |
| GET    | `http://localhost:4000/api/me`               | —                          |
| POST   | `http://localhost:4000/auth/google/login`    | `{"token":"<id-token>"}`   |
| POST   | `http://localhost:4000/auth/microsoft/login` | `{"token":"…"}`            |
| POST   | `http://localhost:4000/auth/logout`          | —                          |

In Postman, turn on **Settings → General → "Send cookies automatically"** so
the session cookie is carried between requests.

---

## 🧰 Useful Docker commands while testing

```powershell
cd F:\chunks\user_service

docker compose ps                          # container status
docker compose logs -f app                 # tail app logs
docker compose logs -f                     # tail all
docker compose exec postgres psql -U userservice
docker compose exec redis redis-cli

# Apply code changes to the app (rebuild + restart only the app):
docker compose up -d --build app

# Stop everything (keeps data volumes):
docker compose stop

# Full teardown including data:
docker compose down -v
```

Inside `psql`:

```sql
\dt                                       -- list tables
SELECT * FROM users;
SELECT * FROM user_identities;
SELECT id, "userId", "expiresAt" FROM sessions;
```

Inside `redis-cli`:

```
KEYS sess:*                               -- list all session keys
GET sess:<paste-id>                       -- view a session
SMEMBERS user_sessions:<user-id>          -- all sessions for a user
```
