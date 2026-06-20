export interface ProviderIdentity {
  provider: string;
  providerUserId: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
  raw: Record<string, unknown>;
}

export interface IIdentityProvider {
  readonly name: string;
  verify(token: string): Promise<ProviderIdentity>;
}
