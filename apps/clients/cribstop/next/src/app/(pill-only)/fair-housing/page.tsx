import type { Metadata } from 'next';
import LegalPage from '@/components/LegalPage';
import fairHousingContent from '@/content/legal/fair-housing.json';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = {
  title: `Fair Housing — ${BRAND.brokerage}`,
  description: BRAND.metaDescription,
};

export default function FairHousingPage() {
  return <LegalPage content={fairHousingContent} />;
}
