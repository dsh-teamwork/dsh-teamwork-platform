// The types of vite-pages.mjs, for the vite.config.ts files that load it.
import type { Plugin } from 'vite';

export function publicPages(): Plugin;
export function legalSources(): { privacy: string; terms: string } | null;
