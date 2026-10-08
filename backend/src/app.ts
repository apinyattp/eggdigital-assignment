import express from 'express';
import { HealthService } from './services/health.service.js';
import { createHealthController } from './controllers/health.controller.js';
import { healthRoutes } from './routes/health.routes.js';
import { randomUUID } from 'node:crypto';
import type { Config } from './config/env.js';
import type { AuthModel } from './models/auth.model.js';
import type { AuthService } from './services/auth.service.js';
import type { GoogleIdentityService } from './integrations/google/google-identity.js';
import { OAuthTransactions } from './services/oauth-transaction.service.js';
import { createAuthController } from './controllers/auth.controller.js';
import { authRoutes } from './routes/auth.routes.js';
import { validateAuthOrigin, requireCurrentUser } from './middlewares/auth.middleware.js';
import type { MemberService } from './services/member.service.js';
import type { MeetingService } from './services/meeting.service.js';
import { createMemberController } from './controllers/member.controller.js';
import { createMeetingController } from './controllers/meeting.controller.js';
import { memberRoutes } from './routes/member.routes.js';
import { meetingRoutes } from './routes/meeting.routes.js';
import { errorHandler } from './middlewares/error-handler.js';
import { internalAuthRoutes } from './routes/internal-auth.routes.js';
import { createInternalAuthController } from './controllers/internal-auth.controller.js';
export function createApp(
  config: Config,
  auth: AuthService,
  google: Pick<GoogleIdentityService, 'checkAvailable' | 'authorizationUrl'>,
  model: Pick<AuthModel, 'checkReady'>,
  members: MemberService,
  meetings: MeetingService,
  transactions = new OAuthTransactions(),
) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.use((req, res, next) => {
    res.locals.requestId = randomUUID();
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });
  app.use('/internal/auth', internalAuthRoutes(config, createInternalAuthController(auth)));
  app.use('/api', validateAuthOrigin(config), express.json({ limit: '16kb' }));
  app.use('/api/v1/auth', authRoutes(createAuthController(config, auth, google, transactions)));
  app.use('/api/v1/health', healthRoutes(createHealthController(new HealthService(model))));
  app.use(
    '/api/v1/members',
    requireCurrentUser(auth, true),
    memberRoutes(createMemberController(members)),
  );
  app.use(
    '/api/v1/meetings',
    requireCurrentUser(auth),
    meetingRoutes(createMeetingController(meetings)),
  );
  app.use((_req, res) => {
    res.status(404).json({
      error: { code: 'NOT_FOUND', message: 'ไม่พบเส้นทาง' },
      requestId: res.locals.requestId,
    });
  });
  app.use(errorHandler);
  return app;
}
