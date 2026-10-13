import type { Metadata } from 'next';
import HomePageContent from '@/components/HomePageContent';
import JsonLd from '@/components/JsonLd';
import ScrollSentinel from '@/components/ScrollSentinel';
import { BRAND } from '@/lib/brand';
import { organizationJsonLd } from '@/lib/organization-jsonld';
import { publishableOrigin } from '@/lib/publishable-origin';

// ISR keeps the home page cacheable. Regeneration reads the runtime `SITE_ORIGIN`, because one image
// serves every environment. No build step sets `SITE_ORIGIN` (only the deploy does), so the prerender
// has no JSON-LD or canonical. A pod serves that page until its first regeneration, up to about 300 s
// after the first request. Never set `SITE_ORIGIN` at build time. Never add `force-dynamic` (#871).
export const revalidate = 300;

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
