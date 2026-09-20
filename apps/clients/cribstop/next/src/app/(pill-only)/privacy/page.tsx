import type { Metadata } from 'next';
import LegalPage from '@/components/LegalPage';
import privacyContent from '@/content/legal/privacy.json';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = {
  title: `Privacy Policy — ${BRAND.brokerage}`,
  description: BRAND.metaDescription,
  // A draft placeholder must never get indexed ahead of the approved copy in #156.
  robots: privacyContent.isDraft ? { index: false, follow: false } : undefined,
};

export default function PrivacyPage() {
  return <LegalPage content={privacyContent} />;
}
