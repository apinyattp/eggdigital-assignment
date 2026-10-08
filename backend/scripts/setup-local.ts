import { writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const path = fileURLToPath(new URL('../.local.env', import.meta.url));
try {
  writeFileSync(
    path,
    `# Generated local-only setup. Never commit or share. Root .env is preserved.\nPOSTGRES_PASSWORD=${randomBytes(24).toString('hex')}\nJWT_SIGNING_KEY_BASE64=${randomBytes(32).toString('base64')}\nLOGIN_FIXTURE_PASSWORD=${randomBytes(18).toString('base64url')}\n`,
    { flag: 'wx', mode: 0o600 },
  );
  process.stdout.write(
    'Created backend/.local.env with private local runtime configuration; no values displayed\n',
  );
} catch (error) {
  if ((error as NodeJS.ErrnoException).code === 'EEXIST')
    process.stdout.write('Existing backend/.local.env preserved\n');
  else {
    process.stderr.write('Local setup file could not be created\n');
    process.exitCode = 1;
  }
}
