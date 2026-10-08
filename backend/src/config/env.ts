import { z } from 'zod';
export type Config = {
  port: number;
  databaseUrl: string;
  allowedOrigin: string;
  signingKey: Uint8Array;
  issuer: string;
  audience: string;
  ttlSeconds: number;
  secureCookies: boolean;
  authServiceKey?: string;
  googleClientId?: string;
  google?: { clientId: string; clientSecret: string; redirectUri: string };
};
export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const schema = z.object({
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    DATABASE_URL: z.url().refine((v) => /^postgres(?:ql)?:\/\//.test(v)),
    ALLOWED_ORIGIN: z.url().default('http://localhost:3000'),
    JWT_SIGNING_KEY_BASE64: z
      .string()
      .regex(/^[A-Za-z0-9+/]+={0,2}$/)
      .refine(
        (v) =>
          Buffer.from(v, 'base64').length >= 32 &&
          Buffer.from(v, 'base64').toString('base64') === v,
      ),
    JWT_ISSUER: z.literal('urn:meeting-manager:local').default('urn:meeting-manager:local'),
    JWT_AUDIENCE: z.literal('urn:meeting-manager:api').default('urn:meeting-manager:api'),
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
    COOKIE_SECURE: z.enum(['true', 'false']).default('false'),
    AUTH_SERVICE_KEY: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().min(32).max(1024).optional(),
    ),
  });
  const result = schema.safeParse(env);
  if (!result.success)
    throw new Error(
      'Invalid configuration keys: ' +
        [...new Set(result.error.issues.map((i) => i.path[0]))].join(', '),
    );
  const e = result.data;
  const origin = new URL(e.ALLOWED_ORIGIN);
  if (origin.origin !== e.ALLOWED_ORIGIN || !['http:', 'https:'].includes(origin.protocol))
    throw new Error('Invalid configuration keys: ALLOWED_ORIGIN');
  if (origin.protocol === 'https:' && e.COOKIE_SECURE !== 'true')
    throw new Error('Invalid configuration keys: COOKIE_SECURE');
  if (e.COOKIE_SECURE === 'false' && origin.hostname !== 'localhost')
    throw new Error('Invalid configuration keys: COOKIE_SECURE');
  let google: Config['google'];
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REDIRECT_URI) {
    try {
      const redirect = new URL(env.GOOGLE_REDIRECT_URI);
      if (
        redirect.origin === e.ALLOWED_ORIGIN &&
        redirect.pathname === '/auth/google/callback' &&
        !redirect.search &&
        !redirect.hash
      ) {
        google = {
          clientId: env.GOOGLE_CLIENT_ID,
          clientSecret: env.GOOGLE_CLIENT_SECRET,
          redirectUri: env.GOOGLE_REDIRECT_URI,
        };
      }
    } catch {
      /* Google unavailable; password path stays available. */
    }
  }
  return {
    port: e.PORT,
    databaseUrl: e.DATABASE_URL,
    allowedOrigin: e.ALLOWED_ORIGIN,
    signingKey: Buffer.from(e.JWT_SIGNING_KEY_BASE64, 'base64'),
    issuer: e.JWT_ISSUER,
    audience: e.JWT_AUDIENCE,
    ttlSeconds: e.JWT_ACCESS_TTL_SECONDS,
    secureCookies: e.COOKIE_SECURE === 'true',
    authServiceKey: e.AUTH_SERVICE_KEY,
    googleClientId: env.GOOGLE_CLIENT_ID?.trim() || undefined,
    google,
  };
}
