import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import { loadConfig } from './config/env.js';
import { createPool } from './config/db.js';
import { AuthModel } from './models/auth.model.js';
import { AuthService } from './services/auth.service.js';
import { TokenService } from './services/token.service.js';
import { GoogleIdentityService } from './integrations/google/google-identity.js';
import { createApp } from './app.js';
import { MemberModel } from './models/member.model.js';
import { MeetingModel } from './models/meeting.model.js';
import { MemberService } from './services/member.service.js';
import { MeetingService } from './services/meeting.service.js';

async function main() {
  const config = loadConfig(process.env);
  const pool = createPool(config);
  const model = new AuthModel(pool);
  const google = new GoogleIdentityService(config.googleClientId);
  const tokens = new TokenService(config);
  const dummyHash = await argon2.hash(randomBytes(32), {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
  const auth = new AuthService(model, tokens, google, dummyHash);
  const members = new MemberService(new MemberModel(pool));
  const meetingModel = new MeetingModel(pool);
  const meetings = new MeetingService(meetingModel);
  const server = createApp(config, auth, model, members, meetings).listen(
    config.port,
    '0.0.0.0',
    () => process.stdout.write('Backend listening\n'),
  );
  let closing = false;
  for (const signal of ['SIGTERM', 'SIGINT'])
    process.on(signal, () => {
      if (closing) return;
      closing = true;
      server.close(() => {
        void pool.end().then(() => process.exit(0));
      });
      setTimeout(() => process.exit(1), 10_000).unref();
    });
}
main().catch((error) => {
  const message =
    error instanceof Error && error.message.startsWith('Invalid configuration keys:')
      ? error.message
      : 'Backend startup failed';
  process.stderr.write(message + '\n');
  process.exitCode = 1;
});
