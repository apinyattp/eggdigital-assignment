import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ApiError } from '../utils/api-error.js';
export function validateBody(schema: z.ZodType) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const fields: Record<string, string> = {};
      for (const issue of result.error.issues)
        fields[String(issue.path[0] ?? 'body')] = 'ข้อมูลไม่ถูกต้อง';
      return next(new ApiError(400, 'VALIDATION_ERROR', fields));
    }
    req.body = result.data;
    next();
  };
}
export const passwordBody = z
  .object({
    email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
    password: z.string().min(1),
  })
  .strict();
export const emptyBody = z.object({}).strict();
export const internalIssueBody = z.discriminatedUnion('method', [
  passwordBody.extend({ method: z.literal('password') }),
  z.object({ method: z.literal('google'), idToken: z.string().min(1).max(8192) }).strict(),
]);
