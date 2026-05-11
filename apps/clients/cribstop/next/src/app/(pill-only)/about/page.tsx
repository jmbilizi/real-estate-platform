'use client';

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 lg:px-8">
      <h1 className="font-display text-3xl font-extrabold sm:text-4xl">About Cribstop.com</h1>
      <p className="mt-4 text-lg leading-relaxed text-ink-muted">
        Cribstop.com is your modern real estate marketplace, designed to make buying, selling, and
        renting homes as seamless as booking a trip. We combine beautiful design with powerful
        search to help you find your perfect home in the DMV area and beyond.
      </p>

      <div className="mt-12 grid gap-8 sm:grid-cols-2">
        <div className="rounded-2xl border border-surface-border bg-white p-6 shadow-card">
          <h2 className="font-display text-xl font-bold">Our Brokerage</h2>
          <p className="mt-3 text-sm leading-relaxed text-ink-muted">
            Cribstop.com is proudly operated under <strong>Real Broker LLC</strong>, a nationally
            recognized, technology-driven real estate brokerage. Our agents leverage cutting-edge
            tools to deliver a premium experience for every client.
          </p>
        </div>
        <div className="rounded-2xl border border-surface-border bg-white p-6 shadow-card">
          <h2 className="font-display text-xl font-bold">Our Mission</h2>
          <p className="mt-3 text-sm leading-relaxed text-ink-muted">
            We believe finding a home should be inspiring, not overwhelming. Every feature on
            Cribstop.com is designed to give you confidence—from verified listings and transparent
            broker attribution to neighborhood insights and real-time search alerts.
          </p>
        </div>
      </div>

      {/* Fair housing */}
      <div className="mt-12 rounded-2xl border border-surface-border bg-surface-alt p-8">
        <h2 className="font-display text-xl font-bold">Fair Housing & Compliance</h2>
        <div className="mt-4 space-y-3 text-sm leading-relaxed text-ink-muted">
          <p>
            Real Broker LLC is committed to the principles of the Fair Housing Act. We do not
            discriminate on the basis of race, color, religion, sex, handicap, familial status, or
            national origin.
          </p>
          <p>
            Listing information displayed on Cribstop.com is provided by Bright MLS and is deemed
            reliable but not guaranteed. The information is for personal, non-commercial use only
            and may not be used for any purpose other than identifying prospective properties
            consumers may be interested in purchasing or renting.
          </p>
          <p>
            Some properties which appear for sale or rent on this website may no longer be available
            because they are under contract, have closed, or are no longer being offered for sale or
            rent.
          </p>
          <p>
            All listing data is provided courtesy of the listing broker. Data last updated: April
            21, 2026 at 12:00 PM ET.
          </p>
          <p className="font-medium text-ink">
            Brokered by Real Broker LLC. Equal Housing Opportunity.
          </p>
        </div>
      </div>

      {/* Contact */}
      <div className="mt-12">
        <h2 className="font-display text-xl font-bold">Get in Touch</h2>
        <div className="mt-4 space-y-1 text-sm text-ink-muted">
          <p>Real Broker LLC</p>
          <p>support@cribstop.com</p>
          <p>(800) 555-CRIB</p>
        </div>
      </div>
    </div>
  );
}
