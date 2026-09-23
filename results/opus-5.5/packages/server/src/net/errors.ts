// A rejected client request. Thrown by rooms, the matchmaker and handlers; the dispatcher turns it
// into the protocol's `error {code, msg}` message (AccountError from accounts.ts is mapped the same way).
import type { ErrorCode, S2C } from '@splash/shared';

export class ClientError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ClientError';
  }
}

export function errorMessage(code: ErrorCode, msg: string): S2C {
  return { type: 'error', code, msg };
}
