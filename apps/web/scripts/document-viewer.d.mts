// The types of document-viewer.mjs, for vite.config.ts and the App's Metro transformer.
import type { Plugin } from 'vite';

export function buildDocumentViewer(): Promise<{ html: string; inputs: string[] }>;
export function documentViewer(): Plugin;
