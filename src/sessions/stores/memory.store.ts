import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ISessionStore, SessionRecord } from '../interfaces';

interface InternalSession {
  id: string;
  userId: string;
  expiresAt: number;
}

@Injectable()
export class MemorySessionStore implements ISessionStore {
  private readonly sessions = new Map<string, InternalSession>();

  async create(userId: string, ttlSeconds: number): Promise<SessionRecord> {
    const id = randomUUID();
    const expiresAt = Date.now() + ttlSeconds * 1000;
    this.sessions.set(id, { id, userId, expiresAt });
    return { id, userId, expiresAt: new Date(expiresAt).toISOString() };
  }

  async get(id: string): Promise<SessionRecord | null> {
    const s = this.sessions.get(id);
    if (!s) return null;
    if (s.expiresAt <= Date.now()) {
      this.sessions.delete(id);
      return null;
    }
    return { id: s.id, userId: s.userId, expiresAt: new Date(s.expiresAt).toISOString() };
  }

  async destroy(id: string): Promise<void> {
    this.sessions.delete(id);
  }

  async destroyForUser(userId: string): Promise<void> {
    for (const [k, v] of this.sessions) {
      if (v.userId === userId) this.sessions.delete(k);
    }
  }
}
