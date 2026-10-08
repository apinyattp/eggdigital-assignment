import type { Request, Response, NextFunction } from 'express';
import type { HealthService } from '../services/health.service.js';
export function createHealthController(service: HealthService) {
  return {
    async getReadiness(req: Request, res: Response, next: NextFunction) {
      try {
        await service.checkReady();
        res.json({ status: 'ready' });
      } catch {
        res.status(503).json({ status: 'not_ready' });
      }
    },
  };
}
