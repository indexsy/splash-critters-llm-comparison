// Await the outcome of one request a dialog or screen sent. While any request is pending, the
// app's global error toast is held back (claimServerErrors) and this module routes every server
// error instead: the oldest pending request that can be refused with that code takes it (the
// server answers one socket's messages in order), and an error no pending request owns is toasted
// here, so it is never swallowed. A caller-defined store transition completes a request and
// silence past the timeout fails it. Returns a cancel function (call it when the dialog closes).
import type { ErrorCode } from '@splash/shared';
import { claimServerErrors } from '../../app';
import { store, type AppError, type AppState } from '../../store';
import { toast } from '../../ui';

const DEFAULT_TIMEOUT_MS = 8000;

/** Refusals any request can get: a malformed message, rate limiting, or a server fault. */
const ANY_REQUEST_ERRORS: readonly ErrorCode[] = ['bad_message', 'rate_limited', 'server_error'];

export interface ReplyOptions {
  /** Error codes the server refuses this request with (on top of ANY_REQUEST_ERRORS). */
  errors: readonly ErrorCode[];
  /** True when this store transition means the request succeeded. */
  succeeded?: (next: Readonly<AppState>, prev: Readonly<AppState>) => boolean;
  onSuccess?: () => void;
  onError: (err: AppError) => void;
  timeoutMs?: number;
}

interface PendingReply {
  readonly opts: ReplyOptions;
  readonly release: () => void;
  timer: ReturnType<typeof setTimeout> | undefined;
}

/** Requests awaiting an answer, oldest first. */
const pending: PendingReply[] = [];
let stopRouting: (() => void) | null = null;

function owns(reply: PendingReply, code: ErrorCode): boolean {
  return reply.opts.errors.includes(code) || ANY_REQUEST_ERRORS.includes(code);
}

/** Take `reply` off the pending list; false when it was already settled. */
function settle(reply: PendingReply): boolean {
  const index = pending.indexOf(reply);
  if (index < 0) return false;
  pending.splice(index, 1);
  reply.release();
  clearTimeout(reply.timer);
  if (pending.length === 0) {
    stopRouting?.();
    stopRouting = null;
  }
  return true;
}

function fail(reply: PendingReply, err: AppError): void {
  if (settle(reply)) reply.opts.onError(err);
}

/** Hand a new server error to its request, or toast it (the app held its own toast back). */
function routeError(err: AppError): void {
  const owner = pending.find((reply) => owns(reply, err.code));
  if (owner) fail(owner, err);
  else if (err.code !== 'bad_version') toast(errorText(err), 'error'); // bad_version has its banner
}

function route(next: Readonly<AppState>, prev: Readonly<AppState>): void {
  if (next.lastError && next.lastError !== prev.lastError) {
    routeError(next.lastError);
    return;
  }
  for (const reply of [...pending]) {
    if (reply.opts.succeeded?.(next, prev) && settle(reply)) reply.opts.onSuccess?.();
  }
}

export function awaitServerReply(opts: ReplyOptions): () => void {
  const reply: PendingReply = { opts, release: claimServerErrors(), timer: undefined };
  pending.push(reply);
  stopRouting ??= store.subscribe(route);
  reply.timer = setTimeout(() => {
    fail(reply, { code: 'server_error', msg: 'The server did not answer. Please try again.', at: Date.now() });
  }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  return () => {
    settle(reply);
  };
}

/** Friendly inline text for a server error shown inside a dialog. */
export function errorText(err: AppError): string {
  return err.msg || err.code.replace(/_/g, ' ');
}
