import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import type { MemberService } from '../services/member.service.js';
import { ApiError } from '../utils/api-error.js';
export function createMemberController(service: MemberService) {
  return {
    async getMembers(req: Request, res: Response, next: NextFunction) {
      try {
        if (req.query.query !== undefined && typeof req.query.query !== 'string')
          throw new ApiError(400, 'VALIDATION_ERROR', { query: 'ข้อมูลไม่ถูกต้อง' });
        const input = z
          .object({
            query: z.string().optional(),
            page: z
              .string()
              .regex(/^[1-9]\d*$/)
              .transform(Number),
            pageSize: z
              .string()
              .regex(/^[1-9]\d*$/)
              .transform(Number)
              .pipe(z.number().int().positive().max(20)),
          })
          .strict()
          .safeParse(req.query);
        if (!input.success) throw new ApiError(400, 'VALIDATION_ERROR');
        res.json(
          await service.searchMembers(input.data.query, input.data.page, input.data.pageSize),
        );
      } catch (error) {
        next(error);
      }
    },
  };
}
