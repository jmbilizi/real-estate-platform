import type { Metadata } from 'next';
import LegalPage from '@/components/LegalPage';
import termsContent from '@/content/legal/terms.json';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = {
  title: `Terms of Service — ${BRAND.brokerage}`,
  description: BRAND.metaDescription,
  // A draft placeholder must never get indexed ahead of the approved copy in #156.
  robots: termsContent.isDraft ? { index: false, follow: false } : undefined,
};

export default function TermsPage() {
  return <LegalPage content={termsContent} />;
}
