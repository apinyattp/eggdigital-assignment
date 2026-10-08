import type { Request, Response, NextFunction } from 'express';
import type { Config } from '../config/env.js';
import { ApiError } from '../utils/api-error.js';
import type { AuthService } from '../services/auth.service.js';
export function requireCurrentUser(auth: AuthService, memberOnly = false) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { user } = await auth.findSession(readCookie(req, 'mm_access'));
      if (memberOnly && (!user.id || user.membership !== 'member'))
        throw new ApiError(403, 'MEMBER_REQUIRED');
      res.locals.user = user;
      next();
    } catch (error) {
      next(error);
    }
  };
}
export function readCookie(req: Request, name: string): string | undefined {
  const values = (req.headers.cookie ?? '')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.startsWith(name + '='));
  if (values.length !== 1) return undefined;
  const value = values[0]!.slice(name.length + 1);
  return /^[A-Za-z0-9_.-]{1,8192}$/.test(value) ? value : undefined;
}
export function validateAuthOrigin(config: Config) {
  return (req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    res.vary('Origin');
    if (req.headers.origin === config.allowedOrigin) {
      res.setHeader('Access-Control-Allow-Origin', config.allowedOrigin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    if (req.method === 'OPTIONS') {
      if (req.headers.origin !== config.allowedOrigin)
        return next(new ApiError(403, 'CSRF_REJECTED'));
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Requested-With');
      res.status(204).end();
      return;
    }
    if (req.method === 'POST') {
      if (
        req.headers.origin !== config.allowedOrigin ||
        req.get('X-Requested-With') !== 'MeetingManager'
      )
        return next(new ApiError(403, 'CSRF_REJECTED'));
      if (!req.is('application/json')) return next(new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE'));
    }
    next();
  };
}
export function accessCookie(config: Config) {
  return {
    httpOnly: true,
    path: '/api',
    sameSite: 'lax' as const,
    secure: config.secureCookies,
    maxAge: config.ttlSeconds * 1000,
  };
}
