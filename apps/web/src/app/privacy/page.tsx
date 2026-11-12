import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { LegalDocument } from '@/components/legal-document';
import { legalDocument } from '@/lib/legal';

// The deployment's own privacy policy, from LEGAL_DIR (lib/legal.ts); no
// policy, no page. English only — see components/legal-document.tsx.
export const dynamic = 'force-static';

// A deployment with no privacy page answers 404 under the not-found page's own title.
export function generateMetadata(): Metadata {
  if (!legalDocument('privacy')) return {};
  return {
    title: 'Privacy Policy',
    alternates: { canonical: '/privacy' },
    description: 'What we collect, where it is kept, who can see it, and how to have it removed.',
  };
}

export default function PrivacyPage() {
  const markdown = legalDocument('privacy');
  if (!markdown) notFound();
  return <LegalDocument markdown={markdown} />;
}
