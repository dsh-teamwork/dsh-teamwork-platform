// Types for canonical-host.mjs, which next.config.mjs imports as plain ESM (allowJs is off here).
export interface HostRedirect {
  source: string;
  has: { type: 'host'; value: string }[];
  destination: string;
  permanent: true;
}

export function canonicalHostRedirects(env: Record<string, string | undefined>): HostRedirect[];
