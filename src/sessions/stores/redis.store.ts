import { Inject, Injectable, OnModuleDestroy, OnModuleInit, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { APP_CONFIG } from '../../common/constants';
import { AppConfig } from '../../config/env.config';
import { ISessionStore, SessionRecord } from '../interfaces';

const KEY = (id: string) => `sess:${id}`;
const USER_INDEX = (userId: string) => `user_sessions:${userId}`;

@Injectable()
export class RedisSessionStore implements ISessionStore, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisSessionStore.name);
  private client!: Redis;

  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {}

  async onModuleInit() {
    this.client = new Redis(this.cfg.REDIS_URL!, { lazyConnect: true });
    await this.client.connect();
    this.logger.log('connected to redis');
  }

  async onModuleDestroy() {
    if (this.client) await this.client.quit();
  }

  async create(userId: string, ttlSeconds: number): Promise<SessionRecord> {
    const id = randomUUID();
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    await this.client
      .multi()
      .set(KEY(id), JSON.stringify({ id, userId, expiresAt }), 'EX', ttlSeconds)
      .sadd(USER_INDEX(userId), id)
      .expire(USER_INDEX(userId), ttlSeconds)
      .exec();
    return { id, userId, expiresAt };
  }

  async get(id: string): Promise<SessionRecord | null> {
    const raw = await this.client.get(KEY(id));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as SessionRecord;
    } catch {
      return null;
    }
  }

  async destroy(id: string): Promise<void> {
    const s = await this.get(id);
    await this.client.del(KEY(id));
    if (s) await this.client.srem(USER_INDEX(s.userId), id);
  }

  async destroyForUser(userId: string): Promise<void> {
    const ids = await this.client.smembers(USER_INDEX(userId));
    if (ids.length) await this.client.del(...ids.map(KEY));
    await this.client.del(USER_INDEX(userId));
  }
}
