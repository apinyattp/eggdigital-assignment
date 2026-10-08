import type { Request, Response, NextFunction } from 'express';
import { ApiError } from '../utils/api-error.js';
export function errorHandler(error: unknown, _req: Request, res: Response, next: NextFunction) {
  if (res.headersSent) return next(error);
  const parsed = error as { type?: string };
  const safe =
    error instanceof ApiError
      ? error
      : parsed?.type === 'entity.parse.failed' || parsed?.type === 'entity.too.large'
        ? new ApiError(400, 'VALIDATION_ERROR')
        : parsed?.type === 'charset.unsupported' || parsed?.type === 'encoding.unsupported'
          ? new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE')
          : new ApiError(500, 'INTERNAL_ERROR');
  if (safe.retryAfter) res.setHeader('Retry-After', String(safe.retryAfter));
  let message =
    safe.status === 401
      ? 'กรุณาตรวจสอบการเข้าสู่ระบบ'
      : safe.status === 403
        ? 'ไม่สามารถเข้าใช้งานได้'
        : safe.status === 429
          ? 'กรุณารอสักครู่แล้วลองใหม่'
          : safe.status >= 500
            ? 'บริการยังไม่พร้อม กรุณาลองใหม่'
            : 'ข้อมูลไม่ถูกต้อง';
  if (safe.code === 'MEMBER_NOT_FOUND') {
    message = 'ไม่พบบัญชีสมาชิกสำหรับอีเมล Google นี้';
  }
  res.status(safe.status).json({
    error: {
      code: safe.code,
      message,
      ...(safe.fields ? { fields: safe.fields } : {}),
    },
    requestId: res.locals.requestId,
  });
}
