'use client';

import { Copy, Heart, Share2 } from 'lucide-react';
import ListingCardMenu from '@/components/ListingCardMenu';
import { CARD_HOVER_CLASS } from '@/components/cardHover';
import type { ListingCardRow } from '@/lib/types';
import { useApp } from '@/lib/context';
import { openListingPanel } from '@/lib/listing-panel';
import { copyToClipboard } from '@/lib/clipboard';
import { formatNewListingBadge, formatTimeOnMarket } from '@/lib/format';
import { useMinuteClock } from '@/lib/useMinuteClock';
import { buildListingShare, listingShareUrl } from '@/lib/listing-share';
import { shareOrigin } from '@/lib/site-origin';
import {
  formatCardAddress,
  formatClosePrice,
  formatComingSoonBadge,
  formatComingSoonBadgeShort,
  formatDwellingStats,
  formatListingPrice,
  formatLotSize,
  formatOpenHouseBadge,
  formatOpenHouseDate,
  formatOpenHouseTimeAndDate,
  officeAvatarTone,
  officeInitial,
} from '@/lib/listing-format';
import { useToast } from '@/lib/useToast';
import {
  describeCardPriceChange,
  describePriceChange,
  formatCardPriceChange,
  formatCardPriceChangeAmount,
  formatCardPriceChangeDate,
} from '@/lib/price-change';
import ListingImage from '@/components/listing/ListingImage';
import { SampleBadge, SponsoredBadge } from '@/components/listing/ListingBadges';

