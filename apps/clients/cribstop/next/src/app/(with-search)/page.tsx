import type { Metadata } from 'next';
import HomePageContent from '@/components/HomePageContent';
import JsonLd from '@/components/JsonLd';
import ScrollSentinel from '@/components/ScrollSentinel';
import { BRAND } from '@/lib/brand';
import { organizationJsonLd } from '@/lib/organization-jsonld';
import { publishableOrigin } from '@/lib/publishable-origin';

// `SITE_ORIGIN` is read per request: one image serves every environment.
export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  const origin = publishableOrigin();
  const title = `${BRAND.brokerage} — ${BRAND.titleSuffix}`;
  const description = BRAND.metaDescription;
  return {
    title: { absolute: title },
    description,
    ...(origin ? { alternates: { canonical: `${origin}/` } } : {}),
    openGraph: {
      type: 'website',
      siteName: BRAND.brokerage,
      title,
      description,
      ...(origin ? { url: `${origin}/` } : {}),
    },
    twitter: { card: 'summary', title, description },
  };
}

export default function HomePage() {
  const jsonLd = organizationJsonLd(publishableOrigin());
  return (
    <>
      {jsonLd ? <JsonLd data={jsonLd} /> : null}
      <ScrollSentinel />
      <HomePageContent />
    </>
  );
}
