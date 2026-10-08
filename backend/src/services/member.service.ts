import { z } from 'zod';
import type { MemberModel } from '../models/member.model.js';
import { ApiError } from '../utils/api-error.js';
export class MemberService {
  constructor(private model: Pick<MemberModel, 'readPage'>) {}
  async searchMembers(query: unknown, page: unknown, pageSize: unknown) {
    if (query !== undefined && typeof query !== 'string')
      throw new ApiError(400, 'VALIDATION_ERROR', { query: 'ข้อมูลไม่ถูกต้อง' });
    const input = z
      .object({
        query: z.string().optional(),
        page: z.number().int().positive().safe(),
        pageSize: z.literal(20),
      })
      .safeParse({ query, page, pageSize });
    if (!input.success) throw new ApiError(400, 'VALIDATION_ERROR');
    const offset = (input.data.page - 1) * input.data.pageSize;
    if (!Number.isSafeInteger(offset)) throw new ApiError(400, 'VALIDATION_ERROR');
    const normalized = (input.data.query ?? '').trim().toLowerCase();
    const result = normalized
      ? await this.model.readPage(normalized, input.data.pageSize, offset)
      : { items: [], total: 0 };
    return { ...result, page: input.data.page, pageSize: input.data.pageSize };
  }
}
