import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
const name = 'eggdigital-login-test-' + randomUUID();
const image =
  'postgres:18-bookworm@sha256:afc7e2d441324c0388fa80c3d24f733b4194a4eb7f47dd8ee2b08eb1a24a647c';
const secret = randomBytes(24).toString('hex');
let created = false;
function docker(args: string[], env?: NodeJS.ProcessEnv) {
  const r = spawnSync('docker', args, { encoding: 'utf8', env: env ?? process.env });
  if (r.status !== 0) throw new Error('Isolated Docker operation failed');
  return r.stdout.trim();
}
try {
  docker(
    [
      'run',
      '--detach',
      '--rm',
      '--name',
      name,
      '--label',
      'eggdigital.test=login',
      '--publish',
      '127.0.0.1::5432',
      '--env',
      'POSTGRES_PASSWORD',
      '--env',
      'POSTGRES_USER=meeting_manager',
      '--env',
      'POSTGRES_DB=meeting_manager_test',
      image,
    ],
    { ...process.env, POSTGRES_PASSWORD: secret },
  );
  created = true;
  let ready = false;
  for (let n = 0; n < 60; n++) {
    const r = spawnSync(
      'docker',
      [
        'exec',
        name,
        'pg_isready',
        '-h',
        '127.0.0.1',
        '-U',
        'meeting_manager',
        '-d',
        'meeting_manager_test',
      ],
      { stdio: 'ignore' },
    );
    if (r.status === 0) {
      ready = true;
      break;
    }
    await delay(500);
  }
  if (!ready) throw new Error('Isolated database not ready');
  for (const suite of [
    'tests/integration.test.ts',
    'tests/onsite.integration.test.ts',
    'tests/meeting-development.integration.test.ts',
    'tests/notes-feedback.integration.test.ts',
    'tests/manual-link.integration.test.ts',
  ]) {
    const port = docker(['port', name, '5432/tcp']).split(':').pop();
    if (!port || !/^\d+$/.test(port)) throw new Error('Isolated port unavailable');
    const r = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', suite], {
      stdio: 'inherit',
      env: {
        ...process.env,
        TEST_POSTGRES_CONTAINER: name,
        TEST_DATABASE_URL: `postgresql://meeting_manager:${secret}@127.0.0.1:${port}/meeting_manager_test`,
      },
    });
    if (r.status !== 0) {
      process.exitCode = r.status ?? 1;
      break;
    }
  }
} catch {
  process.stderr.write(
    'Isolated integration setup/execution failed; no remote database was modified\n',
  );
  process.exitCode = 1;
} finally {
  if (created) {
    try {
      docker(['rm', '--force', name]);
      const left = docker(['ps', '--all', '--quiet', '--filter', 'name=^/' + name + '$']);
      if (left) throw new Error();
      process.stdout.write('Owned isolated test container removed and absence verified\n');
    } catch {
      process.stderr.write('Owned test container cleanup requires attention\n');
      process.exitCode = 1;
    }
  }
}
