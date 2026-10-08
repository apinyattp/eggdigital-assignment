import { writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const path = fileURLToPath(new URL('../.bridge.local.env', import.meta.url));
try {
  writeFileSync(
    path,
    `# Private local auth bridge settings. Never commit or share.\nAUTH_SERVICE_KEY=${randomBytes(32).toString('base64url')}\nNEXTAUTH_SECRET=${randomBytes(32).toString('base64url')}\n`,
    { flag: 'wx', mode: 0o600 },
  );
  process.stdout.write('Created backend/.bridge.local.env; no values displayed\n');
} catch (error) {
  if ((error as NodeJS.ErrnoException).code === 'EEXIST')
    process.stdout.write('Existing backend/.bridge.local.env preserved\n');
  else {
    process.stderr.write('Bridge setup file could not be created\n');
    process.exitCode = 1;
  }
}
