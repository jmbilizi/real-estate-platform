"use client";
import SearchSection from "@/components/SearchSection";
import ListingRow from "@/components/ListingRow";
import NeighborhoodRow from "@/components/NeighborhoodRow";
import listings from "@/lib/listings";
import Link from "next/link";
import { useApp } from "@/lib/context";

const NEIGHBORHOODS = [
  {
    name: "Penn Quarter",
    city: "Washington, DC",
    count: 24,
    img: "https://images.unsplash.com/photo-1501594907352-04cda38ebc29?w=900&auto=format&fit=crop&q=75",
  },
  {
    name: "Federal Hill",
    city: "Baltimore, MD",
    count: 18,
    img: "https://images.unsplash.com/photo-1449157291145-7efd050a4d0e?w=900&auto=format&fit=crop&q=75",
  },
  {
    name: "Old Town",
    city: "Alexandria, VA",
    count: 31,
    img: "https://images.unsplash.com/photo-1486325212027-8081e485255e?w=900&auto=format&fit=crop&q=75",
  },
  {
    name: "Downtown Bethesda",
    city: "Bethesda, MD",
    count: 15,
    img: "https://images.unsplash.com/photo-1460317442991-0ec209397118?w=900&auto=format&fit=crop&q=75",
  },
  {
    name: "Logan Circle",
    city: "Washington, DC",
    count: 22,
    img: "https://images.unsplash.com/photo-1464983953574-0892a716854b?w=900&auto=format&fit=crop&q=75",
  },
  {
    name: "Fells Point",
    city: "Baltimore, MD",
    count: 17,
    img: "https://images.unsplash.com/photo-1465101046530-73398c7f28ca?w=900&auto=format&fit=crop&q=75",
  },
  {
    name: "Del Ray",
    city: "Alexandria, VA",
    count: 19,
    img: "https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=900&auto=format&fit=crop&q=75",
  },
  {
    name: "Chevy Chase",
    city: "Bethesda, MD",
    count: 13,
    img: "https://images.unsplash.com/photo-1460474647541-4edd0cd0c746?w=900&auto=format&fit=crop&q=75",
  },
];

export default function HomePageContent() {
  const { listingTab } = useApp();

  const featured = listings.filter(
    (l) => l.featured && l.listingType === (listingTab === "for-sale" ? "sale" : "rent"),
  );
  const forSale = listings.filter((l) => l.listingType === "sale");
  const forRent = listings.filter((l) => l.listingType === "rent");
  const luxury = listings.filter((l) => {
    if (listingTab === "for-sale") {
      return l.price >= 1000000 && l.listingType === "sale";
    } else {
      return l.price >= 5000 && l.listingType === "rent";
    }
  });
  const recent = listings.filter((l) => l.listingType === (listingTab === "for-sale" ? "sale" : "rent")).slice(0, 20);

  return (
    <>
      {/* Tab strip now lives in the Header for all screen sizes */}
      {/* Search bar — coordinates header tabs↔pill via AppContext */}
      <SearchSection />

      <ListingRow
        title={listingTab === "for-sale" ? "Featured homes for sale" : "Featured homes for rent"}
        subtitle={listingTab === "for-sale" ? "Hand-picked homes for sale" : "Hand-picked homes for rent"}
        href={listingTab === "for-sale" ? "/search?listingType=sale" : "/search?listingType=rent"}
        listings={featured.length ? featured : recent}
        max={5}
      />

      {listingTab === "for-sale" && (
        <ListingRow
          title="Popular homes for sale"
          subtitle="Trending in Washington, Baltimore, and Northern Virginia"
          href="/search?listingType=sale"
          listings={forSale}
          max={5}
        />
      )}

      {listingTab === "for-rent" && (
        <ListingRow
          title="Available homes for rent"
          subtitle="Move-in ready across the DMV"
          href="/search?listingType=rent"
          listings={forRent}
          max={5}
        />
      )}

      <NeighborhoodRow
        title="Explore neighborhoods"
        subtitle="Popular areas across the DMV"
        href="/search?group=neighborhoods"
        neighborhoods={NEIGHBORHOODS}
        max={4}
      />

      <ListingRow
        title={listingTab === "for-sale" ? "Luxury collection for sale" : "Luxury homes for rent"}
        subtitle={
          listingTab === "for-sale"
            ? "Standout homes for sale priced $1M and above"
            : "High-end homes for rent priced $5K and above"
        }
        href={
          listingTab === "for-sale"
            ? "/search?minPrice=1000000&listingType=sale"
            : "/search?minPrice=5000&listingType=rent"
        }
        listings={luxury}
        max={5}
      />

      <ListingRow
        title={listingTab === "for-sale" ? "Just listed homes for sale" : "Just listed homes for rent"}
        subtitle={
          listingTab === "for-sale" ? "Fresh inventory you don't want to miss" : "Newly available homes for rent"
        }
        href={listingTab === "for-sale" ? "/search?listingType=sale" : "/search?listingType=rent"}
        listings={recent}
        max={5}
      />

      <section className="mx-auto mt-16 max-w-[1760px] px-6 pb-16 sm:px-10 lg:px-20">
        <div className="overflow-hidden rounded-3xl bg-surface-alt text-ink border border-surface-border">
          <div className="grid gap-8 px-8 py-12 sm:grid-cols-[1.4fr_1fr] sm:items-center sm:px-12 sm:py-16 lg:px-16">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-400">Real Broker LLC</p>
              <h2 className="mt-3 font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
                Trusted by buyers, sellers, and renters across the DMV.
              </h2>
              <p className="mt-4 text-base leading-relaxed text-ink/80">
                Cribstop is powered by Real Broker LLC — one of the fastest-growing brokerages in the country. Our
                agents combine deep local expertise with modern technology to deliver a smooth, transparent experience.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link
                  href="/about"
                  className="inline-flex items-center justify-center rounded-full bg-brand-50 px-5 py-2.5 text-sm font-semibold text-brand-900 transition hover:bg-brand-100 hover:text-brand-900"
                >
                  Learn more
                </Link>
                <Link
                  href="/search"
                  className="inline-flex items-center justify-center rounded-full border border-brand-200 px-5 py-2.5 text-sm font-semibold text-brand-900 transition hover:bg-brand-50 hover:text-brand-900"
                >
                  Browse homes
                </Link>
              </div>
            </div>
            <dl className="grid grid-cols-3 gap-6 sm:gap-8">
              {[
                ["12k+", "Active listings"],
                ["3", "States covered"],
                ["MLS", "Daily updates"],
              ].map(([big, label]) => (
                <div key={label}>
                  <dt className="font-display text-3xl font-extrabold sm:text-4xl">{big}</dt>
                  <dd className="mt-1 text-xs uppercase tracking-wider text-ink/60">{label}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>
    </>
  );
}
