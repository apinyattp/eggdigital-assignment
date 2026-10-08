import { randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { z } from 'zod';
import type { Config } from '../config/env.js';
import { ApiError } from '../utils/api-error.js';
export type Identity = {
  authMethod: 'password' | 'google';
  subject: string;
  verifiedEmail?: string;
};
export const canonicalEmail = (value: string) => value.trim().toLowerCase();
const uuid = z.uuid();
const email = z.email();
export class TokenService {
  constructor(
    private config: Config,
    private now: () => number = Date.now,
  ) {}
  async issue(identity: Identity) {
    const iat = Math.floor(this.now() / 1000);
    const exp = iat + this.config.ttlSeconds;
    const token = await new SignJWT({
      auth_method: identity.authMethod,
      token_use: 'access',
      ...(identity.authMethod === 'google' ? { verified_email: identity.verifiedEmail } : {}),
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuer(this.config.issuer)
      .setAudience(this.config.audience)
      .setSubject(identity.subject)
      .setJti(randomUUID())
      .setIssuedAt(iat)
      .setExpirationTime(exp)
      .sign(this.config.signingKey);
    return { token, expiresAt: new Date(exp * 1000).toISOString() };
  }
  async verify(token: string): Promise<{ identity: Identity; expiresAt: string }> {
    try {
      const { payload: p, protectedHeader: h } = await jwtVerify(token, this.config.signingKey, {
        algorithms: ['HS256'],
        issuer: this.config.issuer,
        audience: this.config.audience,
        currentDate: new Date(this.now()),
        clockTolerance: 0,
        requiredClaims: ['sub', 'jti', 'iat', 'exp', 'auth_method', 'token_use'],
      });
      const now = Math.floor(this.now() / 1000);
      if (
        h.typ !== 'JWT' ||
        h.jku ||
        h.x5u ||
        h.kid ||
        p.token_use !== 'access' ||
        p.iss !== this.config.issuer ||
        p.aud !== this.config.audience ||
        !uuid.safeParse(p.jti).success ||
        !Number.isInteger(p.iat) ||
        !Number.isInteger(p.exp) ||
        p.iat! > now ||
        p.exp! <= p.iat! ||
        p.exp! - p.iat! > this.config.ttlSeconds
      )
        throw new Error();
      let identity: Identity;
      if (p.auth_method === 'password' && uuid.safeParse(p.sub).success)
        identity = { authMethod: 'password', subject: p.sub! };
      else if (
        p.auth_method === 'google' &&
        typeof p.sub === 'string' &&
        /^google:[^\s:]{1,255}$/.test(p.sub) &&
        typeof p.verified_email === 'string' &&
        email.safeParse(p.verified_email).success &&
        canonicalEmail(p.verified_email) === p.verified_email
      )
        identity = { authMethod: 'google', subject: p.sub, verifiedEmail: p.verified_email };
      else throw new Error();
      return { identity, expiresAt: new Date(p.exp! * 1000).toISOString() };
    } catch {
      throw new ApiError(401, 'UNAUTHENTICATED');
    }
  }
}
