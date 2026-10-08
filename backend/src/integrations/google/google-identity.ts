import { OAuth2Client } from 'google-auth-library';
import { z } from 'zod';
import { ApiError } from '../../utils/api-error.js';
import { canonicalEmail } from '../../services/token.service.js';
export type GoogleIdentity = { sub: string; email: string; displayName: string };
export class GoogleIdentityService {
  private client: OAuth2Client | undefined;
  private audience: string | undefined;
  constructor(clientId?: string) {
    this.audience = clientId;
    if (clientId)
      this.client = new OAuth2Client({
        clientId,
        transporterOptions: { timeout: 10_000, retry: false },
      });
  }
  async verifyIdToken(idToken: string, expectedNonce?: string): Promise<GoogleIdentity> {
    if (!this.client || !this.audience) throw new ApiError(503, 'GOOGLE_AUTH_UNAVAILABLE');
    try {
      const ticket = await this.client.verifyIdToken({ idToken, audience: this.audience });
      const p = ticket.getPayload() as ReturnType<typeof ticket.getPayload> & { nonce?: unknown };
      if (
        !p ||
        !['accounts.google.com', 'https://accounts.google.com'].includes(p.iss) ||
        p.aud !== this.audience ||
        !Number.isInteger(p.exp) ||
        p.exp <= Math.floor(Date.now() / 1000) ||
        !Number.isInteger(p.iat) ||
        p.iat > Math.floor(Date.now() / 1000) ||
        (expectedNonce !== undefined && p.nonce !== expectedNonce) ||
        typeof p.sub !== 'string' ||
        !p.sub ||
        p.sub.length > 255 ||
        /[\s:]/.test(p.sub) ||
        p.email_verified !== true ||
        !p.email ||
        !z.email().safeParse(p.email).success
      )
        throw new ApiError(401, 'GOOGLE_IDENTITY_INVALID');
      const email = canonicalEmail(p.email);
      const authoritative =
        email.endsWith('@gmail.com') || (typeof p.hd === 'string' && p.hd.trim().length > 0);
      // Only authoritative identities are released. No admission/OTP/Guest bypass for the deferred policy.
      if (!authoritative) throw new ApiError(403, 'EMAIL_OWNERSHIP_UNVERIFIED');
      return {
        sub: p.sub,
        email,
        displayName: typeof p.name === 'string' && p.name.trim() ? p.name : email,
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      const e = error as { code?: string; response?: { status?: number } };
      if (e.code || (e.response?.status && e.response.status >= 500))
        throw new ApiError(503, 'GOOGLE_AUTH_UNAVAILABLE');
      throw new ApiError(401, 'GOOGLE_IDENTITY_INVALID');
    }
  }
}
