import { Module } from '@nestjs/common';
import { TypeOrmModule, TypeOrmModuleOptions } from '@nestjs/typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { APP_CONFIG } from '../common/constants';
import { AppConfigModule, AppConfig } from '../config';
import { User, UserIdentity, Session } from './entities';

function buildTypeOrmOptions(cfg: AppConfig): TypeOrmModuleOptions {
  const entities = [User, UserIdentity, Session];
  const common = {
    entities,
    synchronize: cfg.DB_SYNCHRONIZE,
    autoLoadEntities: true,
  };

  if (cfg.DB_DRIVER === 'sqlite') {
    const dir = path.dirname(path.resolve(cfg.DB_URL));
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return {
      type: 'better-sqlite3',
      database: cfg.DB_URL,
      ...common,
    };
  }

  return {
    type: 'postgres',
    url: cfg.DB_URL,
    ...common,
  };
}

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [AppConfigModule],
      inject: [APP_CONFIG],
      useFactory: (cfg: AppConfig) => buildTypeOrmOptions(cfg),
    }),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
