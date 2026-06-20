import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { APP_CONFIG } from './common/constants';
import { AllExceptionsFilter } from './common/filters';
import { AppConfig } from './config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.useLogger(app.get(Logger));
  const cfg = app.get<AppConfig>(APP_CONFIG);

  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({
    origin: cfg.CORS_ORIGINS,
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  app.enableShutdownHooks();

  await app.listen(cfg.PORT);
  app.get(Logger).log(
    { port: cfg.PORT, db: cfg.DB_DRIVER, sessions: cfg.SESSION_STORE, providers: cfg.ENABLED_PROVIDERS },
    `user_service listening on :${cfg.PORT}`,
  );
}

bootstrap();
