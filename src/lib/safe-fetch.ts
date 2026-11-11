import { lookup } from 'node:dns/promises';
import net from 'node:net';
import { UA } from './vocab';

export class FetchError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'FetchError';
    this.statusCode = statusCode;
  }
}

const TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 5;
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_PORTS = new Set(['', '80', '443']);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const BLOCKED_RANGES = new net.BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  BLOCKED_RANGES.addSubnet(address, prefix, 'ipv4');
}

for (const [address, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['100::', 64],
  ['2001::', 32],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  BLOCKED_RANGES.addSubnet(address, prefix, 'ipv6');
}

function unwrapMappedIPv4(ip: string): string | undefined {
  const m = /^::ffff:(.+)$/i.exec(ip);
  if (!m) return undefined;
  if (net.isIPv4(m[1])) return m[1];
  const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(m[1]);
  if (!hex) return undefined;
  const hi = parseInt(hex[1], 16);
  const lo = parseInt(hex[2], 16);
  return [hi >> 8, hi & 255, lo >> 8, lo & 255].join('.');
}

export function isPublicIp(ip: string): boolean {
  const bare = ip.replace(/^\[|\]$/g, '');
  const v4 = net.isIPv4(bare) ? bare : unwrapMappedIPv4(bare);
  if (v4) {
    return !BLOCKED_RANGES.check(v4, 'ipv4');
  }
  if (net.isIPv6(bare)) {
    return !BLOCKED_RANGES.check(bare, 'ipv6');
  }
  return false;
}

/**
 * Validates URL syntax, scheme, credentials, port, hostname, and resolved IP addresses.
 */
export async function validateSafeUrl(
  rawUrl: string,
  resolveHost: (
    host: string
  ) => Promise<Array<{ address: string; family: number }>> = (h) =>
    lookup(h, { all: true, verbatim: true })
): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new FetchError('Only valid http(s) URLs are supported.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new FetchError('Only http(s) URLs are supported.');
  }

  if (parsed.username || parsed.password) {
    throw new FetchError('URLs with embedded credentials are not allowed.');
  }

  if (!ALLOWED_PORTS.has(parsed.port)) {
    throw new FetchError('Only standard ports (80 and 443) are allowed.');
  }

  const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host) {
    throw new FetchError('Invalid hostname.');
  }

  if (net.isIP(host)) {
    if (!isPublicIp(host)) {
      throw new FetchError(
        'Refusing to fetch private, loopback, or reserved network addresses.',
        403
      );
    }
    return parsed;
  }

  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    !host.includes('.')
  ) {
    throw new FetchError(
      'Refusing to fetch private, local, or internal hostnames.',
      403
    );
  }

  // Reject numeric-only or hex/octal-like host labels that failed normalization
  if (/^(0x[0-9a-f]+|\d+)(\.(0x[0-9a-f]+|\d+))*$/i.test(host)) {
    throw new FetchError(
      'Refusing to fetch numeric or obfuscated IP literals.',
      403
    );
  }

  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await resolveHost(host);
  } catch {
    throw new FetchError(`Could not resolve hostname: ${host}`);
  }

  if (!addresses.length || addresses.some((a) => !isPublicIp(a.address))) {
    throw new FetchError(
      'Hostname resolves to a private, loopback, or reserved IP address.',
      403
    );
  }

  return parsed;
}

function decodeHtmlBytes(bytes: Uint8Array, contentType: string): string {
  let charset = /charset\s*=\s*["']?([\w.:-]+)/i.exec(contentType)?.[1];
  if (!charset) {
    const headAscii = new TextDecoder('latin1').decode(bytes.subarray(0, 2048));
    charset =
      /<meta[^>]+charset\s*=\s*["']?([\w.:-]+)/i.exec(headAscii)?.[1] ??
      /<meta[^>]+content\s*=\s*["'][^"']*charset=([\w.:-]+)/i.exec(
        headAscii
      )?.[1];
  }
  const encoding = (charset || 'utf-8').toLowerCase();
  try {
    return new TextDecoder(encoding).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

export async function safeFetch(
  rawUrl: string
): Promise<{ html: string; finalUrl: string; status: number }> {
  let currentUrl = await validateSafeUrl(rawUrl);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let res: Response;
    try {
      res = await fetch(currentUrl.href, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          'User-Agent': UA,
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-GB,en;q=0.9',
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new FetchError(`Could not fetch the page: ${msg}`, 502);
    }

    if (REDIRECT_STATUSES.has(res.status)) {
      const location = res.headers.get('location');
      if (!location) {
        throw new FetchError(
          `Redirect response (${res.status}) missing Location header.`,
          502
        );
      }
      if (hop === MAX_REDIRECTS) {
        throw new FetchError(`Too many redirects (>${MAX_REDIRECTS}).`, 400);
      }
      const nextRaw = new URL(location, currentUrl).href;
      currentUrl = await validateSafeUrl(nextRaw);
      continue;
    }

    const ctype = (res.headers.get('content-type') ?? '').toLowerCase();
    if (res.status >= 400) {
      throw new FetchError(
        `The server responded with HTTP ${res.status}. If the site blocks scrapers, paste the page HTML instead.`,
        400
      );
    }
    if (ctype && !ctype.includes('html') && !ctype.includes('xml')) {
      throw new FetchError(
        `URL did not return HTML (content-type: ${ctype}).`,
        400
      );
    }

    const contentLen = Number(res.headers.get('content-length') ?? '0');
    if (contentLen > MAX_BYTES) {
      throw new FetchError('Response exceeds the 5 MB size limit.', 413);
    }

    if (!res.body) {
      return { html: '', finalUrl: currentUrl.href, status: res.status };
    }

    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          total += value.byteLength;
          if (total > MAX_BYTES) {
            await reader.cancel();
            throw new FetchError('Response exceeds the 5 MB size limit.', 413);
          }
          chunks.push(value);
        }
      }
    } finally {
      reader.releaseLock();
    }

    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }

    const html = decodeHtmlBytes(merged, ctype);
    return {
      html,
      finalUrl: currentUrl.href,
      status: res.status,
    };
  }

  throw new FetchError(`Too many redirects (>${MAX_REDIRECTS}).`, 400);
}

