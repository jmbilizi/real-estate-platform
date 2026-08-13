'use client';

import { useEffect, useState } from 'react';
import { BRAND } from '@/lib/brand';
import { getListingsMeta } from '@/lib/api/listings';
import type { ListingsMeta } from '@/lib/types';

export default function Footer() {
  // The footer renders on every route, including ones that never search, so freshness is fetched
  // independently of any search result — a paginated search response would make this line mean
  // "newest listing on page 1", which is wrong on every page and silently wrong.
  const [meta, setMeta] = useState<ListingsMeta | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    getListingsMeta(controller.signal)
      .then(setMeta)
      .catch(() => {
        // Chrome, not a task: a failed fetch simply leaves `meta` null, which omits the
        // freshness line and the Bright disclosure below. No error UI, no toast, no throw —
        // the footer must never be able to take down every page it renders on.
      });
    return () => controller.abort();
  }, []);

  // `dataUpdatedAt === null` (no publishable listings yet, or the fetch never resolved) omits
  // this line entirely. It must never fall back to the current time — that would be a
  // fabricated fact on a compliance disclosure (PRD §6.3).
  const lastUpdatedFormatted =
    meta?.dataUpdatedAt != null
      ? new Date(meta.dataUpdatedAt).toLocaleString('en-US', {
          timeZone: 'America/New_York',
          month: 'long',
          day: 'numeric',
          year: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          timeZoneName: 'short',
        })
      : null;

  // The Bright-specific IDX disclosure is a claim about where the data came from — it must only
  // render when the dataset actually contains a Bright-sourced row. Rendering it unconditionally
  // (the old behaviour) is a false claim once any non-Bright source exists.
  const showBrightDisclosure = meta?.sources.includes('brightMLS') ?? false;

  return (
    <footer className="border-t border-surface-border bg-surface-alt">
      <div className="px-6 py-10 sm:px-10 lg:px-20">
        {/* Links grid */}
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
          <div>
            <h4 className="mb-3 text-sm font-semibold text-ink">Explore</h4>
            <ul className="space-y-2 text-sm text-ink-muted">
              <li>
                <a href="/search?listingType=sale" className="hover:text-ink">
                  Homes for Sale
                </a>
              </li>
              <li>
                <a href="/search?listingType=rent" className="hover:text-ink">
                  Rentals
                </a>
              </li>
              <li>
                <a href="/search" className="hover:text-ink">
                  Search All
                </a>
              </li>
              <li>
                <a href="/about" className="hover:text-ink">
                  About
                </a>
              </li>
            </ul>
          </div>
          <div>
            <h4 className="mb-3 text-sm font-semibold text-ink">Company</h4>
            <ul className="space-y-2 text-sm text-ink-muted">
              <li>{BRAND.brokerageShort}</li>
              <li>
                <a href="/about" className="hover:text-ink">
                  About Us
                </a>
              </li>
              <li>
                <span>Careers</span>
              </li>
              <li>
                <span>Contact</span>
              </li>
            </ul>
          </div>
          <div>
            <h4 className="mb-3 text-sm font-semibold text-ink">Legal</h4>
            <ul className="space-y-2 text-sm text-ink-muted">
              <li>
                <span>Terms of Service</span>
              </li>
              <li>
                <span>Privacy Policy</span>
              </li>
              <li>
                <span>Fair Housing</span>
              </li>
              <li>
                <span>Accessibility</span>
              </li>
            </ul>
          </div>
          <div>
            <h4 className="mb-3 text-sm font-semibold text-ink">Connect</h4>
            <ul className="space-y-2 text-sm text-ink-muted">
              <li>
                <span>Facebook</span>
              </li>
              <li>
                <span>Instagram</span>
              </li>
              <li>
                <span>LinkedIn</span>
              </li>
              <li>
                <span>YouTube</span>
              </li>
            </ul>
          </div>
        </div>

        {/*
         * Three separate disclosures with three separate conditions. They were previously one
         * block, which conflated them:
         *
         * 1. The Bright IDX claim is a statement about where the data came from, so it renders only
         *    when the dataset actually contains a Bright-sourced row. The sentences are
         *    byte-identical to what shipped before — #33's display rules plus broker sign-off own
         *    any rewording, not this ticket; only the gating condition is new.
         * 2. Dataset freshness is true of *our* data whatever its source, so it must not be gated on
         *    Bright. Nesting it inside the Bright block meant an internal-only dataset — which is
         *    every dataset today — showed no freshness at all despite having a real value. It is
         *    still omitted entirely when there is no usable timestamp, and never backfilled with
         *    "now": a fabricated fact on a compliance disclosure is worse than a missing one.
         * 3. Brokerage identification is unconditional. It was inside the Bright block too, so
         *    Real Broker, LLC's prominence (PRD §6.1) disappeared along with the MLS claim.
         */}
        {(showBrightDisclosure || lastUpdatedFormatted) && (
          <div className="mt-10 rounded-md border border-surface-border bg-white p-6">
            <h5 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-muted">
              {showBrightDisclosure ? 'MLS Disclosure' : 'Data Disclosure'}
            </h5>
            <div className="space-y-2 text-xs leading-relaxed text-ink-muted">
              {showBrightDisclosure && (
                <>
                  <p>
                    The data relating to real estate for sale on this website appears in part
                    through the BRIGHT Internet Data Exchange program, a voluntary cooperative
                    exchange of property listing data between licensed real estate brokerage firms
                    in which Real Broker LLC participates, and is provided by BRIGHT through a
                    licensing agreement.
                  </p>
                  <p>
                    Information Deemed Reliable But Not Guaranteed. The information provided by this
                    website is for the personal, non-commercial use of consumers and may not be used
                    for any purpose other than to identify prospective properties consumers may be
                    interested in purchasing.
                  </p>
                  <p>
                    Some properties which appear for sale on this website may no longer be available
                    because they are under contract, have Closed or are no longer being offered for
                    sale.
                  </p>
                  <p>
                    Some real estate firms do not participate in IDX and their listings do not
                    appear on this website. Some properties listed with participating firms do not
                    appear on this website at the request of the seller.
                  </p>
                </>
              )}
              {lastUpdatedFormatted && <p>Data last updated: {lastUpdatedFormatted}.</p>}
              {showBrightDisclosure && (
                <p className="pt-1 text-ink-subtle">
                  &copy;{new Date().getFullYear()} Bright, All Rights Reserved. Bright MLS is the
                  source of this listing data and is not a real estate broker.
                </p>
              )}
            </div>
          </div>
        )}

        {/* Brokerage identification — never conditional on a data source (PRD §6.1). */}
        <p className="mt-6 text-xs font-medium leading-relaxed text-ink">
          Brokered by {BRAND.brokerageShort} &middot; Licensed in {BRAND.licensedStates}.
        </p>

        {/* Bottom bar */}
        <div className="mt-8 flex flex-col items-center justify-between gap-4 border-t border-surface-border pt-6 text-xs text-ink-muted sm:flex-row">
          <p>
            &copy; {new Date().getFullYear()} {BRAND.brokerageShort}. All rights reserved. |{' '}
            {BRAND.siteDomain}
          </p>
          <p>
            <a
              href="https://www.hud.gov/program_offices/fair_housing_equal_opp"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-ink"
            >
              Equal Housing Opportunity
            </a>
          </p>
        </div>
      </div>
    </footer>
  );
}
