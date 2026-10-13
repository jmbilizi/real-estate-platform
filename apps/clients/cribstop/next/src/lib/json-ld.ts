/**
 * Serializes a JSON-LD object for a `<script type="application/ld+json">` body.
 * It escapes `<`, so listing text cannot close the script tag.
 */
export function serializeJsonLd(data: object): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
