export default function Footer() {
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
              <li>Real Broker LLC</li>
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
          <h5 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-muted">
            MLS Disclosure
          </h5>
          <div className="space-y-1.5 text-xs leading-relaxed text-ink-muted">
            <p>
              Listing information is provided by Bright MLS and is deemed reliable but not
              guaranteed.
            </p>
            <p>
              The information provided is for personal, non-commercial use and may not be used for
              any purpose other than identifying prospective properties consumers may be interested
              in purchasing or renting.
            </p>
            <p>
              Some properties which appear for sale or rent on this website may no longer be
              available because they are under contract, have closed, or are no longer being
              offered.
            </p>
            <p>
              All listing data is courtesy of the listing broker and Bright MLS. Data last updated:
              April 21, 2026 at 12:00 PM ET.
            </p>
            <p className="font-medium text-ink">Brokered by Real Broker LLC.</p>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-8 flex flex-col items-center justify-between gap-4 border-t border-surface-border pt-6 text-xs text-ink-muted sm:flex-row">
          <p>
            &copy; {new Date().getFullYear()} Cribstop.com &middot; Real Broker LLC. All rights
            reserved.
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
