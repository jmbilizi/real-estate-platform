import type { Metadata } from 'next';
import LegalPage from '@/components/LegalPage';
import termsContent from '@/content/legal/terms.json';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = {
  title: `Terms of Service — ${BRAND.brokerage}`,
  description: BRAND.metaDescription,
};

export default function TermsPage() {
  return <LegalPage content={termsContent} />;
}
