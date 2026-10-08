import type { Metadata } from 'next';
import LegalPage from '@/components/LegalPage';
import accessibilityContent from '@/content/legal/accessibility.json';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = {
  title: `Accessibility — ${BRAND.brokerage}`,
  description: BRAND.metaDescription,
};

export default function AccessibilityPage() {
  return <LegalPage content={accessibilityContent} />;
}
