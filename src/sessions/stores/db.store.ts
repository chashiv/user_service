import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { LessThan, MoreThan, Repository } from 'typeorm';
import { Session } from '../../database/entities';
import { ISessionStore, SessionRecord } from '../interfaces';

@Injectable()
export class DbSessionStore implements ISessionStore {
  constructor(
    @InjectRepository(Session) private readonly repo: Repository<Session>,
  ) {}

  async create(userId: string, ttlSeconds: number): Promise<SessionRecord> {
    const id = randomUUID();
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    await this.repo.insert({ id, userId, expiresAt });
    return { id, userId, expiresAt: expiresAt.toISOString() };
  }

  async get(id: string): Promise<SessionRecord | null> {
    const s = await this.repo.findOne({ where: { id, expiresAt: MoreThan(new Date()) } });
    if (!s) return null;
    return { id: s.id, userId: s.userId, expiresAt: s.expiresAt.toISOString() };
  }

  async destroy(id: string): Promise<void> {
    await this.repo.delete({ id });
  }

  async destroyForUser(userId: string): Promise<void> {
    await this.repo.delete({ userId });
  }

  async purgeExpired(): Promise<void> {
    await this.repo.delete({ expiresAt: LessThan(new Date()) });
  }
}
