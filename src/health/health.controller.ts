import { Controller, Get, Inject } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SkipThrottle } from '@nestjs/throttler';
import { APP_CONFIG } from '../common/constants';
import { AppConfig } from '../config/env.config';

@Controller()
@SkipThrottle()
export class HealthController {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  @Get('health')
  health() {
    return { ok: true };
  }

  @Get('ready')
  async ready() {
    try {
      await this.ds.query('SELECT 1');
      return {
        ok: true,
        db: this.cfg.DB_DRIVER,
        sessions: this.cfg.SESSION_STORE,
        providers: this.cfg.ENABLED_PROVIDERS,
      };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }
}
