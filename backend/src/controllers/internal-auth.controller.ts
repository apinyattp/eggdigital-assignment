import type { Request, Response, NextFunction } from 'express';
import type { AuthService } from '../services/auth.service.js';

export function createInternalAuthController(auth: AuthService) {
  return {
    async createIssue(req: Request, res: Response, next: NextFunction) {
      try {
        const result =
          req.body.method === 'password'
            ? await auth.savePasswordLogin(req.body.email, req.body.password)
            : await auth.saveGoogleIdTokenLogin(req.body.idToken);
        res.json({ accessToken: result.token, expiresAt: result.expiresAt, user: result.user });
      } catch (error) {
        next(error);
      }
    },
  };
}
