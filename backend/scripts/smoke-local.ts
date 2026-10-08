const origin = 'http://localhost:3000';
const base = 'http://127.0.0.1:3001';
const checks: Record<string, string> = {};
function check(name: string, ok: boolean) {
  if (!ok) throw new Error(name);
  checks[name] = 'PASS';
}
async function post(path: string) {
  return fetch(base + path, {
    method: 'POST',
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
      'X-Requested-With': 'MeetingManager',
    },
    body: '{}',
  });
}
try {
  check('readiness', (await fetch(base + '/api/v1/health/ready')).status === 200);
  for (const [name, path] of [
    ['password', '/login'],
    ['google_start', '/google/start'],
    ['google_exchange', '/google/exchange'],
  ]) {
    const response = await post('/api/v1/auth' + path);
    check('retired_' + name, response.status === 404);
    check('no_cookie_' + name, response.headers.getSetCookie().length === 0);
  }
  check('session_requires_cookie', (await fetch(base + '/api/v1/auth/session')).status === 401);
  check('internal_issuer_requires_server_key', (await post('/internal/auth/issue')).status === 401);
  check(
    'logout_requires_csrf',
    (
      await fetch(base + '/api/v1/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
    ).status === 403,
  );
  const logout = await post('/api/v1/auth/logout');
  check('logout_without_identity_or_database', logout.status === 204);
  const cookies = logout.headers.getSetCookie();
  check(
    'clear_access_cookie',
    cookies.some(
      (c) =>
        c.startsWith('mm_access=;') &&
        c.includes('Max-Age=0') &&
        c.includes('Path=/api;') &&
        c.includes('HttpOnly') &&
        c.includes('SameSite=Lax'),
    ),
  );
  check(
    'clear_legacy_transaction_cookie',
    cookies.some(
      (c) =>
        c.startsWith('mm_google_tx=;') &&
        c.includes('Max-Age=0') &&
        c.includes('Path=/api/v1/auth;') &&
        c.includes('HttpOnly'),
    ),
  );
  console.log(
    JSON.stringify(
      {
        checks,
        scope:
          'Non-mutating backend transport smoke; no credentials or secrets loaded, no service restart, no database writes',
        browser_nextauth_integration: 'NOT_RUN: independent FE/QA execution',
        real_google_login: 'NOT_RUN: requires authorized provider account',
        secret_values_emitted: false,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.log(
    JSON.stringify(
      {
        checks,
        failed_check:
          error instanceof Error && /^[a-z_]+$/.test(error.message)
            ? error.message
            : 'runtime_or_setup_failure',
        secret_values_emitted: false,
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
}
