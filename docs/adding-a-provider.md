# Adding a new identity provider

Adding Microsoft, GitHub, Apple, or any other OAuth/OIDC provider is three small
steps. No controller, service, or DB schema changes needed.

## 1. Implement `IIdentityProvider`

Create `src/providers/<name>/<name>.provider.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { ConfidentialClientApplication } from '@azure/msal-node';
import { APP_CONFIG } from '../../common/constants';
import { AuthError } from '../../common/errors';
import { AppConfig } from '../../config/env.config';
import { IIdentityProvider, ProviderIdentity } from '../interfaces';

@Injectable()
export class MicrosoftProvider implements IIdentityProvider {
  public readonly name = 'microsoft';

  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {}

  async verify(idToken: string): Promise<ProviderIdentity> {
    // 1. Verify signature against Microsoft's JWKS
    // 2. Validate iss + aud + exp
    // 3. Map claims into ProviderIdentity
    if (!idToken) throw new AuthError('Missing Microsoft ID token');
    // ... your verification logic ...
    return {
      provider: 'microsoft',
      providerUserId: '<sub claim>',
      email: '<email claim>',
      emailVerified: true,
      name: '<name claim>',
      picture: null,
      raw: { /* full claims */ },
    };
  }
}
```

Add a barrel `src/providers/microsoft/index.ts`:

```ts
export * from './microsoft.provider';
```

## 2. Register it

In `src/providers/providers.module.ts`, add to `ALL_PROVIDERS`:

```ts
import { MicrosoftProvider } from './microsoft';

const ALL_PROVIDERS: Provider[] = [
  GoogleProvider,
  MicrosoftProvider,   // ← added
];
```

## 3. Enable it via env

```dotenv
ENABLED_PROVIDERS=google,microsoft
MICROSOFT_TENANT=common
MICROSOFT_CLIENT_ID=your-app-id
```

If you add new env vars, add them to `src/config/env.config.ts` and put a
cross-field validation in `loadConfig()` (mirror the existing
`GOOGLE_CLIENT_ID` check).

That's it — the new endpoint is automatically `POST /auth/microsoft/login` and
`GET /auth/providers` now returns `{ enabled: ['google', 'microsoft'] }`.
