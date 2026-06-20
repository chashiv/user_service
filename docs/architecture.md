# Architecture

High-level layout of `user_service`. For the API surface and env vars, see the root
`README.md`.

```
                      ┌────────────────┐
                      │  Frontend (SSO │
                      │ button, fetch) │
                      └───────┬────────┘
                              │ cookie + JSON
                              ▼
        ┌─────────────────────────────────────────────────┐
        │                  user_service                    │
        │ ┌─────────────┐   ┌─────────────┐  ┌──────────┐ │
        │ │AuthController│──▶│AuthService │──▶│Providers │ │
        │ │MeController  │   │            │   │ Service  │ │
        │ └─────────────┘   └──────┬──────┘  └────┬─────┘ │
        │                          │              │       │
        │              ┌───────────┴──┐    ┌──────┴────┐  │
        │              │UsersService  │    │Google     │  │
        │              │              │    │Provider   │  │
        │              └──────┬───────┘    └───────────┘  │
        │                     │                            │
        │              ┌──────┴─────┐                      │
        │              │TypeORM     │                      │
        │              │entities    │                      │
        │              └──────┬─────┘                      │
        │                     │                            │
        └─────────────────────┼────────────────────────────┘
                  ┌───────────┴────────────┐
                  ▼                        ▼
            SQLite / Postgres        Sessions store
                                     (Memory / Redis / DB)
```

## Module boundaries

| Module       | Owns                                            | Depends on            |
|--------------|-------------------------------------------------|------------------------|
| `config`     | Env parsing + `APP_CONFIG` token                | —                      |
| `common`     | DI tokens, errors, filters, decorators          | —                      |
| `database`   | TypeORM connection + entities                   | `config`               |
| `users`      | User + UserIdentity repositories                | `database`             |
| `sessions`   | Session store abstraction + 3 implementations   | `config`, `database`*  |
| `providers`  | `IIdentityProvider` registry + Google impl      | `config`, `common`     |
| `auth`       | Controllers, guards, cookie helper, orchestrator| `providers`, `users`, `sessions` (global) |
| `health`     | `/health` + `/ready`                            | `database`             |

\* The DB session store needs the `Session` entity; the memory and redis stores
don't touch the database at all.

## Key design choices

1. **`SessionsModule.forRoot()` is a dynamic + global module.** It reads
   `SESSION_STORE` at boot and instantiates *only* the chosen store class —
   so when `SESSION_STORE=memory`, the Redis client never tries to connect.

2. **Provider registry uses multi-injection.** `providers.module.ts` enumerates
   every implementation in `ALL_PROVIDERS`, then injects them all into a single
   `IDENTITY_PROVIDERS` token through a factory that filters by
   `ENABLED_PROVIDERS`. `ProvidersService` exposes a `Map<name, impl>`.

3. **Auto-link by verified email.** When a new `(provider, providerUserId)`
   pair lands but its `email_verified === true` email matches an existing user,
   `AuthService` links the new identity to that user instead of creating a
   duplicate. Prevents the classic "I have two accounts now" footgun.

4. **`SessionGuard` is a stateless `CanActivate`.** It reads the cookie, looks
   up the session, hydrates `req.user`. Decorating any handler with
   `@UseGuards(SessionGuard)` makes it authenticated.

5. **Global `AllExceptionsFilter` + typed `HttpException`s.** Domain errors
   (`AuthError`, `ProviderNotEnabledError`) carry their own status + JSON body;
   the filter just routes them. Unknown exceptions become `500 internal_error`
   and get logged.
