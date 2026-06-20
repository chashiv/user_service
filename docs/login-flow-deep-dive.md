# Google SSO Login Flow — Deep Dive

A line-by-line walkthrough of what happens from the moment a user clicks the "Sign in with Google" button in the UI until the session cookie is sitting in their browser.

The high-level flow has **9 steps**. Each step below cites the exact file and line numbers so you can pull up the code alongside the explanation.

---

## Table of contents
- [The 9 steps at a glance](#the-9-steps-at-a-glance)
- [Pt 1 — UI → Google → backend](#pt-1--ui--google--backend)
- [Pt 2 — Request hits NestJS: global validations](#pt-2--request-hits-nestjs-global-validations)
- [Pt 3 — Controller → AuthService](#pt-3--controller--authservice)
- [Pt 4 — Provider lookup](#pt-4--provider-lookup)
- [Pt 5 — Cryptographic validation in GoogleProvider.verify](#pt-5--cryptographic-validation-in-googleproviderverify)
- [Pt 6 — User reconciliation](#pt-6--user-reconciliation)
- [Pt 7 — Session creation](#pt-7--session-creation)
- [Pt 8 — Cookie set](#pt-8--cookie-set)
- [Pt 9 — Response body](#pt-9--response-body)
- [Validation cheat-sheet — every gate, in order](#validation-cheat-sheet--every-gate-in-order)
- [Appendix A — How `CORS_ORIGINS` whitelist is wired](#appendix-a--how-cors_origins-whitelist-is-wired)
- [Appendix B — How `ValidationPipe` is triggered](#appendix-b--how-validationpipe-is-triggered)
- [Appendix C — How providers are registered at boot](#appendix-c--how-providers-are-registered-at-boot)

---

## The 9 steps at a glance

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. User clicks Google's button → Google issues an ID token JWT  │
│    UI POSTs { token } to /auth/google/login (credentials:incl.) │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. Express middleware: helmet, CORS, cookie-parser, body parser │
│    NestJS:   global ValidationPipe + Throttler guard            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. AuthController.login extracts (provider, token)              │
│    Delegates to AuthService.loginWithProvider                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. providers.get('google') → returns the GoogleProvider singleton│
│    Unknown provider → ProviderNotEnabledError → 400             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 5. GoogleProvider.verify(token)                                 │
│    OAuth2Client.verifyIdToken does: JWKS fetch, RS256, iss,     │
│    aud=OUR client_id, exp, iat. Returns ProviderIdentity.       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 6. Reconcile to a User row:                                     │
│    A) returning user (identity row hit)                         │
│    B) link by verified email                                    │
│    C) brand-new user + identity row                             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 7. sessions.create(user.id)                                     │
│    Routes to redis / db / memory store via DI.                  │
│    Generates UUIDv4, stores with TTL.                           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 8. cookies.setSession(res, session.id)                          │
│    Set-Cookie: uid_session=<uuid>; HttpOnly; SameSite=Lax; ...  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 9. Return { user: {sanitized}, session: { expiresAt } }         │
│    Never include session.id in the body. JS never sees it.      │
└─────────────────────────────────────────────────────────────────┘
```

---

## Pt 1 — UI → Google → backend

> **Files:** `user_ui/src/lib/gsi.ts`, `user_ui/src/components/google-signin-button.tsx`, `user_ui/src/components/login-card.tsx`, `user_ui/src/App.tsx`, `user_ui/src/hooks/use-session.ts`

### The call chain (top → bottom)

```
App.tsx                useSession()  → const { login } = ...
  │
  └─ <LoginCard onCredential={login} />
       │
       └─ <GoogleSignInButton onCredential={onCredential} />
            │
            ├─ loadGoogleIdentityServices()        ← injects Google's <script>
            └─ google.accounts.id.initialize({
                  client_id,
                  callback: (resp) => callbackRef.current(resp.credential)
               })
               google.accounts.id.renderButton(...)
```

`login` is just a function reference passed top-down. It never runs until **the user clicks Google's button**.

### What's actually inside `response.credential`
A JWT (`header.payload.signature`) signed with Google's RS256 private key. Decoded payload looks like:

```json
{
  "iss": "https://accounts.google.com",
  "aud": "38407264872-....apps.googleusercontent.com",
  "sub": "11xxxxxxxxxxxxxxxxx",
  "email": "testeremail1727@gmail.com",
  "email_verified": true,
  "name": "Tester Email",
  "picture": "https://...",
  "iat": 1719076800,
  "exp": 1719080400
}
```

ID tokens have **~1 hour TTL**. Google issues them; we will only ever **verify** them server-side.

### Then `useSession.login()` runs

```ts
// use-session.ts:44-61
await api("/auth/google/login", {
  method: "POST",
  body: JSON.stringify({ token: googleCredential }),
});
await refresh();                                  // GET /api/me to hydrate UI
```

The `api()` helper (`lib/api.ts`) adds `credentials: 'include'` so the browser will accept and send cookies for this origin.

### Key takeaways
- Token arrives **push-style via a callback** — there is no `getToken()` function.
- The UI never inspects the JWT. It is just an opaque string to forward.
- The cookie isn't set until step 8 — until then the request carries no session cookie.

---

## Pt 2 — Request hits NestJS: global validations

> **Files:** `user_service/src/main.ts`, `user_service/src/auth/dto/login.dto.ts`

Before any controller method runs, every request passes through these layers in order:

### a) Express middleware (`main.ts:19-24`)
```ts
app.use(helmet());                       // security headers
app.use(cookieParser());                 // parses req.cookies
app.enableCors({
  origin: cfg.CORS_ORIGINS,              // whitelist (see Appendix A)
  credentials: true,                     // allow cookies cross-origin
});
```
Nest also installs the default JSON body parser, so by the time we get to a controller, `req.body` is already a parsed object.

### b) Global ValidationPipe (`main.ts:26-32`)
```ts
app.useGlobalPipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }),
);
```
Triggered per-parameter when the parameter has a class type. For the login route, the relevant param is `@Body() body: LoginDto`.

### c) Global exception filter (`main.ts:33`)
```ts
app.useGlobalFilters(new AllExceptionsFilter());
```
Catches whatever the controller / service throws and converts it to a sensible HTTP status.

### d) Per-route guards
- `@Throttle({ default: { limit: 20, ttl: 60_000 } })` on `AuthController.login` — max 20 calls per IP per minute. 21st call → **HTTP 429**, method never runs.

### The DTO checked on login
```ts
// login.dto.ts
export class LoginDto {
  @IsString()
  @MinLength(10, { message: 'token is required' })
  token!: string;
}
```

So the body must be JSON with a `token` field that is a string ≥10 chars. **Extra fields are rejected** because of `forbidNonWhitelisted`. Any violation → **HTTP 400**, controller never runs.

For a deeper look at how the pipe gets wired up to a specific parameter, see Appendix B.

---

## Pt 3 — Controller → AuthService

> **File:** `user_service/src/auth/auth.controller.ts:30-49`

```ts
@Post(':provider/login')
@Throttle({ default: { limit: 20, ttl: 60_000 } })
async login(
  @Param('provider') providerName: string,
  @Body() body: LoginDto,
  @Res({ passthrough: true }) res: Response,
) {
  const { user, session } = await this.auth.loginWithProvider(providerName, body.token);
  this.cookies.setSession(res, session.id);
  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      picture: user.picture,
      createdAt: user.createdAt,
    },
    session: { expiresAt: session.expiresAt },
  };
}
```

### Decorator-by-decorator

| Decorator | Effect |
|---|---|
| `@Post(':provider/login')` | Combined with `@Controller('auth')`, binds to `POST /auth/:provider/login`. `:provider` becomes `req.params.provider`. |
| `@Throttle({ ... })` | `@nestjs/throttler` guard. 20 req/IP/min — 429 on the 21st. |
| `@Param('provider')` | Reads `req.params.provider`. Always `'google'` in our setup. |
| `@Body() body: LoginDto` | Reads `req.body`, runs ValidationPipe against `LoginDto` (per pt 2). |
| `@Res({ passthrough: true }) res` | Injects the raw Express response so we can set a cookie. **`passthrough: true` is critical** — without it, Nest stops serializing the returned object. |

### Method body — three responsibilities

1. **Delegate to the service** (line 37). The controller has zero business logic. All the auth flow lives in `AuthService.loginWithProvider`.
2. **Set the session cookie** (line 38). Side effect via `res.cookie(...)` under the hood.
3. **Return a sanitized JSON body** (lines 39-48). Explicitly picks `id, email, name, picture, createdAt`. **No `session.id` in the body** — it lives in the HttpOnly cookie only.

### Why these shape choices matter
- **Field-picking on `user`** means a future entity change (adding a `passwordHash` column, hypothetically) can't accidentally leak data through this endpoint.
- **Not returning `session.id`** means JavaScript can never read it, so XSS can't exfiltrate it (the HttpOnly cookie is the only place it lives).
- **`session.expiresAt` is included** so the client can show a "Sign in expires in N hours" hint, but it has no security value (the server is the source of truth).

If anything inside throws, `AllExceptionsFilter` maps it:
- `ProviderNotEnabledError` → 400
- `AuthError` → 401
- TypeORM constraint violations → 500
- `BadRequestException` from ValidationPipe → 400

---

## Pt 4 — Provider lookup

> **Files:** `user_service/src/auth/auth.service.ts:21-26`, `user_service/src/providers/providers.service.ts`

```ts
const provider = this.providers.get(providerName);
if (!provider) {
  throw new ProviderNotEnabledError(providerName, this.providers.names());
}
const identity = await provider.verify(token);   // ← belongs to pt 5
```

### The `Map.get` lookup
`this.providers` is `ProvidersService`. Its constructor built a Map once at boot:

```ts
// providers.service.ts:9-11
constructor(@Inject(IDENTITY_PROVIDERS) providers: IIdentityProvider[]) {
  for (const p of providers) this.map.set(p.name, p);
}
```

At runtime: `Map { 'google' → GoogleProvider singleton }`. `get('google')` is O(1) and returns the same instance every time. No new object, no re-initialization.

### Why this is a strategy pattern
`AuthService` does not import `GoogleProvider`. It only knows about the `IIdentityProvider` contract:

```ts
interface IIdentityProvider {
  readonly name: string;
  verify(token: string): Promise<ProviderIdentity>;
}
```

So adding a new SSO provider does **not** require changes to `AuthService` or `AuthController`. See Appendix C for the registration mechanics.

### Error path: `ProviderNotEnabledError`
Two scenarios:

| Scenario | Why `.get()` returns null |
|---|---|
| Unknown provider in URL (`/auth/facebook/login`) | Never in `ALL_PROVIDERS`, never built |
| Known class but disabled by env (`ENABLED_PROVIDERS=google` → ask for `microsoft`) | Filtered out by factory in `providers.module.ts:21-22`, not in the Map |

The error includes `providers.names()` (currently enabled) so the caller gets actionable feedback. `AllExceptionsFilter` returns **HTTP 400**.

### What pt 4 does NOT do
- **No network call.** The `await` on line 26 belongs to pt 5 (`provider.verify`).
- **No token inspection.** The token is still an opaque string here.
- **No DB touch.** That's pt 6.

---

## Pt 5 — Cryptographic validation in `GoogleProvider.verify`

> **File:** `user_service/src/providers/google/google.provider.ts:17-41`

This is where the JWT from the browser is **proven** to be a real, current, Google-signed token intended for **our** app. Everything before this was plumbing.

```ts
async verify(idToken: string): Promise<ProviderIdentity> {
  if (!idToken) throw new AuthError('Missing Google ID token');
  let ticket;
  try {
    ticket = await this.client.verifyIdToken({
      idToken,
      audience: this.cfg.GOOGLE_CLIENT_ID,
    });
  } catch (err) {
    throw new AuthError('Invalid Google ID token: ' + (err as Error).message);
  }
  const payload = ticket.getPayload();
  if (!payload || !payload.sub) {
    throw new AuthError("Google token missing 'sub' claim");
  }
  return {
    provider: 'google',
    providerUserId: payload.sub,
    email: payload.email ?? null,
    emailVerified: payload.email_verified === true,
    name: payload.name ?? null,
    picture: payload.picture ?? null,
    raw: payload as unknown as Record<string, unknown>,
  };
}
```

### a) The presence gate (line 18)
Belt-and-braces for direct service callers. DTO already enforces ≥10 chars. Throws `AuthError` → **401**.

### b) The one call that does everything (lines 21-24)
`this.client` is the `OAuth2Client` constructed once at boot (`google.provider.ts:14`). Inside `verifyIdToken`, `google-auth-library` performs ALL of these in one pass:

1. **Parse the JWT structure.** Splits `header.payload.signature` (three base64url segments). Decodes header and payload. Malformed → throws.
2. **Pick the right public key.** Reads `kid` from header → fetches Google's JWKS from `https://www.googleapis.com/oauth2/v3/certs` (cached per the `Cache-Control` TTL Google returns, usually hours) → picks the matching key.
3. **Verify the RS256 signature.** Uses Node's `crypto` to verify the signature against `header.payload`. Tamper → throws.
4. **Check `iss` claim.** Must be `https://accounts.google.com` or `accounts.google.com`.
5. **Check `aud` claim.** **This is the binding to our app.** Must equal `this.cfg.GOOGLE_CLIENT_ID`. A token minted for a different OAuth client (some other web app) won't match.
6. **Check `exp` claim.** Must be > now (small clock skew tolerance). ID tokens have ~1 h TTL, so stale tokens fail here.
7. **Check `iat` claim.** Must not be in the future. Stops clock-manipulation forgeries.
8. **Check `nbf` if present.** Same shape as iat.

Any failure → library throws → we re-wrap as `AuthError` (lines 25-27) → **HTTP 401**.

### c) Why we still grab `sub` ourselves (lines 28-31)
- `getPayload()` could return undefined on older library versions — defensive.
- `sub` is the **stable, immutable Google user ID** — we use it as the lookup key in `user_identities.provider_user_id`. Email can change; `sub` never does.

### d) The normalized return shape (lines 32-40)
The `ProviderIdentity` shape is provider-agnostic. Whether it's Google, Microsoft, or GitHub tomorrow, `auth.service.ts` only sees this shape.

Notable details:
- **`emailVerified: payload.email_verified === true`** — **strict equality**, not just truthy. A returned `"true"` string or `1` won't count. Critical because pt 6 gates email-linking on this flag.
- **`?? null`** instead of `?? undefined` — keeps the shape DB-friendly (TypeORM columns are nullable).
- **`raw: payload`** — full payload stored. Currently persisted to `user_identities.raw_profile` (JSON column) so future debugging or new claim usage doesn't require another sign-in.

### What's deliberately NOT here
- **No DB lookup.** Pure verification. `auth.service.ts` does the lookup in pt 6.
- **No nonce / PKCE check.** GIS button credential flow already binds via FedCM / SameSite browser context.
- **No revocation check.** ID tokens are short-lived (~1 h), so expiry handles staleness implicitly.
- **No refresh.** ID tokens aren't refreshable. We don't ask for OAuth refresh tokens because we switch to a cookie-session model from this point on.

### The 8 cryptographic guarantees, in plain English

| Check | Stops |
|---|---|
| Structure parse | "garbage string" |
| JWKS key match | "I made up my own RSA key" |
| RS256 signature | "I edited the email in the payload" |
| `iss == accounts.google.com` | "another provider tries to impersonate Google" |
| `aud == OUR_CLIENT_ID` | "token I got from another app/site works on yours" |
| `exp > now` | "I saved a token from yesterday and replayed it" |
| `iat <= now` | "I set my clock 10 years ahead to forge a long-lived token" |
| `sub` present | "tokenless identity" |

---

## Pt 6 — User reconciliation

> **Files:** `user_service/src/auth/auth.service.ts:28-67`, `user_service/src/users/users.service.ts`, `user_service/src/database/entities/user.entity.ts`, `user_service/src/database/entities/user-identity.entity.ts`

Now we have a verified `ProviderIdentity` from Google. Job: figure out **which** row in `users` should own this sign-in — find an existing one, link to one, or create a new one.

```ts
const existing = await this.users.findIdentity(
  identity.provider,
  identity.providerUserId,
);

let user: User;
if (existing) {
  const found = await this.users.findById(existing.userId);
  if (!found) throw new Error('orphaned identity ' + existing.id);
  user = await this.users.updateProfile(found.id, {
    name: identity.name,
    picture: identity.picture,
    email: identity.email,
  });
} else {
  let candidate: User | null = null;
  if (identity.email && identity.emailVerified) {
    candidate = await this.users.findByEmail(identity.email);
  }
  user = candidate
    ? await this.users.updateProfile(candidate.id, {
        name: identity.name,
        picture: identity.picture,
      })
    : await this.users.create({
        email: identity.email,
        name: identity.name,
        picture: identity.picture,
      });

  await this.users.createIdentity({
    userId: user.id,
    provider: identity.provider,
    providerUserId: identity.providerUserId,
    emailAtProvider: identity.email,
    rawProfile: identity.raw,
  });
}
```

### The reconciliation tree — 3 terminal outcomes

```
 verified Google identity (provider='google', sub='1xx...')
            │
            ▼
 SELECT * FROM user_identities WHERE provider='google' AND provider_user_id='1xx...'
            │
   ┌────────┴───────────┐
   │ HIT (existing row) │  → A. RETURNING USER
   └────────┬───────────┘     SELECT user by existing.userId → updateProfile → done
            │
   ┌────────┴───────────┐
   │ MISS                │
   └────────┬───────────┘
            │
   identity.email && emailVerified ?
   ┌────────┴───────────┐
   │ NO                  │  → C. BRAND-NEW USER
   │ (no email, or       │     create user (email may be null)
   │  unverified)        │     create identity row linking google→that user
   └────────┬───────────┘
   ┌────────┴───────────┐
   │ YES                 │
   │ → findByEmail()     │
   └────────┬───────────┘
            │
   ┌────────┴───────────┐
   │ HIT                 │  → B. ACCOUNT LINKING
   │ (some other         │     updateProfile on existing user
   │  identity already   │     create identity row linking google→that same user
   │  has this email)    │
   └─────────────────────┘
   ┌────────┴───────────┐
   │ MISS                │  → C. BRAND-NEW USER
   └─────────────────────┘
```

### Case A — Returning user (lines 34-41)
Most common path after the first login.

- `findIdentity` query: `SELECT * FROM user_identities WHERE provider=$1 AND provider_user_id=$2` (hits the `uniq_provider_user` index on `(provider, providerUserId)`).
- Fetches the linked user via `existing.userId`.
- **Orphan check** (line 36): if the identity row points at a user that no longer exists (FK `onDelete: 'CASCADE'` should prevent this), throw immediately. Defensive; should never happen.
- `updateProfile` (`users.service.ts:33-40`) is intentionally **gentle**:
  ```ts
  if (patch.name)    u.name    = patch.name;
  if (patch.picture) u.picture = patch.picture;
  if (patch.email && !u.email) u.email = patch.email;   // FILL-ONCE
  ```
  - Name + picture refresh every login.
  - **Email is fill-once.** Already set? Google can never overwrite it. Protects against an attacker who later changes their Google email to a victim's and tries to hijack the local row.

### Case B — Account linking by verified email (lines 45-53, 60-66)
First time **this Google account** logs in, but the email is already in our `users` table from another provider.

```ts
if (identity.email && identity.emailVerified) {
  candidate = await this.users.findByEmail(identity.email);
}
```

- Linking is **gated on `emailVerified === true`**. Critical security choice. Without this gate, anyone could create a Google account with `victim@example.com`, log in here, and silently merge into the victim's record.
- `findByEmail` uses the partial unique index on `users.email` (`user.entity.ts:18`):
  ```ts
  @Index({ unique: true, where: 'email IS NOT NULL' })
  ```
- On hit → `updateProfile` (without email — already set) → then `createIdentity` adds the google row alongside any existing identity rows for that user.
- Net effect: one `users` row can have multiple `user_identities` rows (e.g. one `google`, one `microsoft`). Multi-SSO linking, for free.

### Case C — Brand-new user (lines 54-58, 60-66)
Either: identity missing AND email missing/unverified, OR: identity missing AND email verified but no existing user with that email.

- `users.create` runs `INSERT INTO users` returning the new row with a fresh UUID.
- `createIdentity` runs `INSERT INTO user_identities` linking google → that new user.
- `rawProfile` stores the full Google payload as JSON-stringified text (`users.service.ts:58`) — useful for debugging without re-asking Google.
- `emailAtProvider` records what Google said at the time. The user's primary email on `users` could later diverge from this (Case A's fill-once rule).

### Why this design matters

| Design choice | Why |
|---|---|
| Identity key is `(provider, providerUserId)`, not email | Email can change; `sub` cannot. Stable join key. |
| DB-level unique constraint on `(provider, providerUserId)` | Concurrent first-time logins race; one wins, other errors. No duplicate identities possible. |
| Email-linking only when `email_verified === true` | Blocks "I made a Google account with your email" takeovers. |
| No password column anywhere | Authentication delegated entirely. Nothing secret to leak. |
| Email fill-once on update | An attacker can't later change their Google email to a victim's and hijack. |

### Known gotchas

| Scenario | Behavior |
|---|---|
| Two browsers, **first-ever login concurrently** | Both miss; both INSERT identity row; unique constraint kicks in; one wins, the other throws → 500. Race window ~10s. Could be fixed by catching the constraint error. Currently unhandled. |
| Two Google accounts with the **same verified email** | Both link to the same `users` row → multi-identity (Case B). |
| **Unverified** Google email | First login = new user (Case C). Subsequent = Case A. User is permanently de-linked from email-based accounts. |
| Google account **deleted then re-created** with same email | Different `sub` → no identity match → Case B if local email exists, else Case C. |

---

## Pt 7 — Session creation

> **Files:** `user_service/src/auth/auth.service.ts:69`, `user_service/src/sessions/sessions.service.ts`, `user_service/src/sessions/stores/{redis,db,memory}.store.ts`, `user_service/src/database/entities/session.entity.ts`

```ts
// auth.service.ts:69
const session = await this.sessions.create(user.id);
```

### The service is a thin proxy
```ts
// sessions.service.ts:13-15
create(userId: string): Promise<SessionRecord> {
  return this.store.create(userId, this.cfg.SESSION_TTL_SECONDS);
}
```
- `this.store` is whatever was bound to the `SESSION_STORE` DI token at boot, based on `cfg.SESSION_STORE` (`'redis' | 'db' | 'memory'`).
- The TTL is read from env (`SESSION_TTL_SECONDS`, default `604800` = 7 days).

### What gets created — the `SessionRecord`
```ts
interface SessionRecord {
  id: string;          // UUIDv4 from crypto.randomUUID()
  userId: string;
  expiresAt: string;   // ISO string
}
```

### Store-specific behavior

#### Redis store (`redis.store.ts:28-38`)
```ts
const id = randomUUID();
const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
await this.client
  .multi()
  .set(KEY(id), JSON.stringify({ id, userId, expiresAt }), 'EX', ttlSeconds)
  .sadd(USER_INDEX(userId), id)
  .expire(USER_INDEX(userId), ttlSeconds)
  .exec();
```
- Key shape: `sess:<uuid>` → JSON blob.
- Per-user index: `user_sessions:<userId>` → SET of session IDs. Lets `destroyForUser` revoke all sessions cheaply.
- `EX ttlSeconds` makes Redis **auto-evict** expired sessions. No janitor needed.
- All three commands in one `MULTI` so partial state is impossible.

#### DB store (`db.store.ts:14-19`)
```ts
const id = randomUUID();
const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
await this.repo.insert({ id, userId, expiresAt });
return { id, userId, expiresAt: expiresAt.toISOString() };
```
- Inserts a row into `sessions` table (`session.entity.ts`).
- Schema: `id (uuid PK), user_id (uuid, FK CASCADE), createdAt, expires_at (indexed)`.
- **No auto-eviction.** Rows accumulate until removed. `purgeExpired()` exists but has zero callers — a known cleanup gap.
- Read-side filter `MoreThan(new Date())` (`db.store.ts:22`) means expired rows behave as "not found" even before they're deleted, so the effective behavior matches Redis.

#### Memory store
Same shape; in-process Map. Lost on every restart. Only useful for tests / quickstart.

### Why a fresh session every login?
`sessions.create` is always called — `auth.service.ts:69` doesn't try to reuse an existing one. Implications:
- Session fixation is impossible — every new login gets a new ID.
- A user signing in on a 3rd browser doesn't kill their sessions on the first two (we'd need to call `destroyForUser` first if we wanted single-session-per-user).

### UUID strength
`crypto.randomUUID()` uses Node's CSPRNG, ~122 bits of randomness. Brute-forcing one valid session ID is astronomically unlikely.

---

## Pt 8 — Cookie set

> **File:** `user_service/src/auth/helpers/cookie.helper.ts:10-22`

Controller calls:
```ts
this.cookies.setSession(res, session.id);
```
Which expands to:
```ts
setSession(res: Response, sessionId: string) {
  res.cookie(this.cfg.SESSION_COOKIE_NAME, sessionId, this.opts());
}

private opts(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: this.cfg.SESSION_COOKIE_SECURE || this.cfg.isProd,
    maxAge: this.cfg.SESSION_TTL_SECONDS * 1000,
    path: '/',
  };
}
```

### Result: the `Set-Cookie` header
```
Set-Cookie: uid_session=<uuid>; Max-Age=604800; Path=/; HttpOnly; SameSite=Lax
```
(`Secure` is added in prod.)

### Why each option

| Option | What it does | Why |
|---|---|---|
| `httpOnly: true` | JS can't read `document.cookie` | XSS can't exfiltrate the session ID. |
| `sameSite: 'lax'` | Cookie sent on top-level GET navigations + same-site requests, NOT cross-site POST | Defends CSRF. Works for our UI because `localhost:5500` and `localhost:4000` are same-site (same registrable domain). |
| `secure: ...` | Cookie only sent over HTTPS | Must be `true` in prod, `false` allowed locally over HTTP. Driven by `SESSION_COOKIE_SECURE` or `isProd`. |
| `maxAge: TTL * 1000` | Browser deletes the cookie after this many ms | 7 days. Aligned with server-side TTL so the cookie and the store agree. |
| `path: '/'` | Cookie sent on every request to the origin | Needed because `/auth/logout` and `/api/me` are both under root. |

### What the cookie is NOT
- **No claims.** Just an opaque UUID. No name, no email, no roles. All of that is fetched server-side via the session lookup.
- **No signature.** It doesn't need one — the server-side lookup is the security boundary. A guessed/tampered UUID just misses the lookup → 401.
- **No JWT.** Not a self-contained credential. The browser can't validate it. Only the server can.

### Cookie lifecycle in the rest of the app
- **Reading** (`cookie.helper.ts:28-31`): `cookies.readSession(req)` returns `req.cookies['uid_session']` or `null`.
- **Clearing** (`cookie.helper.ts:24-26`): on logout, `res.clearCookie('uid_session', { maxAge: 0 })` instructs the browser to delete.

---

## Pt 9 — Response body

> **File:** `user_service/src/auth/auth.controller.ts:39-48`

```ts
return {
  user: {
    id: user.id,
    email: user.email,
    name: user.name,
    picture: user.picture,
    createdAt: user.createdAt,
  },
  session: { expiresAt: session.expiresAt },
};
```

### Shape sent to the UI
```json
{
  "user": {
    "id": "2fa164aa-a27a-45df-b7ab-1303fdbeefb7",
    "email": "testeremail1727@gmail.com",
    "name": "Tester Email",
    "picture": "https://lh3.googleusercontent.com/...",
    "createdAt": "2026-06-22T16:55:52.828Z"
  },
  "session": {
    "expiresAt": "2026-06-29T16:55:52.839Z"
  }
}
```

### Explicit security decisions

| What's NOT in the body | Why |
|---|---|
| `session.id` | Lives only in the HttpOnly cookie. JS can't exfiltrate it. |
| `user.identities` array | Provider-level metadata is internal. Use `/api/me/identities` if needed. |
| `raw_profile` | Original Google payload is internal-only. |
| Internal fields (`updatedAt`, etc.) | Stripped — explicit field-picking. |

The controller **manually picks fields** rather than returning `user` directly. This means a future entity change (e.g. adding a `passwordHash` column) cannot accidentally leak through this endpoint. A common alternative — returning the entity wholesale with `@Exclude()` decorators — is more fragile because someone can forget to mark a new sensitive column.

### Why `session.expiresAt` is included
- The client can show a "Sign in expires in N days" hint.
- No security value: the server is the source of truth. A malicious client can't extend it by editing this value.

### What the UI does next
1. UI receives the JSON. Currently it discards the body and immediately calls `refresh()` → `GET /api/me` (see `use-session.ts:53`).
2. The browser stores the cookie automatically (it's a normal `Set-Cookie` response).
3. `GET /api/me` rides on the cookie, returns the same user info, UI swaps to authenticated state.

We could short-circuit and use the body directly to save a round-trip, but going through `/api/me` keeps the "authenticated" code path identical to a returning user opening the tab cold.

---

## Validation cheat-sheet — every gate, in order

| # | Gate | Where | On failure |
|---|---|---|---|
| 1 | CORS origin allow-list | `main.ts:21-24` (see Appendix A) | Browser blocks JS from reading response |
| 2 | Rate limit (20/min/IP) | `auth.controller.ts:31` | 429 |
| 3 | DTO shape (`token` string ≥10) | `login.dto.ts` + global `ValidationPipe` (Appendix B) | 400 |
| 4 | `forbidNonWhitelisted` (no extra fields) | `main.ts:29` | 400 |
| 5 | Provider enabled | `auth.service.ts:21-24` | 400 (`ProviderNotEnabledError`) |
| 6 | JWT structure parseable | `google-auth-library` via `google.provider.ts:21` | 401 |
| 7 | JWKS key match (`kid`) | google-auth-library | 401 |
| 8 | RS256 signature | google-auth-library | 401 |
| 9 | `iss == accounts.google.com` | google-auth-library | 401 |
| 10 | `aud == OUR client_id` | `google.provider.ts:23` | 401 |
| 11 | `exp > now` | google-auth-library | 401 |
| 12 | `iat <= now` | google-auth-library | 401 |
| 13 | `sub` present | `google.provider.ts:29-31` | 401 |
| 14 | Email verified before auto-link | `auth.service.ts:46` | Falls back to new user (Case C) |
| 15 | Email fill-once on profile update | `users.service.ts:38` | Existing email preserved silently |
| 16 | `(provider, providerUserId)` unique | DB constraint, `user-identity.entity.ts:14` | 500 on concurrent first-login race |

The heaviest lifting is in **gates 6-12** — one library call (`OAuth2Client.verifyIdToken`) does them all.

---

## Appendix A — How `CORS_ORIGINS` whitelist is wired

### 1. Env declares the allowlist (`docker-compose.yml`)
```yaml
CORS_ORIGINS: http://localhost:5500,http://127.0.0.1:5500
```

### 2. Config parses CSV → list (`env.config.ts:62`)
```ts
CORS_ORIGINS: csv(env.CORS_ORIGINS),       // ['http://localhost:5500', 'http://127.0.0.1:5500']
```

### 3. Nest registers CORS once (`main.ts:21-24`)
```ts
app.enableCors({
  origin: cfg.CORS_ORIGINS,
  credentials: true,
});
```

### What the underlying `cors` middleware does per request
1. Reads the `Origin` header.
2. Strict `===` compares against each string in the array.
3. **Match** → adds:
   ```
   Access-Control-Allow-Origin: http://localhost:5500
   Access-Control-Allow-Credentials: true
   Vary: Origin
   ```
4. **No match** → response goes out without those headers.
5. `OPTIONS` preflights short-circuit before your controller.

### CORS is **browser-enforced**, not server-enforced
The server still processes the request and returns 200 even if the Origin is wrong. CORS controls only whether the **browser** lets JS *read* the response. Implications:
- `curl` works regardless of CORS — no `Origin` header.
- The UI at `http://localhost:5500` works because it matches.
- A page at `evil.com` could hit the API; the browser blocks JS from seeing the response.

### Why `credentials: true` matters
UI uses `fetch(..., { credentials: 'include' })` to send the `uid_session` cookie. If server says `credentials: false`, the browser silently drops the response. Both sides must opt in.

### Add a new origin
```yaml
CORS_ORIGINS: http://localhost:5500,http://127.0.0.1:5500,https://prod-domain.com
```
Then `docker compose up -d --force-recreate app`. Nothing else changes.

---

## Appendix B — How `ValidationPipe` is triggered

### 1. Global registration (`main.ts:26-32`)
```ts
app.useGlobalPipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }),
);
```
**One instance** runs on every parameter of every route in every controller.

### 2. The hidden bridge — `reflect-metadata` + `emitDecoratorMetadata`
TypeScript types are erased at runtime. So how does the pipe know `LoginDto` exists?

- **`tsconfig.app.json`** has `"emitDecoratorMetadata": true` → for every decorated parameter, TS emits a runtime metadata key `design:paramtypes = [LoginDto, ...]`.
- **`main.ts:1`** `import 'reflect-metadata'` → installs `Reflect.getMetadata(...)`.

Together, `@Body() body: LoginDto` becomes runtime-readable metadata on the controller method.

### 3. Per-request, per-param dispatch
Nest's request lifecycle:
```
1. Express middleware (helmet, cookie-parser, body parser, CORS)
2. Guards
3. Interceptors
4. PIPES                ← ValidationPipe runs here, per parameter
5. Route handler
```

Pseudocode of what `ValidationPipe.transform` does internally:
```ts
async transform(value, { metatype, type }) {
  if (!metatype || isPrimitive(metatype)) return value;        // (a)
  const instance = plainToInstance(metatype, value);           // (b)
  const errors = await validate(instance);                     // (c)
  if (errors.length) throw new BadRequestException(errors);    // (d)
  return this.options.transform ? instance : value;            // (e)
}
```

For our login body `{ token: "eyJ..." }`:
- `metatype` = `LoginDto` (from `design:paramtypes`).
- `plainToInstance(LoginDto, { token })` → real `LoginDto` instance.
- `validate(...)` runs `@IsString()` and `@MinLength(10)`.
- All pass → handler receives the instance as `body`.

### Option flags

| Option | When it fires | Effect |
|---|---|---|
| `whitelist: true` | During `plainToInstance` | Strips unknown fields silently |
| `forbidNonWhitelisted: true` | During `validate` | Throws 400 if unknown fields present |
| `transform: true` | At the end | Replaces plain object with class instance; coerces `@Param`/`@Query` strings to declared primitive types |

### Examples

```json
{ "token": "eyJhbGc...", "isAdmin": true }
```
→ 400 `"property isAdmin should not exist"` (`forbidNonWhitelisted`).

```json
{ "token": "abc" }
```
→ 400 `"token is required"` (custom `MinLength` message).

### What does NOT trigger it
- Parameters typed as primitives: `@Query('limit') limit: number` — coerced only.
- Parameters with no type: `@Body() body` — no-op.
- Body-less requests (GET).

---

## Appendix C — How providers are registered at boot

### 1. Contract (`interfaces/identity-provider.interface.ts`)
```ts
interface IIdentityProvider {
  readonly name: string;
  verify(token: string): Promise<ProviderIdentity>;
}
```

### 2. Implementation (`google/google.provider.ts`)
```ts
@Injectable()
export class GoogleProvider implements IIdentityProvider {
  public readonly name = 'google';
  private readonly client: OAuth2Client;
  constructor(@Inject(APP_CONFIG) cfg: AppConfig) {
    this.client = new OAuth2Client(cfg.GOOGLE_CLIENT_ID);
  }
  async verify(idToken: string): Promise<ProviderIdentity> { /* pt 5 */ }
}
```

### 3. Known implementations array (`providers.module.ts:12-16`)
```ts
const ALL_PROVIDERS: Provider[] = [
  GoogleProvider,
  // MicrosoftProvider,
  // GithubProvider,
];
```
Class references (not instances). `Provider` is Nest's DI type — accepts the class shorthand we use, or full `{ provide, useClass }` objects.

### 4. Env-driven filter (`providers.module.ts:19-24`)
```ts
const providersAggregate: Provider = {
  provide: IDENTITY_PROVIDERS,
  useFactory: (cfg, ...instances) =>
    instances.filter((p) => cfg.ENABLED_PROVIDERS.includes(p.name)),
  inject: [APP_CONFIG, ...ALL_PROVIDERS] as any[],
};
```
Nest instantiates each `ALL_PROVIDERS` class, hands the instances to the factory along with `cfg`, factory returns the filtered subset under the `IDENTITY_PROVIDERS` symbol.

### 5. Map for O(1) lookup (`providers.service.ts:9-11`)
```ts
constructor(@Inject(IDENTITY_PROVIDERS) providers: IIdentityProvider[]) {
  for (const p of providers) this.map.set(p.name, p);
}
```

### 6. Lookup at request time (pt 4)
```ts
const provider = this.providers.get(providerName);
```

### Boot-time order
```
1. dotenv → process.env
2. loadConfig() → AppConfig (validates GOOGLE_CLIENT_ID exists)
3. NestFactory.create()
4. ProvidersModule instantiates GoogleProvider (constructor builds OAuth2Client)
5. providersAggregate factory runs → [googleInstance]
6. ProvidersService ctor → Map { 'google' → googleInstance }
7. app.listen(4000)
```

After boot, registration is **frozen**. Runtime requests just hit the Map.

### Adding a new provider
1. Drop `src/providers/microsoft/microsoft.provider.ts` implementing `IIdentityProvider` with `name = 'microsoft'`.
2. Add `MicrosoftProvider` to `ALL_PROVIDERS` in `providers.module.ts`.
3. Set env `ENABLED_PROVIDERS=google,microsoft`.

Zero changes to `AuthService`, `AuthController`, controllers, or DB code.
