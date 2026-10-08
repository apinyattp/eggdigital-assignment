export function requireLocalDatabase(value: string | undefined, testOnly = false): string {
  try {
    if (!value) throw new Error();
    const url = new URL(value);
    const allowedNames = testOnly
      ? ['/meeting_manager_test']
      : ['/meeting_manager', '/meeting_manager_test'];
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !['db', '127.0.0.1', 'localhost'].includes(url.hostname) ||
      !allowedNames.includes(url.pathname)
    )
      throw new Error();
    return value;
  } catch {
    throw new Error('Refusing database mutation: use the owned local development/test database');
  }
}
