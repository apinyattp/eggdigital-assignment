import { Router, json } from 'express';
import type { Config } from '../config/env.js';
import type { createInternalAuthController } from '../controllers/internal-auth.controller.js';
import { authenticateInternalCaller } from '../middlewares/internal-auth.middleware.js';
import { internalIssueBody, validateBody } from '../middlewares/validate.middleware.js';

export function internalAuthRoutes(
  config: Config,
  controller: ReturnType<typeof createInternalAuthController>,
) {
  const router = Router();
  router.post(
    '/issue',
    authenticateInternalCaller(config),
    json({ limit: '16kb' }),
    validateBody(internalIssueBody),
    controller.createIssue,
  );
  return router;
}
