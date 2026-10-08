import { createHash, randomBytes } from 'node:crypto';
import { ApiError } from '../utils/api-error.js';
export type Transaction = {
  bindingHash: string;
  state: string;
  nonce: string;
  expiresAt: number;
  status: 'pending' | 'exchanging' | 'cancelled' | 'completed' | 'failed';
};
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
export class OAuthTransactions {
  private entries = new Map<string, Transaction>();
  constructor(
    private now: () => number = Date.now,
    private capacity = 1000,
  ) {}
  start(previousBinding?: string) {
    for (const [key, entry] of this.entries)
      if (entry.expiresAt <= this.now()) this.entries.delete(key);
    if (this.entries.size >= this.capacity) throw new ApiError(503, 'GOOGLE_AUTH_UNAVAILABLE');
    this.cancel(previousBinding);
    const binding = randomBytes(32).toString('base64url');
    const entry: Transaction = {
      bindingHash: hash(binding),
      state: randomBytes(32).toString('base64url'),
      nonce: randomBytes(32).toString('base64url'),
      expiresAt: this.now() + 300_000,
      status: 'pending',
    };
    this.entries.set(entry.bindingHash, entry);
    return { binding, entry };
  }
  consume(binding: string | undefined, state: string) {
    const entry = binding ? this.entries.get(hash(binding)) : undefined;
    if (
      !entry ||
      entry.expiresAt <= this.now() ||
      entry.state !== state ||
      entry.status !== 'pending'
    )
      throw new ApiError(400, 'OAUTH_TRANSACTION_INVALID');
    entry.status = 'exchanging';
    return entry;
  }
  cancel(binding?: string) {
    const entry = binding ? this.entries.get(hash(binding)) : undefined;
    if (entry && (entry.status === 'pending' || entry.status === 'exchanging'))
      entry.status = 'cancelled';
  }
  checkActive(entry: Transaction) {
    if (entry.status === 'cancelled') throw new ApiError(409, 'AUTH_ATTEMPT_CANCELLED');
    if (entry.status !== 'exchanging' || entry.expiresAt <= this.now())
      throw new ApiError(400, 'OAUTH_TRANSACTION_INVALID');
  }
  complete(entry: Transaction) {
    this.checkActive(entry);
    entry.status = 'completed';
  }
  fail(entry: Transaction) {
    if (entry.status === 'exchanging') entry.status = 'failed';
  }
}
