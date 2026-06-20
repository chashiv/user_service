export interface SessionRecord {
  id: string;
  userId: string;
  expiresAt: string;
}

export interface ISessionStore {
  create(userId: string, ttlSeconds: number): Promise<SessionRecord>;
  get(id: string): Promise<SessionRecord | null>;
  destroy(id: string): Promise<void>;
  destroyForUser(userId: string): Promise<void>;
}
