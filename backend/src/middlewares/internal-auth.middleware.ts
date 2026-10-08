import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import type { Config } from '../config/env.js';
import { ApiError } from '../utils/api-error.js';

export function authenticateInternalCaller(config: Config) {
  const expected = config.authServiceKey
    ? createHash('sha256').update(config.authServiceKey).digest()
    : undefined;
  return (req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    const supplied = req.get('X-Auth-Service-Key');
    let count = 0;
    for (let i = 0; i < req.rawHeaders.length; i += 2)
      if (req.rawHeaders[i]!.toLowerCase() === 'x-auth-service-key') count++;
    if (
      !expected ||
      !supplied ||
      supplied.length > 1024 ||
      count !== 1 ||
      !timingSafeEqual(expected, createHash('sha256').update(supplied).digest())
    )
      return next(new ApiError(401, 'INTERNAL_CALLER_UNAUTHORIZED'));
    const correlation = req.get('X-Request-ID');
    if (z.uuid().safeParse(correlation).success) res.locals.requestId = correlation;
    if (!req.is('application/json')) return next(new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE'));
    next();
  };
}
