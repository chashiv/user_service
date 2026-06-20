import { HttpException } from '@nestjs/common';

export class AuthError extends HttpException {
  constructor(message: string, public readonly code = 'auth_failed') {
    super({ error: code, message }, 401);
  }
}

export class ProviderNotEnabledError extends HttpException {
  constructor(provider: string, enabled: string[]) {
    super(
      {
        error: 'provider_not_enabled',
        message: `Provider '${provider}' is not enabled`,
        enabled,
      },
      404,
    );
  }
}
