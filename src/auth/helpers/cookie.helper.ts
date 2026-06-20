import { Inject, Injectable } from '@nestjs/common';
import { CookieOptions, Request, Response } from 'express';
import { APP_CONFIG } from '../../common/constants';
import { AppConfig } from '../../config/env.config';

@Injectable()
export class CookieHelper {
  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {}

  private opts(): CookieOptions {
    return {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.cfg.SESSION_COOKIE_SECURE || this.cfg.isProd,
      maxAge: this.cfg.SESSION_TTL_SECONDS * 1000,
      path: '/',
    };
  }

  setSession(res: Response, sessionId: string) {
    res.cookie(this.cfg.SESSION_COOKIE_NAME, sessionId, this.opts());
  }

  clearSession(res: Response) {
    res.clearCookie(this.cfg.SESSION_COOKIE_NAME, { ...this.opts(), maxAge: 0 });
  }

  readSession(req: Request): string | null {
    const c = (req as any).cookies as Record<string, string> | undefined;
    return (c && c[this.cfg.SESSION_COOKIE_NAME]) || null;
  }
}