export default function ListingCard({ listing }: { listing: ListingCardRow }) {
  const { toggleSave, isSaved } = useApp();
  const { toast } = useToast();
  const saved = isSaved(listing.propertyId);

  /**
   * Opens the detail panel on this row, on the click, with no network in the way.
   *
   * This has been through two designs that both put a request between the click and the first
   * frame. It pushed `?listing=<id>` and let a listener in the root layout read it, which meant the
   * modal could not exist until hydration. Then it pushed `/listing/<id>` for
   * `@modal/(.)listing/[id]` to intercept, with a `loading.tsx` to cover the gap — but a loading
   * boundary belongs to the segment it sits in, so the browser had to fetch that segment's RSC
   * payload *and* its chunk before it could draw anything. Measured on the search page: 519ms from
   * click to skeleton, of which the first 451ms was the payload alone, and the hover prefetch meant
   * to hide it does nothing in `next dev` and never fires for a tap or a keypress.
   *
   * Neither round trip bought anything: the intercepted route resolved no data. So the open is now
   * local state — see `lib/listing-panel` — and the whole row goes with it, which is what lets the
   * panel open on this listing's own address, badges, price and photo instead of on grey blocks.
   */
  const openPanel = () => openListingPanel(listing.id, listing);

  const isSold = listing.listingType === 'sold' || listing.status === 'Sold';
  const isParcel = listing.propertyType === 'Land';

  // #424. The stakeholder-approved status badge, leading the top-left stack (see below).
  const isComingSoon = listing.status === 'Coming Soon';

  /**
   * #433. Time on market at the right end of the footer row — omitted entirely
   * when there is no `listedAt` to show, or when the listing is Coming Soon: its own badge already
   * carries the date, and this line would otherwise show a stale "time on market" for a listing
   * that has not gone active yet.
   */
  // #459. The shared minute clock is null until hydration ends, so the first render is the day bucket.
  const minuteNow = useMinuteClock(!isComingSoon && listing.listedAtPrecise !== null);
  const now = minuteNow ?? Date.now();
  const precise = minuteNow === null ? null : listing.listedAtPrecise;

  /**
   * #542. Under 7 days the age moves into a new-listing badge, so the footer slot stays empty to
   * avoid repeating it. Coming Soon wins outright and a sold row never gets the badge.
   */
  const newListingBadge =
    isComingSoon || isSold ? null : formatNewListingBadge(listing.listedAt, now, precise);
  const isNew = newListingBadge !== null;
  const timeOnMarket =
    isComingSoon || isNew ? null : formatTimeOnMarket(listing.listedAt, now, precise);

  /**
   * #433. Share this listing: the Web Share API on a device that has one, the clipboard (with a
   * toast) everywhere else. Same handler `ListingDetailContent` uses, reused here rather than
   * reimplemented, so the shared text/disclosures have one source (`lib/listing-share`).
   */
  async function handleShare(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const url = listingShareUrl(listing.propertyPath, shareOrigin());
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share(buildListingShare(listing, url));
        return;
      } catch (err) {
        // A dismissed share sheet is a choice, not a failure — see ListingDetailContent's own
        // handler for why only this one error name is swallowed.
        if ((err as { name?: string } | null)?.name === 'AbortError') return;
      }
    }
    if (await copyToClipboard(url)) toast('Link copied');
    else toast('We could not copy the link.', 'error');
  }

  /** #433/#452. The more-options menu's one item: a direct copy, no share-sheet attempt. Closing
   *  the menu itself is `ListingCardMenu`'s job, not this handler's. */
  async function handleCopyLink(e: React.MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    e.stopPropagation();
    const url = listingShareUrl(listing.propertyPath, shareOrigin());
    if (await copyToClipboard(url)) toast('Link copied');
    else toast('We could not copy the link.', 'error');
  }

  /**
   * A parcel has no dwelling to describe, so lot size replaces the bed/bath/sqft triplet — that is
   * what a consumer scanning parcels needs and what every incumbent shows for land. Everything
   * else falls back to whichever parts of the triplet the API actually sent.
   */
  const statsLine = isParcel
    ? formatLotSize(listing.lotSqft)
    : formatDwellingStats(listing.beds, listing.baths, listing.sqft);

  const price = formatListingPrice(listing.price, listing.listingType);
  const soldLine = isSold ? formatClosePrice(listing.closePrice, listing.closeDate) : null;

  /**
   * Open house is a pill in the top-left stack, with its date and time on the row beneath it.
   *
   * Three shapes have been tried and each failed on one of two things — card height, or the date.
   * A card once carried three separate affordances, including a full date/time **text row below the
   * image**: that row was the only one open-house cards had and other cards did not, so tiles in a
   * grid came out different heights. Collapsing it into a single corner pill fixed the height and
   * cost the date, and "Open Sat" does not say *which* Saturday — for an open house that is a
   * wasted trip to a house. A full-width band across the foot of the image kept both, but put a
   * gradient scrim over the photo to stay legible.
   *
   * This keeps both and drops the scrim: two rows in the same top-left stack as the marketing pill,
   * inside the fixed-aspect image, so the card height is untouched and the whole statement fits.
   *
   * A **sold** row never shows one. The API only sends upcoming occurrences, but a sold listing
   * with one would be actively misleading, so the sold ribbon wins outright.
   */
  const openHouse = !isSold && listing.openHouse ? listing.openHouse : null;

  /**
   * The marketing pill shares the top-left stack with open house rather than contending for one
   * slot — it takes the top row when both are present. The required disclosure labels (sample,
   * sponsored) are not in this rotation and never have been: they have their own guaranteed row
   * below the image, because a marketing badge must never be able to displace a label that has to
   * be shown.
   */
  // #717. A visible increase and the "Price reduced" pill never show together.
  const priceChange = describePriceChange(listing, now);
  const marketingBadge =
    listing.priceReduced && priceChange?.direction !== 'up'
      ? 'Price reduced'
      : listing.newConstruction
        ? 'New construction'
        : listing.featured
          ? 'Featured'
          : null;

  return (
    /*
     * `role="link"` with a key handler rather than a bare `onClick` div: the card was reachable by
     * mouse and touch only, so a keyboard user could not open a listing at all. It is not a real
     * `<a>` because the save control is a `<button>` inside this box, and interactive content
     * nested in an anchor is invalid HTML — the accessible-name and focus behaviour of the pair
     * stops being defined. Enter and Space both activate, which is what a link and a button
     * respectively lead a user to try.
     */
    <div
      role="link"
      tabIndex={0}
      aria-label={`View listing at ${formatCardAddress(listing)}`}
      className={`listing-card-root group block cursor-pointer rounded-md ${CARD_HOVER_CLASS} focus:outline-none`}
      onClick={openPanel}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        // Space scrolls the page by default, which would move the results out from under the panel
        // that is about to open over them.
        e.preventDefault();
        openPanel();
      }}
    >
      {/* Image. `listing-card-media` makes this the container the open-house badge measures. */}
      <div className="listing-card-media relative aspect-[4/3] overflow-hidden rounded-md bg-surface-soft">
        <ListingImage
          media={listing.primaryMedia}
          className={`h-full w-full object-contain ${isSold ? 'opacity-75 saturate-50' : ''}`}
        />

        {/* Sold inventory reads differently from live inventory at a glance. */}
        {isSold && (
          <span className="absolute inset-x-0 top-0 bg-ink/85 py-1 text-center text-[11px] font-semibold uppercase tracking-wide text-white">
            Sold
          </span>
        )}

        {/*
         * The image's badge stack: marketing pill, then open house, then its date and time.
         *
         * **One positioned container holding all of them**, rather than each badge placing itself.
         * A listing can be Featured *and* have an open house, so as separate absolutes they would
         * have needed hand-computed `top` offsets that stayed correct for every combination — the
         * kind of arithmetic that is right when written and wrong after the next addition. Stacked
         * in a flex column they cannot collide by construction, whatever subset is present.
         *
         * The whole stack is absolutely positioned inside the fixed-aspect image, so it costs **no
         * card height**. That is the constraint that shaped this: an open house once had a text row
         * below the image, which was the only row those cards had and others did not, and it made
         * tiles in a grid different heights (#79a90aa).
         */}
        {(isComingSoon || newListingBadge || marketingBadge || openHouse) && (
          <div
            /*
             * `inset-x-3`, not `left-3` alone: the children cap themselves with percentage widths,
             * and a percentage against a shrink-to-fit parent is a cyclic dependency the browser
             * resolves by collapsing it — measured, the "Featured" pill came out 28px wide and
             * truncated to nothing. Pinning both edges gives this box a definite width (the image
             * less its two gutters) for those percentages to resolve against. `items-start` keeps
             * each pill sized to its own content inside it.
             */
            className={`absolute inset-x-3 flex flex-col items-start gap-1 ${
              isSold ? 'top-9' : 'top-3'
            }`}
          >
            {isComingSoon && (
              /*
               * #424/#438. Leads the stack. `max-w-full` (not a fixed or percentage cap): the
               * pill is `inline-flex`, sized to its own content, and this only stops it from
               * exceeding the stack's own definite width (from `inset-x-3` above) — nothing
               * clips it. It used to be capped at `calc(100%-3.5rem)`, reserved for a save
               * control that lived on the image; the control moved into the footer in #433 and
               * the reservation was never removed, so `whitespace-nowrap` text past that cap
               * spilled out past the pill's own background instead of the pill growing to hold
               * it (#438 stakeholder screenshot).
               *
               * Two forms, `whitespace-nowrap`, never `truncate` or wrapped: "Coming soon Oct 15"
               * still does not fit every card this component renders on (search grid, home row,
               * favourites) even at `max-w-full`, so the shorter "Soon · Oct 15" is the floor at
               * the narrowest widths. The font size and the full/short cutoff both key off the
               * card's own width — `.listing-card-coming-soon-*` in globals.css, on a container
               * query off `.listing-card-root` — because the card's width does not track the
               * viewport (see the note on `.listing-card-media` above). Same idiom as the
               * open-house pill's three forms below.
               */
              <span className="listing-card-coming-soon-pill inline-flex max-w-full items-center gap-1 whitespace-nowrap rounded-full bg-white px-2 py-0.5 font-semibold text-ink shadow-card">
                <span
                  aria-hidden="true"
                  className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-brand"
                />
                <span className="listing-card-coming-soon-short">
                  {formatComingSoonBadgeShort(listing.comingSoonDate)}
                </span>
                <span className="listing-card-coming-soon-full">
                  {formatComingSoonBadge(listing.comingSoonDate)}
                </span>
              </span>
            )}

            {newListingBadge && (
              /* #542. Same pill as Coming Soon, in the same slot. It never shows with Coming Soon. */
              <span className="listing-card-new-pill inline-flex max-w-full items-center gap-1 whitespace-nowrap rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-ink shadow-card">
                <span
                  aria-hidden="true"
                  className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-brand"
                />
                {newListingBadge}
              </span>
            )}

            {marketingBadge && (
              <span
                // #433 moved the save control off the photo into the footer row below, but the
                // cap stays: it is a general truncation margin now, kept at its old 3.5rem value
                // rather than widened without a reason to.
                className="max-w-[calc(100%-3.5rem)] truncate rounded-full bg-white px-2 py-1 text-[11px] font-semibold text-ink shadow-card"
              >
                {marketingBadge}
              </span>
            )}

            {openHouse && (
              /*
               * One pill, carrying its own date: `Open (8/16)`.
               *
               * The date is the part that must survive. A corner badge saying "Open Sat" was tried
               * and does not say *which* Saturday, and for an open house being off by a week is a
               * wasted trip to a house — which is why this spent time as a two-line band and then
               * as a pill with a second row under it. Both were the full string looking for room.
               *
               * **The content gives, not the type size.** This was briefly 8px, on the reasoning
               * that the string had to fit — and it was unreadable. It also does not generalise:
               * measured across the search grid, this badge has 133px of room at a 1536px viewport
               * but only 83px at 768px, where the card is 139px wide, and the full string needs
               * 173px at 11px. There is no font size that fits every card and stays legible.
               *
               * So the type stays at the card's own 11px and the *content* adapts to the card: the
               * schedule below a measured threshold, the date always. Which one renders is a
               * container query rather than a `md:` breakpoint, because the card's width does not
               * follow the viewport's — see the note on `.listing-card-media` in `globals.css`.
               *
               * `truncate` stays as a backstop rather than as the mechanism: neither form reaches
               * it, but without it a pathological string would spill across the save control.
               *
               * Same white fill as the marketing pill above it. This was `bg-brand`/`text-white`,
               * on the reasoning that an open house expires and a standing property like "Featured"
               * does not, so the two should not look alike. Two differently-coloured pills stacked
               * three pixels apart in one corner read as a colour clash rather than as a
               * distinction, and the brand fill pulled the eye off the photo. The bold `Open:`
               * label already separates them.
               */
              <span className="max-w-[calc(100%-3.5rem)] truncate rounded-full bg-white px-2 py-1 text-[11px] font-medium text-ink shadow-card">
                {/*
                 * Only the word is bold, so this reads as a label and its value rather than as one
                 * undifferentiated string — at 11px, a uniform weight makes "Open Sat 11am" scan as
                 * a single run of text.
                 *
                 * Both forms are rendered and the container query shows exactly one. `display: none`
                 * rather than visual hiding, so a screen reader is never handed the date twice.
                 */}
                <span className="font-bold">Open:</span>{' '}
                <span className="open-house-full">{formatOpenHouseBadge(openHouse)}</span>
                <span className="open-house-no-day">{formatOpenHouseTimeAndDate(openHouse)}</span>
                <span className="open-house-date">{formatOpenHouseDate(openHouse)}</span>
              </span>
            )}
          </div>
        )}
      </div>

      {/*
       * Info block with **reserved slots**, so every tile in a grid is the same height regardless of
       * which optional rows a row happens to have. Each variable row keeps its box whether or not it
       * has content:
       *
       * - the label row (sample / sponsored) — `h-5`, rendered only when a label applies. Always
       *   reserving it left a blank 20px band under every Bright photo, which carries neither label.
       *   A grid mixing labelled and unlabelled rows is therefore uneven by that one row.
       * - the stats line (absent for a parcel with unknown lot size, or an all-null dwelling) —
       *   `h-[18px]`, which is `caption-sm`'s line box; a slot sized for the old 12px text would
       *   clip the 13px it now holds
       * - the attribution row (office avatar/name, time on market) — one row, always present
       *   (see #433/#458 below). Save/share/more live on the price line instead (#458).
       *
       * The open-house date row is gone entirely — it moved onto the image badge, and it was the
       * row that only some cards had.
       */}
      <div className="pt-1.5">
        {/*
         * Required labels get a guaranteed slot that is reserved even when empty. They are never
         * what gets truncated or crowded out to make heights match — that is why they sit outside
         * the image's single badge slot in the first place. If the row is visible, these are visible.
         *
         * `flex-nowrap`, not `flex-wrap`: on a narrow card, wrapping put the second badge on a row
         * the fixed `h-5` then clipped out of existence (#121) — a required disclosure silently
         * dropped. `SampleBadge`/`SponsoredBadge` are sized to fit one row at the narrowest
         * supported card (~155px); this row must never gain `overflow-hidden` or `truncate`, or a
         * disclosure can go invisible again the same way.
         */}
        {(listing.isSample || listing.sponsored) && (
          <div className="mb-1 flex h-5 flex-nowrap items-center gap-1">
            {listing.isSample && <SampleBadge />}
            {listing.sponsored && <SponsoredBadge />}
          </div>
        )}

        {/*
         * #458. Price leads the body, with save/share/more beside it on the same line.
         * `title-md` (16px/600) on the figure, `body-md` (16/400) on the qualifiers. Was 14/600,
         * which the scale does not pair — and it left the price no louder than the title.
         *
         * #438. Save, share, more. Each icon is 16px with a `gap-1` (4px) between buttons, which
         * puts adjacent button centres 20px apart — too tight for a 44px hit area per icon
         * without overlapping its neighbour. `-inset-0.5` (2px a side) gives each button a 20px
         * overlay, the largest square that touches its neighbour without overlapping it. That is
         * smaller than the 44px target; the card's narrowest width (~151px, home carousel) cannot
         * fit three 44px overlays side by side while the price keeps any legible width at all.
         */}
        <div className="flex items-center gap-1">
          <p className="min-w-0 flex-1 truncate text-base text-ink">
            {soldLine ? (
              <span className="font-semibold">{soldLine}</span>
            ) : (
              <>
                {/* #471. A rent price is "$3,100/mo" from formatPrice, in one style. */}
                <span className={price.isWithheld ? 'text-ink-body' : 'font-semibold'}>
                  {price.text}
                </span>
                {/* #717. Wide cards: the change follows the price. Narrow cards: see the line below. */}
                {priceChange && (
                  <span className="listing-card-change-inline text-ink-body">
                    {' '}
                    <span aria-hidden="true">
                      ({formatCardPriceChangeAmount(priceChange)}
                      <span className="listing-card-change-date">
                        {formatCardPriceChangeDate(priceChange)}
                      </span>
                      )
                    </span>
                    <span className="sr-only">{describeCardPriceChange(priceChange)}</span>
                  </span>
                )}
              </>
            )}
          </p>

          {/* #467. `.listing-card-actions` (globals.css) sets one gap for all three buttons, scaled to the card width. */}
          <div className="listing-card-actions flex shrink-0 items-center">
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                toggleSave(listing);
              }}
              className="relative flex h-4 w-4 items-center justify-center rounded-full text-ink-muted transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
              aria-label={saved ? 'Unsave' : 'Save'}
            >
              <span aria-hidden="true" className="absolute -inset-0.5" />
              <Heart
                size={16}
                className={saved ? 'fill-brand stroke-brand' : 'fill-none stroke-current'}
              />
            </button>

            {/* Hover changes the icon color only (`hover:text-ink`), so no group variant is needed. */}
            <button
              type="button"
              onClick={handleShare}
              className="relative flex h-4 w-4 items-center justify-center rounded-full text-ink-muted transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
              aria-label="Share this listing"
            >
              <span aria-hidden="true" className="absolute -inset-0.5" />
              <Share2 size={16} className="stroke-current" />
            </button>

            {/*
             * #452. Portaled to `document.body` so the card's own `overflow-hidden`, the
             * carousel scroller's `overflow-x-auto` (`ListingRow.tsx`) and the search grid never
             * clip or hide it — see `ListingCardMenu` for the positioning, focus and ARIA detail.
             *
             * The menu carries only "Copy link" — "Hide this home" and "Report a problem" are not
             * wired, because neither feature exists yet anywhere else in the app (#433).
             */}
            <ListingCardMenu
              items={[{ label: 'Copy link', icon: Copy, onSelect: handleCopyLink }]}
            />
          </div>
        </div>

        {/*
         * #717. Narrow cards (every card below 640px, and any card under 260px) show the change on
         * a line of its own. The arrow and the amount carry the meaning. The color is the neutral
         * body color for a cut and an increase alike. The two change classes in globals.css show
         * one of the two renders.
         */}
        {priceChange && (
          <p className="listing-card-change-line mt-0.5 truncate text-[13px] leading-[18px] text-ink-body">
            <span aria-hidden="true">{formatCardPriceChange(priceChange)}</span>
            <span className="sr-only">{describeCardPriceChange(priceChange)}</span>
          </p>
        )}

        {/* Reserved whether or not there are stats to show, so the address never shifts up a row. */}
        <p className="mt-0.5 h-[18px] truncate text-[13px] leading-[18px] text-ink-muted">
          {statsLine ?? ' '}
        </p>

        {/* #458. The property address is secondary now that price leads: normal weight, the same
            13px/18px system face and `ink-body` color tier as the attribution row below it. */}
        <h3 className="mt-0.5 truncate font-system text-[13px] font-normal leading-[18px] tracking-[-0.01em] text-ink-body">
          {formatCardAddress(listing)}
        </h3>

        {/*
         * #433/#438/#458. Attribution row: office avatar + name on the left, time on market on
         * the far right. Actions moved onto the price line above (#458). This used to fork into a
         * compact/full pair keyed on a CSS container query, dropping the name to `line-clamp-2`.
         * The stakeholder ruled the row must never wrap to a second line, so there is one render
         * now: the name (`truncate`, never `line-clamp-2`) absorbs all the truncation.
         *
         * NAR 7.58 / Bright MLS IDX still requires the listing firm's name, reasonably prominent,
         * in a typeface no smaller than the card's own median listing-data text (13/14px here).
         * Stakeholder ruling, 2026-10-02 (#305, #433): cards and the map popup show the office
         * avatar and the bare office name, with no "Listing courtesy of" wording. Truncating the
         * name with a `title`/`aria-label` fallback is accepted. The office name is `text-[13px]`,
         * at that floor.
         *
         * #470. Two separate slots. The office slot (avatar + name) takes at most 85% of the row
         * and truncates first. The time slot is `shrink-0`, takes the width its text needs,
         * right-aligned, and never truncates. With no time value the office slot may use the full
         * row. The name keeps at least 10 visible characters on the 141px carousel card. See
         * `ListingCard.spec.tsx`'s "name width budget" test.
         */}
        <div className="mt-1 flex items-center gap-1">
          <div
            className={`listing-card-office-slot flex min-w-0 flex-1 items-center gap-0.5 ${timeOnMarket !== null || isNew ? 'max-w-[85%]' : 'max-w-full'}`}
          >
            {/* #452. 17px, one step up from the icon row's 16px. At 18px the office name lost a character. */}
            <span
              aria-hidden="true"
              className={`flex h-[17px] w-[17px] shrink-0 items-center justify-center rounded-full text-[10px] font-semibold leading-none text-white ${officeAvatarTone(officeInitial(listing.officeName))}`}
            >
              {officeInitial(listing.officeName)}
            </span>
            <span
              className="min-w-0 flex-1 truncate text-[13px] text-ink-body"
              title={listing.officeName}
              aria-label={listing.officeName}
            >
              {listing.officeName}
            </span>
          </div>
          {timeOnMarket !== null && (
            <span className="listing-card-time-on-market ml-auto shrink-0 whitespace-nowrap text-right text-[13px] text-ink-muted">
              {timeOnMarket}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
