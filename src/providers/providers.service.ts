import { Inject, Injectable } from '@nestjs/common';
import { IDENTITY_PROVIDERS } from '../common/constants';
import { IIdentityProvider } from './interfaces';

@Injectable()
export class ProvidersService {
  private readonly map = new Map<string, IIdentityProvider>();

  constructor(@Inject(IDENTITY_PROVIDERS) providers: IIdentityProvider[]) {
    for (const p of providers) this.map.set(p.name, p);
  }

  get(name: string): IIdentityProvider | null {
    return this.map.get(name) ?? null;
  }

  has(name: string): boolean {
    return this.map.has(name);
  }

  names(): string[] {
    return [...this.map.keys()];
  }
}
