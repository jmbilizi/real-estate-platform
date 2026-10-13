import { serializeJsonLd } from '@/lib/json-ld';

/** Renders one JSON-LD block. Server component, so the block is in the first HTML. */
export default function JsonLd({ data }: { data: object }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  );
}
