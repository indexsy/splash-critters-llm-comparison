// Client addresses for per-address admission limits. The server runs behind a reverse proxy in
// production (Railway / Fly / Render) and directly in development, so the peer address alone is
// not the client: a peer on an internal network is the proxy, and the client is the entry that
// proxy appended to X-Forwarded-For (PROXY_HOPS entries from the right when several proxies are
// chained). Headers from a public peer are ignored (a client could forge them to dodge its
// limits or to exhaust someone else's).
import type { IncomingMessage } from 'node:http';
import { isIP } from 'node:net';

/** "::ffff:1.2.3.4" (IPv4-mapped IPv6) -> "1.2.3.4". */
function unmapV4(ip: string): string {
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  return mapped ? mapped[1] : ip;
}

/** The eight 16-bit groups of an IPv6 address ("::" expanded), or null when malformed. */
function ipv6Groups(ip: string): number[] | null {
  const [head, tail, extra] = ip.toLowerCase().split('::');
  if (extra !== undefined) return null;
  const parse = (part: string | undefined) => (part ? part.split(':').map((g) => parseInt(g, 16)) : []);
  const left = parse(head);
  const right = parse(tail);
  const missing = 8 - left.length - right.length;
  if (tail === undefined ? missing !== 0 : missing < 1) return null;
  const groups = [...left, ...new Array<number>(Math.max(0, missing)).fill(0), ...right];
  return groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

/**
 * Loopback, private (RFC 1918 / ULA), link-local, unspecified and shared (100.64/10, used by
 * carrier NAT and by platform proxies) addresses: never a client we can tell apart by address.
 */
export function isInternalAddress(ip: string): boolean {
  const v = unmapV4(ip);
  if (isIP(v) === 4) {
    const [a, b] = v.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const groups = isIP(v) === 6 ? ipv6Groups(v) : null;
  if (!groups) return true;
  const first = groups[0];
  const loopbackOrUnspecified = groups.slice(0, 7).every((g) => g === 0) && groups[7] <= 1;
  return loopbackOrUnspecified || (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80;
}

/**
 * The key limits are counted under: an IPv4 address as is, an IPv6 address by its /64 prefix
 * (one household or server gets a whole /64 and can rotate addresses inside it for free).
 */
export function addressKey(ip: string): string {
  const v = unmapV4(ip);
  if (isIP(v) !== 6) return v;
  const groups = ipv6Groups(v);
  return groups ? `${groups.slice(0, 4).map((g) => g.toString(16)).join(':')}::/64` : v;
}

/** Parses PROXY_HOPS: how many proxies append to X-Forwarded-For in front of us (1..5, default 1). */
export function parseProxyHops(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : 1;
}

/**
 * The X-Forwarded-For entry `hops` from the right: the address the outermost of our `hops`
 * proxies saw (entries further left were written by the client and prove nothing).
 */
function forwardedClient(header: string | string[] | undefined, hops: number): string | null {
  const raw = Array.isArray(header) ? header.join(',') : header;
  const entries = raw?.split(',') ?? [];
  const entry = entries[entries.length - hops]?.trim();
  if (!entry) return null;
  const ip = unmapV4(entry);
  return isIP(ip) ? ip : null;
}

/**
 * The client address a connection counts against, or null when it cannot be told apart from
 * other clients (local development, a LAN, or a proxy that did not forward one): not limited.
 * `proxyHops` > 1 is for chains such as a CDN in front of the platform proxy.
 */
export function clientAddress(req: Pick<IncomingMessage, 'headers'> & { socket: { remoteAddress?: string } }, proxyHops = 1): string | null {
  const peer = req.socket.remoteAddress;
  if (!peer) return null;
  const direct = unmapV4(peer);
  const client = isInternalAddress(direct) ? forwardedClient(req.headers['x-forwarded-for'], proxyHops) : direct;
  return client && !isInternalAddress(client) ? addressKey(client) : null;
}
