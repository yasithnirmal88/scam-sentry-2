import dns from 'node:dns';
import net from 'node:net';

export class GuardError extends Error {
  constructor(message, opts = {}) {
    super(message);
    this.name = 'GuardError';
    this.code = 'SSRF_BLOCKED';
    if (opts.address) this.address = opts.address;
  }
}

function ipv4ToInt(parts) {
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

function inRanges(intValue, ranges) {
  for (const [start, end] of ranges) {
    if (intValue >= start && intValue <= end) return true;
  }
  return false;
}

const BLOCKED_V4_RANGES = [
  [0x00000000, 0x00ffffff], // 0.0.0.0/8        unspecified
  [0x0a000000, 0x0affffff], // 10.0.0.0/8       private
  [0x7f000000, 0x7fffffff], // 127.0.0.0/8      loopback
  [0xa9fe0000, 0xa9feffff], // 169.254.0.0/16   link-local + metadata
  [0xac100000, 0xac1fffff], // 172.16.0.0/12    private
  [0xc0000000, 0xc00000ff], // 192.0.0.0/24     IETF protocol assignments
  [0xc0000200, 0xc00002ff], // 192.0.2.0/24     documentation
  [0xc0a80000, 0xc0a8ffff], // 192.168.0.0/16   private
  [0xc6120000, 0xc613ffff], // 198.18.0.0/15    benchmarking
  [0xc6336400, 0xc63364ff], // 198.51.100.0/24  documentation
  [0xcb007100, 0xcb0071ff], // 203.0.113.0/24   documentation
  [0xe0000000, 0xffffffff], // 224.0.0.0/4      multicast + reserved
];

function isBlockedV4(address) {
  if (!net.isIPv4(address)) return false;
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) return false;
  return inRanges(ipv4ToInt(parts), BLOCKED_V4_RANGES);
}

function isBlockedV6(address) {
  if (address === '::') return true; // unspecified
  if (address === '::1') return true; // loopback
  if (/^::ffff:/.test(address)) return isBlockedV4(address.slice('::ffff:'.length)); // mapped
  if (/^fe80:/i.test(address)) return true; // link-local
  if (/^f[cd][0-9a-f]/i.test(address)) return true; // fc00::/7 ULA
  if (/^ff[0-9a-f]/i.test(address)) return true; // multicast
  if (/^2001:0db8:/i.test(address)) return true; // documentation
  return false;
}

export function isBlockedAddress(address) {
  const value = String(address ?? '').trim();
  if (!value) return true;
  if (net.isIP(value) === 0) return false; // a hostname, resolved by the guard
  return value.includes('.') ? isBlockedV4(value) : isBlockedV6(value);
}

async function defaultLookup(host) {
  const results = await dns.promises.lookup(host, { all: true });
  return results.map((entry) => entry.address);
}

export function makeGuard(opts = {}) {
  const lookup = opts.lookup ?? defaultLookup;
  const isBlocked = opts.isBlocked ?? isBlockedAddress;

  function blocked(host, address) {
    return new GuardError(
      address ? `blocked address for ${host}: ${address}` : `blocked address: ${host}`,
      { address: address ?? host },
    );
  }

  async function assertHost(host) {
    const value = String(host ?? '').trim();
    if (!value) throw new GuardError('empty hostname');
    if (net.isIP(value)) {
      if (isBlocked(value)) throw blocked(value);
      return;
    }
    let addresses = [];
    try {
      addresses = await lookup(value);
    } catch (error) {
      throw new GuardError(`could not resolve ${value}: ${error.code ?? error.message}`);
    }
    if (!addresses.length) throw new GuardError(`no address records for ${value}`);
    for (const address of addresses) if (isBlocked(address)) throw blocked(value, address);
  }

  async function assertUrl(value) {
    let parsed;
    try {
      parsed = new URL(String(value));
    } catch {
      throw new GuardError(`not a valid url: ${value}`);
    }
    if (!/^https?:$/.test(parsed.protocol)) throw new GuardError(`non-http(s) url: ${parsed.href}`);
    await assertHost(parsed.hostname);
    return parsed;
  }

  return {
    assertUrl,
    assertHost,
    isBlocked,
    isBlockedAddress: isBlocked,
  };
}

export function defaultGuard() {
  return makeGuard();
}