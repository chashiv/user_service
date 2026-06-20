import { Module } from '@nestjs/common';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { APP_CONFIG } from './common/constants';
import { AppConfigModule, AppConfig } from './config';
import { DatabaseModule } from './database';
import { SessionsModule } from './sessions';
import { ProvidersModule } from './providers';
import { UsersModule } from './users';
import { AuthModule } from './auth';
import { HealthModule } from './health';

@Module({
  imports: [
    AppConfigModule,
    LoggerModule.forRootAsync({
      imports: [AppConfigModule],
      inject: [APP_CONFIG],
      useFactory: (cfg: AppConfig) => ({
        pinoHttp: {
          level: cfg.LOG_LEVEL,
          transport: cfg.isProd
            ? undefined
            : { target: 'pino-pretty', options: { colorize: true, singleLine: true } },
        },
      }),
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    DatabaseModule,
    SessionsModule.forRoot(),
    ProvidersModule,
    UsersModule,
    AuthModule,
    HealthModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
