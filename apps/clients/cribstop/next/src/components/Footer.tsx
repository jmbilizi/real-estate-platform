'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BRAND } from '@/lib/brand';
import { getListingsMeta } from '@/lib/api/listings';
import { PROPERTY_TIME_ZONE } from '@/lib/time-zone';
import type { ListingsMeta } from '@/lib/types';
import PersonaliseSwitch from '@/components/PersonaliseSwitch';

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

  // "Data last updated" means the last successful MLS sync, not the newest listing timestamp
  // (#447) — `lastSyncedAt` is absent on an older deployment and `null` before any run has
  // succeeded, so both fall back to `dataUpdatedAt` rather than hiding the line. Either way, a
  // null result (no publishable listings yet, or the fetch never resolved) omits this line
  // entirely. It must never fall back to the current time — that would be a fabricated fact on a
  // compliance disclosure (PRD §6.3).
  const freshness = meta ? (meta.lastSyncedAt ?? meta.dataUpdatedAt) : null;
  const lastUpdatedFormatted =
    freshness != null
      ? new Date(freshness).toLocaleString('en-US', {
          // One dataset-wide sync time, so no single listing state applies. It uses the fallback zone,
          // and the short zone name below states it on screen (#79).
          timeZone: PROPERTY_TIME_ZONE,
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
      <div className="mx-auto max-w-[1760px] page-gutter py-8">
        {/*
         * Links grid (#1048). Only real destinations: an entry with no page or URL looked like a
         * link and went nowhere. "About" shows once.
         */}
        <nav aria-label="Footer" className="grid grid-cols-2 gap-x-8 gap-y-6 sm:grid-cols-3">
          <div>
            <h4 className="mb-2 text-sm font-semibold text-ink">Explore</h4>
            <ul className="space-y-1.5 text-sm text-ink-muted">
              <li>
                <a href="/homes-for-sale" className="hover:text-ink">
                  Homes for Sale
                </a>
              </li>
              <li>
                <a href="/homes-for-rent" className="hover:text-ink">
                  Rentals
                </a>
              </li>
              <li>
                <a href="/homes-for-sale?type=all" className="hover:text-ink">
                  Search All
                </a>
              </li>
            </ul>
          </div>
          <div>
            <h4 className="mb-2 text-sm font-semibold text-ink">Company</h4>
            <ul className="space-y-1.5 text-sm text-ink-muted">
              <li>
                <a href="/about" className="hover:text-ink">
                  About Us
                </a>
              </li>
              <li>
                <a href={`mailto:${BRAND.contactEmail}`} className="hover:text-ink">
                  Contact
                </a>
              </li>
            </ul>
          </div>
          <div>
            <h4 className="mb-2 text-sm font-semibold text-ink">Legal</h4>
            <ul className="space-y-1.5 text-sm text-ink-muted">
              <li>
                <Link href="/terms" className="hover:text-ink">
                  Terms of Service
                </Link>
              </li>
              <li>
                <Link href="/privacy" className="hover:text-ink">
                  Privacy Policy
                </Link>
              </li>
              <li>
                <Link href="/fair-housing" className="hover:text-ink">
                  Fair Housing
                </Link>
              </li>
              <li>
                <Link href="/accessibility" className="hover:text-ink">
                  Accessibility
                </Link>
              </li>
            </ul>
          </div>
        </nav>

        {/*
         * One card, but its paragraphs are not one claim — they answer to three different
         * conditions, and the original block conflated them:
         *
         * 1. **Bright-branded claims** state where the data came from ("provided by BRIGHT through
         *    a licensing agreement", the Bright copyright, and the IDX-participation sentence,
         *    which only means anything if we display IDX data at all). These render solely when the
         *    dataset actually contains a Bright-sourced row. Every row is `internal` today and
         *    there is no Bright licence (#33), so asserting them now is a false statement of MLS
         *    provenance. The sentences themselves are byte-identical to what shipped before —
         *    #33's display rules plus broker sign-off own any rewording, not this ticket; only the
         *    condition is new.
         * 2. **Source-neutral disclaimers** ("deemed reliable but not guaranteed", "some properties
         *    may no longer be available") are true of our own inventory exactly as they are of
         *    Bright's. Gating them was a mistake: it hid accurate, useful disclosure and left the
         *    card a single sentence tall.
         * 3. **Brokerage identification and freshness** are unconditional facts about us and our
         *    dataset. Real Broker, LLC's prominence (PRD §6.1) must never depend on a data source,
         *    and freshness is still omitted entirely when there is no usable timestamp rather than
         *    backfilled with "now" — a fabricated fact on a compliance disclosure is worse than a
         *    missing one.
         *
         * Because 2 and 3 always render, the card always has a body and needs no outer guard.
         */}
        <div className="mt-8 rounded-md border border-surface-border bg-white p-5">
          <h5 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-muted">
            {showBrightDisclosure ? 'MLS Disclosure' : 'Data Disclosure'}
          </h5>
          <div className="space-y-2 text-xs leading-relaxed text-ink-muted">
            {showBrightDisclosure && (
              <p>
                The data relating to real estate for sale on this website appears in part through
                the BRIGHT Internet Data Exchange program, a voluntary cooperative exchange of
                property listing data between licensed real estate brokerage firms in which Real
                Broker LLC participates, and is provided by BRIGHT through a licensing agreement.
              </p>
            )}
            <p>
              Information Deemed Reliable But Not Guaranteed. The information provided by this
              website is for the personal, non-commercial use of consumers and may not be used for
              any purpose other than to identify prospective properties consumers may be interested
              in purchasing.
            </p>
            <p>
              Some properties which appear for sale on this website may no longer be available
              because they are under contract, have Closed or are no longer being offered for sale.
            </p>
            {showBrightDisclosure && (
              <p>
                Some real estate firms do not participate in IDX and their listings do not appear on
                this website. Some properties listed with participating firms do not appear on this
                website at the request of the seller.
              </p>
            )}
            {lastUpdatedFormatted && <p>Data last updated: {lastUpdatedFormatted}.</p>}
            <p className="font-medium text-ink">
              Brokered by {BRAND.brokerageShort} &middot; Licensed in {BRAND.licensedStates}.
            </p>
            {showBrightDisclosure && (
              <p className="pt-1 text-ink-subtle">
                &copy;{new Date().getFullYear()} Bright, All Rights Reserved. Bright MLS is the
                source of this listing data and is not a real estate broker.
              </p>
            )}
          </div>
        </div>

        {/*
         * Bottom bar (#1048): copyright on the left; the personalise controls and the Equal Housing
         * link on the right, on one row from `md` up. The controls used to take their own block.
         */}
        <div className="mt-6 flex flex-col gap-2 border-t border-surface-border pt-4 text-xs text-ink-muted md:flex-row md:items-center md:justify-between">
          <p>
            &copy; {new Date().getFullYear()} {BRAND.brokerageShort}. All rights reserved. |{' '}
            {BRAND.siteDomain}
          </p>
          <div className="flex flex-wrap items-center gap-x-4">
            <PersonaliseSwitch inline />
            <a
              href="https://www.hud.gov/program_offices/fair_housing_equal_opp"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[44px] items-center underline hover:text-ink"
            >
              {BRAND.equalHousingOpportunity}
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
