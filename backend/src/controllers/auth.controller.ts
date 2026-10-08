import type { Request, Response, NextFunction } from 'express';
import type { Config } from '../config/env.js';
import type { AuthService } from '../services/auth.service.js';
import type { GoogleIdentityService } from '../integrations/google/google-identity.js';
import { OAuthTransactions } from '../services/oauth-transaction.service.js';
import { accessCookie, transactionCookie, readCookie } from '../middlewares/auth.middleware.js';
export function createAuthController(
  config: Config,
  auth: AuthService,
  google: Pick<GoogleIdentityService, 'checkAvailable' | 'authorizationUrl'>,
  transactions: OAuthTransactions,
) {
  function clearTransaction(res: Response) {
    res.cookie('mm_google_tx', '', { ...transactionCookie(config), maxAge: 0 });
  }
  return {
    async createPasswordLogin(req: Request, res: Response, next: NextFunction) {
      try {
        const result = await auth.savePasswordLogin(req.body.email, req.body.password);
        res
          .cookie('mm_access', result.token, accessCookie(config))
          .json({ user: result.user, expiresAt: result.expiresAt });
      } catch (error) {
        next(error);
      }
    },
    createGoogleStart(req: Request, res: Response, next: NextFunction) {
      google.checkAvailable();
      const { binding, entry } = transactions.start(readCookie(req, 'mm_google_tx'));
      res
        .cookie('mm_google_tx', binding, transactionCookie(config))
        .json({ authorizationUrl: google.authorizationUrl(entry.state, entry.nonce) });
    },
    async createGoogleExchange(req: Request, res: Response, next: NextFunction) {
      // Invalid/duplicate requests must never clear another operation's transaction cookie.
      const entry = transactions.consume(readCookie(req, 'mm_google_tx'), req.body.state);
      try {
        const result = await auth.saveGoogleLogin(req.body.code, entry.nonce);
        // No await between the final cancellation/expiry check and response commit.
        transactions.complete(entry);
        clearTransaction(res);
        res
          .cookie('mm_access', result.token, accessCookie(config))
          .json({ user: result.user, expiresAt: result.expiresAt });
      } catch (error) {
        let outcome = error;
        try {
          transactions.checkActive(entry);
        } catch (cancelledOrExpired) {
          outcome = cancelledOrExpired;
        }
        transactions.fail(entry);
        clearTransaction(res);
        next(outcome);
      }
    },
    async getSession(req: Request, res: Response, next: NextFunction) {
      res.json(await auth.findSession(readCookie(req, 'mm_access')));
    },
    deleteSession(req: Request, res: Response, next: NextFunction) {
      transactions.cancel(readCookie(req, 'mm_google_tx'));
      clearTransaction(res);
      res
        .cookie('mm_access', '', { ...accessCookie(config), maxAge: 0 })
        .status(204)
        .end();
    },
  };
}
