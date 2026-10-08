import { Router } from 'express';
import type { createHealthController } from '../controllers/health.controller.js';
export function healthRoutes(controller: ReturnType<typeof createHealthController>) {
  const router = Router();
  router.get('/ready', controller.getReadiness);
  return router;
}
