import argon2 from 'argon2';
import type { AuthModel } from '../models/auth.model.js';
import type { GoogleIdentityService } from '../integrations/google/google-identity.js';
import { ApiError } from '../utils/api-error.js';
import { canonicalEmail, type Identity, TokenService } from './token.service.js';
export type UserView = {
  id: string;
  displayName: string;
  email: string;
  membership: 'member';
};
export class AuthService {
  constructor(
    private model: Pick<AuthModel, 'findByEmail' | 'findPrincipal'>,
    private tokens: TokenService,
    private google: Pick<GoogleIdentityService, 'verifyIdToken'>,
    private dummyHash: string,
  ) {}
  async findPrincipal(identity: Identity, missingMemberStatus: 401 | 404 = 401): Promise<UserView> {
    const { member, candidateDenied } =
      identity.authMethod === 'password'
        ? await this.model.findPrincipal('id', identity.subject)
        : await this.model.findPrincipal('email', identity.verifiedEmail!);
    if (identity.authMethod === 'password' && !member) {
      throw new ApiError(401, 'UNAUTHENTICATED');
    }
    if (candidateDenied) {
      throw new ApiError(403, 'CANDIDATE_DENIED');
    }
    if (!member) {
      const code = missingMemberStatus === 404 ? 'MEMBER_NOT_FOUND' : 'UNAUTHENTICATED';
      throw new ApiError(missingMemberStatus, code);
    }
    return {
      id: member.id,
      displayName: member.display_name,
      email: member.email,
      membership: 'member',
    };
  }
  async savePasswordLogin(email: string, password: string) {
    const member = await this.model.findByEmail(canonicalEmail(email));
    let verified = false;
    try {
      verified = await argon2.verify(member?.password_hash || this.dummyHash, password);
    } catch {
      /* Generic credentials failure, never expose encoded hashes. */
    }
    if (!member?.password_hash || !verified) throw new ApiError(401, 'INVALID_CREDENTIALS');
    const identity: Identity = { authMethod: 'password', subject: member.id };
    const user = await this.findPrincipal(identity);
    return { ...(await this.tokens.issue(identity)), user };
  }
  async findSession(token: string | undefined) {
    if (!token) throw new ApiError(401, 'UNAUTHENTICATED');
    const verified = await this.tokens.verify(token);
    return { user: await this.findPrincipal(verified.identity), expiresAt: verified.expiresAt };
  }
  async saveGoogleIdTokenLogin(idToken: string) {
    const google = await this.google.verifyIdToken(idToken);
    const identity: Identity = {
      authMethod: 'google',
      subject: 'google:' + google.sub,
      verifiedEmail: google.email,
    };
    const user = await this.findPrincipal(identity, 404);
    return { ...(await this.tokens.issue(identity)), user };
  }
}
