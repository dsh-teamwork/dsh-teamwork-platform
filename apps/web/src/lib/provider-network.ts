/**
 * Where a provider may be called from this server (ADR 0006). A team admin,
 * not the operator, names a provider's address, so on a shared instance an
 * address is a way to make this server call its own network. The rule:
 *
 * | Scheme  | Without ALLOW_PRIVATE_PROVIDERS | With it                   |
 * | ------- | ------------------------------- | ------------------------- |
 * | https   | every address public            | any address               |
 * | http    | never                           | every address private     |
 *
 * Private means loopback, the private ranges, link-local (cloud metadata
 * lives there), carrier-grade NAT and the unspecified address. `npx` and
 * `compose.yaml` opt in, so a team can call a model it serves itself; the
 * hosted service does not.
 *
 * The rule is checked when an address is saved, for a quick answer, and again
 * on the connection itself: the socket resolves the host through
 * `guardedLookup`, so an answer that changed since the check — DNS rebinding —
 * is refused rather than connected to.
 */

import 'server-only';

import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP, type LookupFunction } from 'node:net';

import { Agent, fetch as undiciFetch } from 'undici';

import { TeamError } from '@/lib/team';

const PRIVATE = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
] as const) {
  PRIVATE.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
] as const) {
  PRIVATE.addSubnet(network, prefix, 'ipv6');
}

function isPrivateAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
  if (mapped) return PRIVATE.check(mapped, 'ipv4');
  const family = isIP(address);
  return family === 0 || PRIVATE.check(address, family === 6 ? 'ipv6' : 'ipv4');
}

export const privateProvidersAllowed = () => process.env.ALLOW_PRIVATE_PROVIDERS?.trim() === 'true';

/** Whether a resolved address may be called over `protocol` (`https:` or `http:`). */
export function addressAllowed(address: string, protocol: string, allowPrivate = privateProvidersAllowed()): boolean {
  if (protocol === 'https:') return allowPrivate || !isPrivateAddress(address);
  if (protocol === 'http:') return allowPrivate && isPrivateAddress(address);
  return false;
}

const bare = (hostname: string) => hostname.replace(/^\[|\]$/g, '');

/**
 * `provider_address_refused` unless every address the host resolves to may be
 * called. Run when an address is saved and before every call; the connection
 * checks again (`guardedLookup`).
 */
export async function checkProviderAddress(url: URL): Promise<void> {
  const host = bare(url.hostname);
  let addresses: string[];
  try {
    addresses = isIP(host) ? [host] : (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);
  } catch {
    throw new TeamError(400, 'provider_address_refused');
  }
  if (!addresses.length || !addresses.every((address) => addressAllowed(address, url.protocol))) {
    throw new TeamError(400, 'provider_address_refused');
  }
}

/**
 * The resolver a connection to a provider uses: every answer must pass the
 * rule for `protocol`, or the connection fails before it opens.
 */
export function guardedLookup(protocol: string, resolve: typeof dnsLookup = dnsLookup): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname, { ...options, all: true }, (error, found) => {
      if (error) return callback(error, '', 0);
      const addresses = found as unknown as LookupAddress[];
      if (!addresses.length || !addresses.every((a) => addressAllowed(a.address, protocol))) {
        const refused = Object.assign(new Error(`provider address refused for ${hostname}`), { code: 'EADDRNOTAVAIL' });
        return callback(refused, '', 0);
      }
      if (options.all) return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, addresses);
      callback(null, addresses[0].address, addresses[0].family);
    });
  };
}

// One connection pool per scheme. A literal IP never reaches a lookup, which
// is why `checkProviderAddress` runs before every call as well.
const agents = new Map<string, Agent>();
function agentFor(protocol: string): Agent {
  const key = `${protocol}${privateProvidersAllowed()}`;
  let agent = agents.get(key);
  if (!agent) agents.set(key, (agent = new Agent({ connect: { lookup: guardedLookup(protocol) } })));
  return agent;
}

/** How the gateway calls a provider; tests pass their own. */
export type ProviderRequest = (url: string, init: RequestInit) => Promise<Response>;

/** `fetch` to a provider: the address checked now, and again as the socket connects. */
export const providerFetch: ProviderRequest = async (url, init) => {
  const target = new URL(url);
  await checkProviderAddress(target);
  return (await undiciFetch(target, { ...(init as object), dispatcher: agentFor(target.protocol) })) as unknown as Response;
};
