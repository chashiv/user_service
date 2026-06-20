import { Module, Global } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_CONFIG } from '../common/constants';
import { loadConfig, AppConfig } from './env.config';

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: false,
      cache: true,
      load: [() => ({ APP: loadConfig() })],
    }),
  ],
  providers: [
    {
      provide: APP_CONFIG,
      useFactory: (cs: ConfigService): AppConfig => cs.get<AppConfig>('APP')!,
      inject: [ConfigService],
    },
  ],
  exports: [APP_CONFIG],
})
export class AppConfigModule {}
