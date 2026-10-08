import { Router } from 'express';
import type { createMemberController } from '../controllers/member.controller.js';
export function memberRoutes(controller: ReturnType<typeof createMemberController>) {
  const router = Router();
  router.get('/', controller.getMembers);
  return router;
}
