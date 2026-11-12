import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { LegalDocument } from '@/components/legal-document';
import { legalDocument } from '@/lib/legal';

// The deployment's own terms, from LEGAL_DIR (lib/legal.ts); no terms, no
// page. English only — see components/legal-document.tsx.
export const dynamic = 'force-static';

// A deployment with no terms page answers 404 under the not-found page's own title.
export function generateMetadata(): Metadata {
  if (!legalDocument('terms')) return {};
  return {
    title: 'Terms of Service',
    alternates: { canonical: '/terms' },
    description: 'The terms that govern using this service.',
  };
}

export default function TermsPage() {
  const markdown = legalDocument('terms');
  if (!markdown) notFound();
  return <LegalDocument markdown={markdown} />;
}
