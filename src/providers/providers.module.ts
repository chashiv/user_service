import { Module, Provider } from '@nestjs/common';
import { APP_CONFIG, IDENTITY_PROVIDERS } from '../common/constants';
import { AppConfigModule, AppConfig } from '../config';
import { GoogleProvider } from './google';
import { IIdentityProvider } from './interfaces';
import { ProvidersService } from './providers.service';

// Registry of every implementation. When you add a new provider:
//   1. Drop it in src/providers/<name>/<name>.provider.ts
//   2. Implement IIdentityProvider with `name = "<name>"`
//   3. Add it here and (optionally) make it conditional on ENABLED_PROVIDERS
const ALL_PROVIDERS: Provider[] = [
  GoogleProvider,
  // MicrosoftProvider,
  // GithubProvider,
];

// Aggregate enabled providers into one array under the IDENTITY_PROVIDERS token.
const providersAggregate: Provider = {
  provide: IDENTITY_PROVIDERS,
  useFactory: (cfg: AppConfig, ...instances: IIdentityProvider[]) =>
    instances.filter((p) => cfg.ENABLED_PROVIDERS.includes(p.name)),
  inject: [APP_CONFIG, ...ALL_PROVIDERS] as any[],
};

@Module({
  imports: [AppConfigModule],
  providers: [...ALL_PROVIDERS, providersAggregate, ProvidersService],
  exports: [ProvidersService],
})
export class ProvidersModule {}
