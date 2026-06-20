import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, UserIdentity } from '../database/entities';

interface UpsertInput {
  email: string | null;
  name: string | null;
  picture: string | null;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(UserIdentity) private readonly identities: Repository<UserIdentity>,
  ) {}

  findById(id: string): Promise<User | null> {
    return this.users.findOne({ where: { id } });
  }

  findByEmail(email: string): Promise<User | null> {
    if (!email) return Promise.resolve(null);
    return this.users.findOne({ where: { email } });
  }

  async create(input: UpsertInput): Promise<User> {
    const user = this.users.create(input);
    return this.users.save(user);
  }

  async updateProfile(id: string, patch: Partial<UpsertInput>): Promise<User> {
    const u = await this.findById(id);
    if (!u) throw new Error('user not found: ' + id);
    if (patch.name)    u.name    = patch.name;
    if (patch.picture) u.picture = patch.picture;
    if (patch.email && !u.email) u.email = patch.email;
    return this.users.save(u);
  }

  findIdentity(provider: string, providerUserId: string) {
    return this.identities.findOne({ where: { provider, providerUserId } });
  }

  async createIdentity(input: {
    userId: string;
    provider: string;
    providerUserId: string;
    emailAtProvider: string | null;
    rawProfile: Record<string, unknown>;
  }): Promise<UserIdentity> {
    const id = this.identities.create({
      userId: input.userId,
      provider: input.provider,
      providerUserId: input.providerUserId,
      emailAtProvider: input.emailAtProvider,
      rawProfile: JSON.stringify(input.rawProfile),
    });
    return this.identities.save(id);
  }

  listIdentities(userId: string) {
    return this.identities.find({
      where: { userId },
      order: { createdAt: 'ASC' },
      select: ['id', 'provider', 'providerUserId', 'emailAtProvider', 'createdAt'],
    });
  }
}
