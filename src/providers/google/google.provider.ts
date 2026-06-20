import { Inject, Injectable } from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';
import { APP_CONFIG } from '../../common/constants';
import { AuthError } from '../../common/errors';
import { AppConfig } from '../../config/env.config';
import { IIdentityProvider, ProviderIdentity } from '../interfaces';

@Injectable()
export class GoogleProvider implements IIdentityProvider {
  public readonly name = 'google';
  private readonly client: OAuth2Client;

  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {
    this.client = new OAuth2Client(cfg.GOOGLE_CLIENT_ID);
  }

  async verify(idToken: string): Promise<ProviderIdentity> {
    if (!idToken) throw new AuthError('Missing Google ID token');
    let ticket;
    try {
      ticket = await this.client.verifyIdToken({
        idToken,
        audience: this.cfg.GOOGLE_CLIENT_ID,
      });
    } catch (err) {
      throw new AuthError('Invalid Google ID token: ' + (err as Error).message);
    }
    const payload = ticket.getPayload();
    if (!payload || !payload.sub) {
      throw new AuthError("Google token missing 'sub' claim");
    }
    return {
      provider: 'google',
      providerUserId: payload.sub,
      email: payload.email ?? null,
      emailVerified: payload.email_verified === true,
      name: payload.name ?? null,
      picture: payload.picture ?? null,
      raw: payload as unknown as Record<string, unknown>,
    };
  }
}
