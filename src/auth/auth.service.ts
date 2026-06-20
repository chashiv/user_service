import { Injectable } from '@nestjs/common';
import { ProviderNotEnabledError } from '../common/errors';
import { User } from '../database/entities';
import { ProvidersService } from '../providers';
import { SessionsService } from '../sessions';
import { SessionRecord } from '../sessions/interfaces';
import { UsersService } from '../users';

@Injectable()
export class AuthService {
  constructor(
    private readonly providers: ProvidersService,
    private readonly users: UsersService,
    private readonly sessions: SessionsService,
  ) {}

  async loginWithProvider(
    providerName: string,
    token: string,
  ): Promise<{ user: User; session: SessionRecord }> {
    const provider = this.providers.get(providerName);
    if (!provider) {
      throw new ProviderNotEnabledError(providerName, this.providers.names());
    }

    const identity = await provider.verify(token);

    const existing = await this.users.findIdentity(
      identity.provider,
      identity.providerUserId,
    );

    let user: User;
    if (existing) {
      const found = await this.users.findById(existing.userId);
      if (!found) throw new Error('orphaned identity ' + existing.id);
      user = await this.users.updateProfile(found.id, {
        name: identity.name,
        picture: identity.picture,
        email: identity.email,
      });
    } else {
      // No identity row. If a verified email matches an existing user, link to them.
      // Otherwise create a fresh user.
      let candidate: User | null = null;
      if (identity.email && identity.emailVerified) {
        candidate = await this.users.findByEmail(identity.email);
      }
      user = candidate
        ? await this.users.updateProfile(candidate.id, {
            name: identity.name,
            picture: identity.picture,
          })
        : await this.users.create({
            email: identity.email,
            name: identity.name,
            picture: identity.picture,
          });

      await this.users.createIdentity({
        userId: user.id,
        provider: identity.provider,
        providerUserId: identity.providerUserId,
        emailAtProvider: identity.email,
        rawProfile: identity.raw,
      });
    }

    const session = await this.sessions.create(user.id);
    return { user, session };
  }

  logout(sessionId: string | null) {
    if (!sessionId) return Promise.resolve();
    return this.sessions.destroy(sessionId);
  }
}
