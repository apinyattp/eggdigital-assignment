import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

export function signSnapshot(value: unknown, key: Uint8Array): string {
  const payload = Buffer.from(JSON.stringify(value)).toString('base64url');
  return payload + '.' + createHmac('sha256', key).update(payload).digest('base64url');
}

// Purpose, principal and query binding remain the caller's responsibility.
export function verifySnapshot(value: unknown, key: Uint8Array): unknown {
  const token = z.string().min(1).max(4096).parse(value);
  const [payload, signature, ...extra] = token.split('.');
  if (
    !payload ||
    !signature ||
    extra.length ||
    !/^[A-Za-z0-9_-]+$/.test(payload) ||
    !/^[A-Za-z0-9_-]+$/.test(signature) ||
    Buffer.from(signature, 'base64url').toString('base64url') !== signature
  )
    throw new Error('Invalid snapshot encoding');
  const supplied = Buffer.from(signature, 'base64url');
  const expected = createHmac('sha256', key).update(payload).digest();
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
    throw new Error('Invalid snapshot signature');
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}
