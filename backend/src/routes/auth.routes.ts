import { Router } from 'express';
import type { createAuthController } from '../controllers/auth.controller.js';
import { validateBody, emptyBody } from '../middlewares/validate.middleware.js';
export function authRoutes(controller: ReturnType<typeof createAuthController>) {
  const router = Router();
  router.get('/session', controller.getSession);
  router.post('/logout', validateBody(emptyBody), controller.deleteSession);
  return router;
}
