// Central registry of Nest DI tokens. Keeping every Symbol() here means there's
// exactly one canonical reference per token — accidental "second symbol with the
// same description" bugs become impossible, and IDEs can show every consumer.

export const APP_CONFIG = Symbol('APP_CONFIG');
export const IDENTITY_PROVIDERS = Symbol('IDENTITY_PROVIDERS');
export const SESSION_STORE = Symbol('SESSION_STORE');
