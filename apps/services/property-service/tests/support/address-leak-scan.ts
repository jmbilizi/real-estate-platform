/**
 * Whole-payload address-leak scan for the e2e suite (#153).
 *
 * A literal-only scan (`serialised.includes(streetLine)`) misses the street rendered as a URL
 * slug, which is exactly how a real CDN would name a media file ("123-maple-st-front.jpg" instead
 * of "123 Maple St"). This checks both forms so a leak through either shape fails the scan.
 */
export function payloadLeaksAddress(
  serialisedPayload: string,
  streetLine: string,
  streetSlug: string,
): boolean {
  return serialisedPayload.includes(streetLine) || serialisedPayload.toLowerCase().includes(streetSlug);
}
