import { z } from 'zod';

const csv = (val: string | undefined) =>
  String(val ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.string().default('info'),

  CORS_ORIGINS: z.string().default('http://localhost:5500'),

  DB_DRIVER: z.enum(['sqlite', 'postgres']).default('sqlite'),
  DB_URL: z.string().default('./data/users.db'),
  DB_SYNCHRONIZE: z
    .union([z.literal('true'), z.literal('false')])
    .default('true')
    .transform((v) => v === 'true'),

  SESSION_STORE: z.enum(['memory', 'redis', 'db']).default('memory'),
  REDIS_URL: z.string().optional(),

  SESSION_COOKIE_NAME: z.string().default('uid_session'),
  SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(60 * 60 * 24 * 7),
  SESSION_COOKIE_SECURE: z
    .union([z.literal('true'), z.literal('false')])
    .default('false')
    .transform((v) => v === 'true'),

  ENABLED_PROVIDERS: z.string().default('google'),
  GOOGLE_CLIENT_ID: z.string().optional(),
});

export type RawEnv = z.infer<typeof schema>;
export type AppConfig = Omit<RawEnv, 'CORS_ORIGINS' | 'ENABLED_PROVIDERS'> & {
  CORS_ORIGINS: string[];
  ENABLED_PROVIDERS: string[];
  isProd: boolean;
};

export function loadConfig(raw: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.flatten().fieldErrors;
    throw new Error('Invalid env: ' + JSON.stringify(issues));
  }
  const env = parsed.data;
  const enabledProviders = csv(env.ENABLED_PROVIDERS);

  if (enabledProviders.includes('google') && !env.GOOGLE_CLIENT_ID) {
    throw new Error("GOOGLE_CLIENT_ID is required when 'google' is in ENABLED_PROVIDERS");
  }
  if (env.SESSION_STORE === 'redis' && !env.REDIS_URL) {
    throw new Error('REDIS_URL is required when SESSION_STORE=redis');
  }

  return {
    ...env,
    CORS_ORIGINS: csv(env.CORS_ORIGINS),
    ENABLED_PROVIDERS: enabledProviders,
    isProd: env.NODE_ENV === 'production',
  };
}
