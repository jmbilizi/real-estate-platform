import listings from '@/lib/listings';
import { BRAND } from '@/lib/brand';

export default function Footer() {
  const lastUpdated = listings.reduce(
    (max, l) => (l.lastUpdated > max ? l.lastUpdated : max),
    listings[0].lastUpdated,
  );
  const lastUpdatedFormatted = new Date(lastUpdated).toLocaleString('en-US', {
    timeZone: 'America/New_York',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });

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

        {/* MLS Compliance Disclosures */}
        <div className="mt-10 rounded-2xl border border-surface-border bg-white p-6">
          <h5 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-muted">
            MLS Disclosure
          </h5>
          <div className="space-y-2 text-xs leading-relaxed text-ink-muted">
            <p>
              The data relating to real estate for sale on this website appears in part through the
              BRIGHT Internet Data Exchange program, a voluntary cooperative exchange of property
              listing data between licensed real estate brokerage firms in which Real Broker LLC
              participates, and is provided by BRIGHT through a licensing agreement.
            </p>
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
            <p>
              Some real estate firms do not participate in IDX and their listings do not appear on
              this website. Some properties listed with participating firms do not appear on this
              website at the request of the seller.
            </p>
            <p>Data last updated: {lastUpdatedFormatted}.</p>
            <p className="font-medium text-ink">
              Brokered by {BRAND.brokerageShort} &middot; Licensed in {BRAND.licensedStates}.
            </p>
            <p className="pt-1 text-ink-subtle">
              &copy;{new Date().getFullYear()} Bright, All Rights Reserved. Bright MLS is the source
              of this listing data and is not a real estate broker.
            </p>
          </div>
        </div>

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
