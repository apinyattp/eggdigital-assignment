import type { Request, Response, NextFunction } from 'express';
import type { Config } from '../config/env.js';
import type { AuthService } from '../services/auth.service.js';
import { accessCookie, readCookie } from '../middlewares/auth.middleware.js';
export function createAuthController(config: Config, auth: AuthService) {
  return {
    async getSession(req: Request, res: Response, next: NextFunction) {
      res.json(await auth.findSession(readCookie(req, 'mm_access')));
    },
    deleteSession(req: Request, res: Response, next: NextFunction) {
      res.cookie('mm_google_tx', '', {
        ...accessCookie(config),
        path: '/api/v1/auth',
        maxAge: 0,
      });
      res
        .cookie('mm_access', '', { ...accessCookie(config), maxAge: 0 })
        .status(204)
        .end();
    },
  };
}
