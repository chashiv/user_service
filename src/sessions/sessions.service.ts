import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, SESSION_STORE } from '../common/constants';
import { AppConfig } from '../config/env.config';
import { ISessionStore, SessionRecord } from './interfaces';

@Injectable()
export class SessionsService {
  constructor(
    @Inject(SESSION_STORE) private readonly store: ISessionStore,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  create(userId: string): Promise<SessionRecord> {
    return this.store.create(userId, this.cfg.SESSION_TTL_SECONDS);
  }

  get(id: string): Promise<SessionRecord | null> {
    return this.store.get(id);
  }

  destroy(id: string): Promise<void> {
    return this.store.destroy(id);
  }

  destroyForUser(userId: string): Promise<void> {
    return this.store.destroyForUser(userId);
  }
}
