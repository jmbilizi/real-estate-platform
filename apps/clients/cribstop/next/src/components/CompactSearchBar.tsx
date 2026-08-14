'use client';

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'motion/react';
import { useApp } from '@/lib/context';
import {
  extractSearchTerms,
  fetchNearbyLocationsByType,
  formatLocationLabel,
  highlightMatch,
} from '@/lib/search-utils';
import { isParcelOnlySelection, PARCEL_INTERLOCK_HINT, SearchPanel } from '@/lib/store/types';
import { Z_LAYERS } from '@/lib/z-layers';
import { BED_OPTIONS, DateRangePanel } from './DateRangePanel';
import { PROPERTY_TYPES } from '@cribstop/property-contracts';
import type { ListingType } from '@/lib/types';

/**
 * The bar's tab vocabulary is UI state; the contract's is what may go in a URL.
 *
 * These are deliberately separate: `'for-sale'`/`'for-rent'` is the `ListingTab` identity the
 * header tabs and `uiSlice` share, while the API's `listingType` is `sale`/`rent`/`sold`. The bar
 * used to put the tab value straight into `?type=`, which the search page then dropped as an
 * unrecognised enum — so every "For Sale" search silently returned sale *and* rent inventory.
 * Translating here keeps the tab identity intact and the URL contract-valid.
 */
const LISTING_TYPE_FOR_TAB: Record<'for-sale' | 'for-rent', ListingType> = {
  'for-sale': 'sale',
  'for-rent': 'rent',
};

/**
 * `'2+'` is a label, not a value. The contract's `baths` is `^\d+(\.5)?$`, so the label was dropped
 * client-side (and would have been a 400 if forwarded) — the bathrooms filter never applied.
 */
function bathsParamValue(label: string): string | undefined {
  const numeric = label.replace('+', '').trim();
  return /^\d+(\.5)?$/.test(numeric) ? numeric : undefined;
}

// Shape/position transition for the dock wrapper below. Only pill <-> expanded
// is handed to Framer's `layout` (not `layoutId` — no shared/cross-tree
// matching, just this one persistent node): it measures this component's own box
// before/after a re-render and interpolates. large <-> pill is hand-animated
// instead — see MORPH_TRANSITION_CSS.
//
// Two things move when the bar swaps and they have to read as ONE motion, so
// they share this duration and curve: the bar's own morph, and the in-page row
// collapsing/opening under it (.desktop-search-bar-wrapper in globals.css). Any
// drift between them and the eye picks out the slower one as lag.
//
// Curve is balanced-with-a-soft-landing on purpose, and it's the one dial worth
// tuning here if this ever needs to feel different. A hard ease-out was tried
// (0.32,0.72,0,1) and measured worse for a size change this large: it puts ~82%
// of the travel into the first 28% of the duration, so the bar lunges and then
// crawls the last 50px. This spends the middle of the duration actually moving.
const DOCK_TRANSITION = { duration: 0.3, ease: [0.4, 0, 0.2, 1] as const };

const MORPH_MS = DOCK_TRANSITION.duration * 1000;
const MORPH_EASE = `cubic-bezier(${DOCK_TRANSITION.ease.join(',')})`;

// large <-> pill is a shared-element crossfade, animated with NOTHING but
// `transform` and `opacity`:
//
//   - a throwaway clone of the outgoing bar (the "ghost") is pinned over where
//     that bar was, then animated toward the incoming bar's centre, scaling down
//     as it fades out;
//   - the real element renders straight into its new mode at its final size and
//     comes the other way — starting at the outgoing bar's centre, fading in.
//
// Both halves cover the same distance on the same curve, so the eye reads one
// object shrinking and settling rather than two elements trading places.
//
// Why transform/opacity rather than animating the real element's own geometry
// (left/top/width/height), which would keep the box pixel-exact for free:
// transform and opacity are the only two properties the browser can animate off
// the main thread. Every swap fires WHILE the in-page row underneath collapses
// its height, and that is a document reflow per frame — measured at 30-42ms
// frames on this page against a 16.7ms budget. Geometry animation is main-thread
// work, so it inherits those stalls and visibly steps (measured: one frame
// jumping the width 775 -> 646 mid-shrink). A composited transform keeps ticking
// straight through them. That is the whole difference between a bar that
// "changes size" and one that shrinks.
//
// Distortion — the reason geometry was tried in the first place — is ruled out by
// two rules instead:
//
//   1. The scale is UNIFORM. A capsule scaled uniformly is still a capsule: its
//      radius, hairline border and shadow all scale together, which is precisely
//      what a shrinking object looks like. (Interpolating one box into the other
//      needs a NON-uniform scale, the two having different aspect ratios — that
//      is what stretched the capsule into an ellipse.)
//   2. Only ever scale DOWN — whichever side is larger does the scaling, so the
//      large bar shrinks on the way out and grows on the way back. Nothing is
//      drawn bigger than its true size, so no text is ever seen oversized.
//
// Framer's `layout` can't be used for this even though it is transform-based: the
// swap is triggered BY a scroll event, so it usually starts while the page still
// has momentum, and Framer's layout system tracks window scroll (its document
// root projection node is created with `layoutScroll: true`) and keeps correcting
// in-flight animations for it — right for an element staying in flow, wrong for
// one becoming `position: fixed`, which stops moving with the page. Its escape
// hatch for that case, `layoutRoot`, works by hard-disabling the animation (same
// code path as prefers-reduced-motion). A plain CSS transition can't be
// re-corrected mid-flight.
const MORPH_TRANSITION_CSS = `transform ${MORPH_MS}ms ${MORPH_EASE}`;

// Opacity is choreographed so that the two layouts' TEXT is never on screen at
// the same time. A plain symmetric crossfade was tried and looks like exactly
// what this component's history warns about: for ~100ms both sets of labels are
// half-visible on top of each other at two different sizes, which reads as
// garbled rather than smooth. So the layers are sequenced instead:
//
//   ghost  (above, .searchbar-ghost-out)  opaque while it does the visible
//                                         shrinking, then dissolves;
//   shell  (below, no animation)          the incoming bar's capsule, solid from
//                                         the first frame, hidden underneath the
//                                         ghost until the dissolve uncovers it;
//   fields (.searchbar-fields-in)         the incoming labels, held back until
//                                         the ghost has gone.
//
// Holding the fields back also means they are only ever seen at their true size:
// on the way back the incoming bar is still scaling up as the ghost dissolves,
// and text is not revealed until that scale has essentially landed.
//
// Which of the two bars the eye should follow flips with direction, so the ghost's
// fade does too. Shrinking, the ghost IS the big bar and is the thing visibly
// getting smaller, so it holds opaque through the first part of the movement.
// Growing, the incoming bar is the one visibly getting bigger — and it very
// quickly outgrows the little pill ghost, which would otherwise sit opaque inside
// it looking like a pill stuck in a bar. So on that side the ghost clears out
// early and lets the growth carry the eye.
// And because the ghost leaves earlier on the way back, the incoming fields have
// to arrive earlier to meet it — otherwise the capsule is briefly empty mid-grow
// (measured at ~90ms of nothing between the ghost going and the labels arriving),
// where on the way out the two windows meet. Both variants still wait for the
// scale to be close enough that the type is never legibly undersized.
const GHOST_OUT_CLASS = 'searchbar-ghost-out';
const GHOST_OUT_FAST_CLASS = 'searchbar-ghost-out-fast';
const FIELDS_IN_CLASS = 'searchbar-fields-in';
const FIELDS_IN_EARLY_CLASS = 'searchbar-fields-in-early';

// The active field's fill. The bar itself stays white in every state and only the
// focused slot is tinted, so this element mounts with the panel rather than being
// a permanent layer whose opacity toggles — hence an enter animation instead of a
// transition, which has nothing to interpolate from on mount.
const SLOT_IN_CLASS = 'searchbar-slot-in';

// Everything the morph writes on the incoming bar, so it can be cleared exactly.
// Written to the SHELL, not to the dock: the dock is the motion.div, and Framer
// treats `transform` as its own property to reset — on the way into 'large' it
// wipes the start transform between it being set and the next frame, so the bar
// arrived full-size instead of growing (its `transform: none` fingerprint is
// visible in the settled inline style). The shell is a plain div React renders and
// nothing else touches, and it is the visible capsule anyway.
//
// None of these are in DOCK_STYLE either, which is what makes writing them safe:
// React only ever clears inline props that were in its own previous style object,
// and it applies DOCK_STYLE once per mode (same object identity every render), so
// anything overlapping it would have to be restored by hand.
const BAR_MORPH_PROPS = [
  'transition',
  'transform',
  'transform-origin',
  'opacity',
  'will-change',
] as const;

// Marks the visible capsule inside each layout: the node cloned for the ghost,
// and the node measured for the morph. The dock and the capsule are the same box
// in every mode (see DOCK_LARGE_CLASS), but measuring what is actually painted
// keeps that a fact rather than an assumption.
const SHELL_ATTR = 'data-search-bar-shell';
const GHOST_ATTR = 'data-search-bar-ghost';

// Ties the disabled beds/baths steppers to their visible explanation. One id is enough: only one
// "What" panel is mounted at a time (the three render paths are mutually exclusive branches).
const PARCEL_HINT_ID = 'search-parcel-interlock-hint';

type DockMode = 'large' | 'pill' | 'expanded';
type MorphBox = { left: number; top: number; width: number; height: number };

const boxOf = (el: Element): MorphBox => {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
};

// Where the outgoing bar is, expressed so it survives the wait between being
// measured and being pinned.
//
// The measurement has to happen before the swap commits, and the pinning can only
// happen after — which is at least one frame later, and in practice more, this
// component being large enough that its re-render can miss a frame. The swap is
// triggered by scrolling, so the page has usually moved on by then. Pinning the
// clone at the raw viewport rect leaves it wherever the bar USED to be, and the
// gap between that and where the bar actually is shows up as the bar twitching
// vertically before the shrink starts.
//
// So an in-flow source is recorded in document coordinates and converted back
// against the LIVE scroll offset at pin time; the fixed pill needs no such
// treatment, its viewport position not being a function of scroll at all.
type GhostSource = { node: HTMLElement; box: MorphBox; inFlow: boolean };

function pinnedBox({ box, inFlow }: GhostSource): MorphBox {
  if (!inFlow) return box;
  return { ...box, top: box.top - window.scrollY, left: box.left - window.scrollX };
}

// How far, and in which direction, the two capsules' centres are apart. Both
// halves of the crossfade are expressed against this one vector — the ghost
// travels +delta, the real element starts at -delta — which is what keeps them
// locked together instead of merely similar.
const centreDelta = (from: MorphBox, to: MorphBox) => ({
  dx: to.left + to.width / 2 - (from.left + from.width / 2),
  dy: to.top + to.height / 2 - (from.top + from.height / 2),
});

// Ghosts are inert in every sense that matters: aria-hidden and `inert` keep them
// out of the accessibility tree and the tab order, pointer-events keeps them from
// swallowing a click meant for the real pill mid-morph. Any stale ghost from an
// interrupted morph goes first — there is only ever one.
function mountGhost(node: HTMLElement, box: MorphBox, holds: boolean) {
  document.querySelectorAll(`[${GHOST_ATTR}]`).forEach((stale) => stale.remove());
  node.setAttribute(GHOST_ATTR, '');
  node.setAttribute('aria-hidden', 'true');
  node.setAttribute('inert', '');
  // A clone taken mid-morph would otherwise keep running the incoming-fields
  // animation and dissolve its own text.
  node.classList.remove(FIELDS_IN_CLASS);
  node.classList.add(holds ? GHOST_OUT_CLASS : GHOST_OUT_FAST_CLASS);
  Object.assign(node.style, {
    position: 'fixed',
    left: `${box.left}px`,
    top: `${box.top}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
    margin: '0',
    // Directly above the real bar. The incoming capsule is solid from the first
    // frame, so the ghost has to cover it while it dissolves — that's what keeps
    // the two layouts' labels from ever being legible at the same time.
    zIndex: String(Z_LAYERS.searchBarMorphGhost),
    pointerEvents: 'none',
    transformOrigin: 'center center',
    willChange: 'transform, opacity',
  });
  document.body.appendChild(node);
  return node;
}

function clearBarMorph(el: HTMLElement) {
  for (const prop of BAR_MORPH_PROPS) el.style.removeProperty(prop);
}

// A morph is any swap where exactly one side is the in-page 'large' layout, in
// either direction. That covers large <-> pill (the scroll swap) and the rarer
// expanded -> large (scrolling back to the top with the overlay open), and
// excludes pill <-> expanded, which is a click-driven change between two docked
// layouts and stays with Framer.
const isMorphPair = (a: DockMode, b: DockMode) => a !== b && (a === 'large') !== (b === 'large');

// Fixed geometry for the two docked (position:fixed) states — matches NavBar's
// center slot (h-16 header, pill vertically centered) and the space below it
// where the expanded overlay used to live. 'large' geometry lives in
// DOCK_LARGE_CLASS below instead of here, since that mode stays in normal
// document flow.
// Centered via left/right + auto margins, NOT `transform: translateX(-50%)` —
// `transform` belongs to the animations on this element (Framer's `layout` for
// pill <-> expanded, the crossfade above for large <-> pill), both of which
// overwrite and then reset it, silently discarding a manual centering transform
// and leaving the dock offset to one side.
const DOCK_STYLE: Record<'pill' | 'expanded', React.CSSProperties> = {
  pill: {
    position: 'fixed',
    top: 7,
    left: 0,
    right: 0,
    marginLeft: 'auto',
    marginRight: 'auto',
    width: 'min(480px, calc(100vw - 160px))',
    zIndex: Z_LAYERS.searchBar,
  },
  expanded: {
    position: 'fixed',
    top: 'var(--navbar-h)',
    left: 0,
    right: 0,
    marginLeft: 'auto',
    marginRight: 'auto',
    width: 'min(768px, calc(100vw - 48px))',
    zIndex: Z_LAYERS.searchBar,
  },
};

// 'large' mode geometry — deliberately on the SAME element the shape animation
// runs on (the dock below), not on a wrapper inside it. Both directions of the
// large <-> pill morph interpolate this element's own box, measuring it as the
// "from" box one way and the "to" box the other, so its box has to BE the
// visible pill's box in every mode. When these
// max-width/inset/centering rules lived on inner wrappers instead, the dock in
// 'large' mode was the full width of .desktop-search-bar-wrapper and the full
// 94px row height, while the pill actually drawn inside it was ~1024px wide
// and ~62px tall — so the first frame of the shrink painted the pill shell at
// that outer box, visibly ballooning ~1.6x wider and ~1.5x taller than the bar
// the user was looking at before it started shrinking (and the grow direction
// had the mirror-image problem: starting a good 40% too small).
//
// Widths are unchanged from what the inner wrappers produced — 'large' only
// renders at md+, where the old `sm:px-4` was the binding horizontal inset and
// the old `lg:px-16` never was (the max-widths always won past lg).
//
// No vertical spacing here on purpose: the old `py-4` became padding on
// .desktop-search-bar-wrapper (globals.css) rather than a margin on this
// element. A margin would be a first-in-flow-child top margin on a wrapper with
// no padding/border of its own, so it would COLLAPSE out through the wrapper —
// pushing the whole search row down 16px in 'large' while the docked states
// (out of flow, wrapper clipped) stayed put: a 16px jump on every swap.
const DOCK_LARGE_CLASS = 'mx-auto w-[calc(100%_-_2rem)] max-w-3xl lg:max-w-4xl xl:max-w-5xl';

export default function CompactSearchBar({
  mobileSheetMode = false,
  onClose,
  alwaysPill = false,
}: {
  /** When true: renders a full-screen mobile search sheet (reuses all panels) */
  mobileSheetMode?: boolean;
  /** Called to close the mobile sheet */
  onClose?: () => void;
  /** When true: this page has no 'large' in-page layout to grow back into
   *  (see ScrollSentinel's alwaysPill mode) — clicking a pill field opens the
   *  'expanded' overlay instead of scrolling to top. */
  alwaysPill?: boolean;
}) {
  const {
    listingTab: ctxTab,
    setListingTab,
    searchLocation,
    setSearchLocation,
    searchSuggestion,
    setSearchSuggestion,
    searchMoveInDate,
    setSearchMoveInDate,
    searchDateRange,
    setSearchDateRange,
    searchBedsIdx,
    setSearchBedsIdx,
    searchPropertyTypes,
    setSearchPropertyTypes,
    searchBaths,
    setSearchBaths,
    searchMaxPrice: searchMaxPriceCtx,
    setSearchMaxPrice: setSearchMaxPriceCtx,
    searchDescription,
    setSearchDescription,
    showHeaderPill,
    headerExpanded,
    setHeaderExpanded,
  } = useApp();
  // Single always-mounted instance — this is the ONLY place CompactSearchBar is
  // rendered (see ScrollSentinel.tsx). It used to be mounted three times
  // simultaneously (in-page bar, header pill, click-to-expand overlay), each
  // running its own geolocation/autocomplete/etc., synchronized only by a
  // `searchbar:close` event hack and a decorative shared-layoutId shell to fake
  // a single continuous shape. That shell showed real field text from BOTH the
  // exiting and entering copies at once during a swap (Framer's shared-layout
  // crossfade converges both onto the same interpolated rect), which is what
  // read as garbled/flickering. Reading scroll state directly and picking ONE
  // of three layouts to render removes the duplication at the root instead of
  // re-synchronizing it.
  const rawMode: DockMode = !showHeaderPill ? 'large' : headerExpanded ? 'expanded' : 'pill';
  // Every swap renders immediately. The grow used to be held back a full
  // DOCK_TRANSITION so the in-page row could finish reopening first and the bar
  // would have a settled box to grow into — a requirement of measuring geometry,
  // which the crossfade doesn't do: it starts the incoming bar from the outgoing
  // bar's centre and eases its transform to none, so the box is free to still be
  // moving underneath. Dropping the wait is what makes the grow the mirror of the
  // shrink rather than two events in sequence at twice the duration.
  const [mode, setMode] = useState(rawMode);
  const dockRef = useRef<HTMLDivElement>(null);
  // Tracks the mode as of the last commit — read during render (before this
  // render's own layout effect updates it) to detect "this render IS the swap"
  // for the morph below.
  const prevModeRef = useRef(mode);
  // The outgoing layout, cloned and measured while it is still the one on screen.
  // This has to happen BEFORE the swap commits — a layout effect is already too
  // late, React having replaced the subtree by then and taken the only copy of
  // that markup with it.
  const ghostRef = useRef<GhostSource | null>(null);
  // Which morph is in flight, if any. Direction is needed at RENDER time, not just
  // in the effect, because it selects the incoming fields' ramp — see
  // FIELDS_IN_EARLY_CLASS. Also holds Framer off the transition throughout.
  const [morphDir, setMorphDir] = useState<'shrink' | 'grow' | null>(null);
  const morphing = morphDir !== null;
  const fieldsInClass = morphDir === 'grow' ? FIELDS_IN_EARLY_CLASS : FIELDS_IN_CLASS;

  const captureGhost = () => {
    const shell = dockRef.current?.querySelector<HTMLElement>(`[${SHELL_ATTR}]`);
    if (!shell) return;
    const box = boxOf(shell);
    const inFlow = mode === 'large';
    ghostRef.current = {
      node: shell.cloneNode(true) as HTMLElement,
      // Document coordinates for the in-flow bar, so the pin can be re-derived
      // against the live scroll offset — see pinnedBox.
      box: inFlow
        ? { ...box, top: box.top + window.scrollY, left: box.left + window.scrollX }
        : box,
      inFlow,
    };
  };

  useEffect(() => {
    if (!alwaysPill && isMorphPair(mode, rawMode)) captureGhost();
    setMode(rawMode);
  }, [rawMode]);

  // This render is the commit that swaps the layout, so Framer must not treat it
  // as a layout change of its own to animate — the morph below owns it.
  const isMorphTransition = isMorphPair(prevModeRef.current, mode);
  // Framer owns pill <-> expanded and nothing else. It has to be off not merely
  // DURING a hand-animated morph but from the render that precedes it — the one
  // where rawMode has already flipped and mode hasn't. Left enabled there it
  // snapshots the outgoing box, and a snapshot it already holds still gets
  // projected even once the prop goes false, so its scale ends up multiplying with
  // the crossfade's: measured as the growing bar dipping to 356px, narrower than
  // the 480px pill it was supposed to be growing out of.
  const framerLayout = !morphing && !isMorphTransition && !isMorphPair(mode, rawMode);

  useLayoutEffect(() => {
    const prev = prevModeRef.current;
    prevModeRef.current = mode;
    const ghost = ghostRef.current;
    ghostRef.current = null;

    const el = dockRef.current;
    const shell = el?.querySelector<HTMLElement>(`[${SHELL_ATTR}]`);
    const isMorph = isMorphPair(prev, mode);
    // Hand-rolling this animation means hand-rolling the reduced-motion opt-out
    // too — Framer used to cover it for free. Reduced motion gets the swap with no
    // morph at all: the layouts still change, nothing travels or dissolves.
    const reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!isMorph || !ghost || !el || !shell || reducedMotion) {
      // Covers pill <-> expanded (Framer's) and the initial mount: nothing to
      // animate by hand, but a morph interrupted by one of those has to let go.
      ghost?.node.remove();
      setMorphDir(null);
      return;
    }

    // Clear first: on a fast re-toggle the previous morph's transform is still
    // in flight, and it would otherwise be baked into this measurement.
    clearBarMorph(shell);
    // Pinned against the CURRENT scroll offset, not the one at capture time.
    const from = pinnedBox(ghost);
    const to = boxOf(shell);
    const { dx, dy } = centreDelta(from, to);
    // Only the larger side scales, and it only ever scales down — see rule 2 at
    // MORPH_TRANSITION_CSS. One of these is always exactly 1.
    const ghostScale = Math.min(1, to.width / from.width);
    const barScale = Math.min(1, from.width / to.width);

    // Direction is read off the boxes rather than the modes: the ghost holds
    // opaque, and the fields wait longer, only when the outgoing bar is the bigger
    // of the two — i.e. when it is the one doing the visible shrinking.
    const shrinking = from.width > to.width;
    // Setting state from a layout effect is deliberate: it flushes before paint,
    // so the incoming fields are already held back on the frame the new layout
    // first appears. A passive effect would let one frame through with them
    // visible, at the wrong size and in the wrong place.
    setMorphDir(shrinking ? 'shrink' : 'grow');
    const ghostNode = mountGhost(ghost.node, from, shrinking);

    shell.style.transition = 'none';
    shell.style.transformOrigin = 'center center';
    shell.style.willChange = 'transform';
    shell.style.transform = `translate(${-dx}px, ${-dy}px) scale(${barScale})`;
    // Force the start state to resolve on its own before the end state is written
    // below, or the browser folds both writes into one style resolution and there
    // is nothing left to transition between.
    void shell.getBoundingClientRect();

    const raf = requestAnimationFrame(() => {
      ghostNode.style.transition = MORPH_TRANSITION_CSS;
      ghostNode.style.transform = `translate(${dx}px, ${dy}px) scale(${ghostScale})`;

      shell.style.transition = MORPH_TRANSITION_CSS;
      shell.style.transform = 'none';
    });
    const settle = setTimeout(() => {
      ghostNode.remove();
      clearBarMorph(shell);
      setMorphDir(null);
    }, MORPH_MS + 40);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(settle);
      ghostNode.remove();
      clearBarMorph(shell);
    };
  }, [mode]);

  // Clicking a field while docked as the pill: grow back to the in-page
  // layout first (or, on alwaysPill pages where there's no in-page layout to
  // grow back into, open the 'expanded' overlay instead), THEN land on that
  // field's panel already open — activePanel is set immediately, but panels
  // only render in 'large'/'expanded' JSX, so it has no visible effect until
  // the grow (or expand) actually finishes.
  function openFromPill(panel: SearchPanel) {
    setActivePanel(panel);
    if (alwaysPill) {
      setHeaderExpanded(true);
    } else {
      // Instant, not smooth — matches the rest of this component's "hard cut
      // at the threshold, eased shape tween provides the motion" philosophy
      // rather than tying perceived smoothness to scroll distance/duration.
      window.scrollTo({ top: 0 });
    }
  }

  // Local aliases ? keep all existing JSX/logic unchanged
  const location = searchLocation;
  const setLocation = setSearchLocation;
  const selectedSuggestion = searchSuggestion;
  const setSelectedSuggestion = setSearchSuggestion;
  const _moveInDate = searchMoveInDate;
  const _setMoveInDate = setSearchMoveInDate;
  const dateRange = searchDateRange;
  const setDateRange = setSearchDateRange;
  // Local state for range-picking interaction (first click = start, second = end)
  const [rangePickStep, setRangePickStep] = useState<'start' | 'end'>('start');
  // hovered date for visual range preview
  const [hoveredDate, setHoveredDate] = useState<string | null>(null);
  const bedsIdx = searchBedsIdx;
  const listingTab = ctxTab;
  // State for nearby locations and loading
  const [nearbyLocations, setNearbyLocations] = useState<any[]>([]);
  const [loadingNearby, setLoadingNearby] = useState(false);
  const [, setNearbyError] = useState<string | null>(null);
  // Cache last geolocated position and resolved place
  type LastGeo = { lat: number; lon: number; placeType: string; address: any };
  const [lastGeo, setLastGeo] = useState<LastGeo | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const cached = localStorage.getItem('cribstop_lastGeo');
      if (cached) {
        const geo = JSON.parse(cached);
        if (geo && typeof geo.lat === 'number' && typeof geo.lon === 'number') return geo;
      }
    } catch {}
    return null;
  });
  // Key ("lat,lon" at 5dp) for which nearbyLocations in state was last successfully fetched
  const nearbyForKey = useRef<string | null>(null);
  // AbortControllers — cancel in-flight requests when a new one starts or panel closes
  const nearbyAbortRef = useRef<AbortController | null>(null);
  const geoAbortRef = useRef<AbortController | null>(null);

  // Handler: Get nearby locations using input location if available, else geolocation
  const handleFetchNearbyLocations = async (forceGeo = false) => {
    // Cancel any previous in-flight nearby request
    nearbyAbortRef.current?.abort();
    const ac = new AbortController();
    nearbyAbortRef.current = ac;
    const signal = ac.signal;

    // Robust valid location logic
    let lat: number | null = null;
    let lon: number | null = null;
    let placeType: 'city' | 'town' | 'village' = 'city';
    let address: any = null;
    let refSuggestion = null;
    if (!forceGeo) {
      // 1. Use selected suggestion if available
      if (selectedSuggestion && selectedSuggestion.lat && selectedSuggestion.lon) {
        refSuggestion = selectedSuggestion;
      } else if (location && suggestions.length > 0) {
        // 2. If input matches a suggestion, use that
        refSuggestion =
          suggestions.find(
            (s) => formatLocationLabel(s).toLowerCase() === location.trim().toLowerCase(),
          ) || suggestions[0];
      }
      if (refSuggestion && refSuggestion.lat && refSuggestion.lon) {
        lat = Number(refSuggestion.lat);
        lon = Number(refSuggestion.lon);
        if (
          refSuggestion.type === 'city' ||
          refSuggestion.type === 'town' ||
          refSuggestion.type === 'village'
        ) {
          placeType = refSuggestion.type;
        }
        address = refSuggestion.address || null;
      }
      // If no valid location yet, try lastGeo (synchronous path only)
      if (lat == null || lon == null) {
        if (lastGeo && typeof lastGeo.lat === 'number' && typeof lastGeo.lon === 'number') {
          lat = lastGeo.lat;
          lon = lastGeo.lon;
          placeType = lastGeo.placeType as any;
          address = lastGeo.address;
        }
      }
    }
    // Early-exit: if we already have results for this exact position, do nothing
    if (lat != null && lon != null) {
      const key = `${Number(lat).toFixed(5)},${Number(lon).toFixed(5)}`;
      if (nearbyForKey.current === key && nearbyLocations.length > 0) return;
    }
    setNearbyError(null);
    setNearbyLocations([]);
    setLoadingNearby(true);
    // If still no lat/lon, fall back to geolocation API
    if (lat == null || lon == null) {
      if (typeof window !== 'undefined' && 'geolocation' in navigator) {
        navigator.geolocation.getCurrentPosition(
          async (pos) => {
            if (signal.aborted) return;
            const { latitude, longitude } = pos.coords;
            const geoKey = `${latitude.toFixed(5)},${longitude.toFixed(5)}`;
            // Early-exit if already have results for this GPS position
            if (nearbyForKey.current === geoKey && nearbyLocations.length > 0) {
              setLoadingNearby(false);
              return;
            }
            // Only call reverse geocode if position changed
            if (lastGeo && lastGeo.lat === latitude && lastGeo.lon === longitude) {
              lat = lastGeo.lat;
              lon = lastGeo.lon;
              placeType = lastGeo.placeType as any;
              address = lastGeo.address;
            } else {
              try {
                const resp = await fetch(
                  `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=10&addressdetails=1`,
                  {
                    headers: {
                      Accept: 'application/json',
                      'User-Agent': 'real-estate-platform/1.0',
                    },
                    signal,
                  },
                );
                if (resp.ok) {
                  const data = await resp.json();
                  if (data && data.address) {
                    if (data.address.city) placeType = 'city';
                    else if (data.address.town) placeType = 'town';
                    else if (data.address.village) placeType = 'village';
                    address = data.address;
                    setLastGeo({ lat: latitude, lon: longitude, placeType, address });
                    try {
                      localStorage.setItem(
                        'cribstop_lastGeo',
                        JSON.stringify({ lat: latitude, lon: longitude, placeType, address }),
                      );
                    } catch {}
                  }
                }
              } catch (e: any) {
                if (e?.name === 'AbortError') return;
                setNearbyError('Failed to determine your location type.');
                setLoadingNearby(false);
                return;
              }
              lat = latitude;
              lon = longitude;
            }
            if (typeof lat === 'number' && typeof lon === 'number') {
              try {
                const results = await fetchNearbyLocationsByType(
                  lat,
                  lon,
                  placeType,
                  20000,
                  signal,
                );
                const hintState = address?.state || address?.state_code || '';
                const enriched = await Promise.all(
                  results.map(async (loc) => {
                    try {
                      const resp = await fetch(
                        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${loc.lat}&lon=${loc.lon}&zoom=10&addressdetails=1`,
                        {
                          headers: {
                            Accept: 'application/json',
                            'User-Agent': 'real-estate-platform/1.0',
                          },
                          signal,
                        },
                      );
                      if (resp.ok) {
                        const data = await resp.json();
                        if (data && data.address) {
                          return { ...loc, address: data.address };
                        }
                      }
                    } catch (e: any) {
                      if (e?.name !== 'AbortError') console.error('[Nominatim] Enrich failed', e);
                    }
                    return { ...loc, _hint_state: hintState };
                  }),
                );
                if (signal.aborted) return;
                nearbyForKey.current = geoKey;
                setNearbyLocations(enriched);
                if (enriched.length === 0) setNearbyError('No nearby locations found.');
              } catch (e: any) {
                if (e?.name !== 'AbortError') setNearbyError('Failed to fetch nearby locations.');
              }
            }
            if (!signal.aborted) setLoadingNearby(false);
          },
          () => {
            if (signal.aborted) return;
            setNearbyError(
              'Could not get your current position. Please check browser permissions.',
            );
            setNearbyLocations([]);
            setLoadingNearby(false);
          },
        );
        return;
      } else {
        setNearbyError('Geolocation is not supported in this browser.');
        setNearbyLocations([]);
        setLoadingNearby(false);
        return;
      }
    }
    // If we have lat/lon from suggestion or lastGeo, fetch nearby
    if (typeof lat === 'number' && typeof lon === 'number') {
      const key = `${Number(lat).toFixed(5)},${Number(lon).toFixed(5)}`;
      try {
        const results = await fetchNearbyLocationsByType(lat, lon, placeType, 20000, signal);
        // Enrich each result with Nominatim reverse geocode for address
        const hintState = address?.state || address?.state_code || '';
        const enriched = await Promise.all(
          results.map(async (loc) => {
            try {
              const resp = await fetch(
                `https://nominatim.openstreetmap.org/reverse?format=json&lat=${loc.lat}&lon=${loc.lon}&zoom=10&addressdetails=1`,
                {
                  headers: { Accept: 'application/json', 'User-Agent': 'real-estate-platform/1.0' },
                  signal,
                },
              );
              if (resp.ok) {
                const data = await resp.json();
                if (data && data.address) {
                  return { ...loc, address: data.address };
                }
              }
            } catch (e: any) {
              if (e?.name !== 'AbortError') console.error('[Nominatim] Enrich failed', e);
            }
            return { ...loc, _hint_state: hintState };
          }),
        );
        if (signal.aborted) return;
        nearbyForKey.current = key;
        setNearbyLocations(enriched);
        if (enriched.length === 0) setNearbyError('No nearby locations found.');
      } catch (e: any) {
        if (e?.name !== 'AbortError') setNearbyError('Failed to fetch nearby locations.');
      }
    }
    if (!signal.aborted) setLoadingNearby(false);
  };

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    if (lastGeo) {
      handleFetchNearbyLocations(false).catch(() => {});
      return;
    }
    if (!navigator.permissions) return;
    navigator.permissions
      .query({ name: 'geolocation' })
      .then((status) => {
        if (status.state === 'granted') {
          handleFetchNearbyLocations(true).catch(() => {});
        }
      })
      .catch(() => {});
  }, []);

  const router = useRouter();
  // Location autocomplete state
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [recentSearches, setRecentSearches] = useState<any[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const [isCommittedSelection, setIsCommittedSelection] = useState(false);
  const isCommittedSelectionRef = useRef(false);
  const [activePanel, setActivePanel] = useState<SearchPanel | null>(
    mobileSheetMode ? 'where' : null,
  );
  const [isSearching, setIsSearching] = useState(false);
  const [whereShake, setWhereShake] = useState(false);
  const [isGeolocating, setIsGeolocating] = useState(false);

  // When a suggestion is already in context (e.g. restored from URL on navigation),
  // mark it as committed so handleSearch doesn't treat it as unresolved.
  useEffect(() => {
    if (selectedSuggestion) {
      isCommittedSelectionRef.current = true;
      setIsCommittedSelection(true);
    }
  }, [selectedSuggestion]);

  const whereRef = useRef<HTMLButtonElement>(null);
  const whenRef = useRef<HTMLButtonElement>(null);
  const whatRef = useRef<HTMLButtonElement>(null);
  const searchBtnRef = useRef<HTMLDivElement>(null);
  const getIndicatorStyle = (): React.CSSProperties => {
    if (!activePanel) return {};
    // Keyed by SearchPanel, so the focus indicator can only ever be asked for a segment that
    // exists — there is no 'who' slot to point at (#34).
    const refs: Record<SearchPanel, React.RefObject<HTMLButtonElement | null>> = {
      where: whereRef,
      when: whenRef,
      what: whatRef,
    };
    const btn = refs[activePanel]?.current;
    if (!btn) return {};
    if (activePanel === 'what' && searchBtnRef.current) {
      return { left: btn.offsetLeft, width: btn.offsetWidth + searchBtnRef.current.offsetWidth };
    }
    return { left: btn.offsetLeft, width: btn.offsetWidth };
  };
  const [calendarBaseMonth, setCalendarBaseMonth] = useState<{ year: number; month: number }>(
    () => {
      const now = new Date();
      return { year: now.getFullYear(), month: now.getMonth() };
    },
  );
  const panelRef = useRef<HTMLDivElement | null>(null);
  // Load recent searches from localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('recentSearches');
      if (stored) {
        setRecentSearches(JSON.parse(stored));
      }
    }
  }, []);

  // Save recent searches to localStorage
  const addRecentSearch = (item: any) => {
    if (!item) return;
    setRecentSearches((prev) => {
      const filtered = prev.filter((s) => s.display_name !== item.display_name);
      const updated = [item, ...filtered].slice(0, 5);
      if (typeof window !== 'undefined') {
        localStorage.setItem('recentSearches', JSON.stringify(updated));
      }
      return updated;
    });
  };

  // Close dropdown on outside click
  useEffect(() => {
    if (!isDropdownOpen) return;
    function handleClick(e: MouseEvent) {
      if (
        inputRef.current &&
        !inputRef.current.contains(e.target as Node) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setIsDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isDropdownOpen]);

  // Close activePanel when clicking outside the search bar
  useEffect(() => {
    if (!activePanel) return;
    function handleOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setActivePanel(null);
        setIsDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [activePanel]);

  // Recalculate indicator position on window resize
  const [, setResizeTick] = useState(0);
  useEffect(() => {
    if (!activePanel) return;
    const handler = () => setResizeTick((n) => n + 1);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, [activePanel]);

  // Close activePanel on searchbar:close event (fired during header transitions)
  useEffect(() => {
    function handleClose() {
      setActivePanel(null);
      setIsDropdownOpen(false);
    }
    window.addEventListener('searchbar:close', handleClose);
    return () => window.removeEventListener('searchbar:close', handleClose);
  }, []);

  // Mobile sheet mode: lock body scroll
  useEffect(() => {
    if (!mobileSheetMode) return;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileSheetMode]);

  // Mobile sheet mode: close on Escape
  useEffect(() => {
    if (!mobileSheetMode || !onClose) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [mobileSheetMode, onClose]);

  // Mobile sheet mode: auto-focus where input when where card is active
  useEffect(() => {
    if (!mobileSheetMode || activePanel !== 'where') return;
    setTimeout(() => inputRef.current?.focus(), 100);
  }, [mobileSheetMode, activePanel]);

  // Mobile sheet mode: auto-close when viewport expands to sm (≥640px)
  useEffect(() => {
    if (!mobileSheetMode || !onClose) return;
    const mq = window.matchMedia('(min-width: 640px)');
    const handler = (e: MediaQueryListEvent) => {
      if (e.matches) onClose();
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [mobileSheetMode, onClose]);

  // "What" property criteria — shared via context
  const selectedPropertyTypes = searchPropertyTypes;
  const setSelectedPropertyTypes = setSearchPropertyTypes;
  const baths = searchBaths;
  const setBaths = setSearchBaths;
  const description = searchDescription;
  const setDescription = setSearchDescription;
  const searchMaxPrice = searchMaxPriceCtx;
  const setSearchMaxPrice = setSearchMaxPriceCtx;
  const _whatSuggestionsRef = useRef<HTMLDivElement>(null);
  const whatHighlightRef = useRef<HTMLDivElement>(null);
  const whereHighlightRef = useRef<HTMLDivElement>(null);
  const whereHighlightRef2 = useRef<HTMLDivElement>(null);
  const whatHighlightRef2 = useRef<HTMLDivElement>(null);

  // --- Lot/Land interlock (#24) --------------------------------------------
  //
  // A parcel has no dwelling, so `beds`/`baths` are NULL on it and any dwelling predicate the API
  // is handed excludes every parcel — a stale `beds=2` next to a Lot/Land chip returns zero results
  // with nothing on screen to explain why. The fix is in the UI, not in the request builder: the
  // controls are cleared and disabled, so the API still receives exactly what the user asked for.
  const parcelOnly = isParcelOnlySelection(selectedPropertyTypes);
  const parcelHintId = parcelOnly ? PARCEL_HINT_ID : undefined;

  // Clearing on the chip's own click would miss the other way in: state restored from a URL that
  // already carries both (`?propertyType=Lot/Land&beds=2`). Reconciling here catches every path,
  // and the guard makes it a single converging pass rather than a loop.
  useEffect(() => {
    if (!parcelOnly) return;
    if (searchBedsIdx !== 0) setSearchBedsIdx(0);
    if (baths !== '') setBaths('');
  }, [parcelOnly, searchBedsIdx, baths]);

  const SLIDE_TRANSITION =
    'top 0.22s cubic-bezier(0.4,0,0.2,1), height 0.22s cubic-bezier(0.4,0,0.2,1), opacity 0.12s';
  const FADE_ONLY_TRANSITION = 'opacity 0.12s';

  function applyHighlight(
    ref: React.RefObject<HTMLDivElement | null>,
    top: number,
    height: number,
  ) {
    const el = ref.current;
    if (!el) return;
    const isHidden = parseFloat(el.style.opacity || '0') < 0.5;
    if (isHidden) {
      // Snap to position instantly, then fade in — no sliding from nowhere
      el.style.transition = 'none';
      el.style.top = `${top}px`;
      el.style.height = `${height}px`;
      el.getBoundingClientRect(); // force reflow so browser paints position before transition re-enables
      el.style.transition = SLIDE_TRANSITION;
      el.style.opacity = '1';
    } else {
      // Already visible: slide smoothly to the new item
      el.style.transition = SLIDE_TRANSITION;
      el.style.top = `${top}px`;
      el.style.height = `${height}px`;
    }
  }
  function clearHighlight(ref: React.RefObject<HTMLDivElement | null>) {
    const el = ref.current;
    if (!el) return;
    el.style.transition = FADE_ONLY_TRANSITION;
    el.style.opacity = '0';
  }

  function renderWhatPanelContent(_highlightRef: React.RefObject<HTMLDivElement | null>) {
    const BATHS_OPTS = ['Any', '1+', '2+', '3+', '4+', '5+'];
    const bathIdx = baths === '' ? 0 : BATHS_OPTS.indexOf(baths);
    const bedsOpts = BED_OPTIONS.map((b) => (b.value ? b.value + '+' : 'Any'));
    const stepperBtn = (
      disabled: boolean,
      onClick: () => void,
      label: string,
      describedBy?: string,
    ) => (
      <button
        type="button"
        disabled={disabled}
        aria-disabled={disabled}
        aria-describedby={describedBy}
        onClick={onClick}
        className={`h-8 w-8 rounded-full border inline-flex items-center justify-center leading-none select-none transition-colors ${
          disabled
            ? 'border-[rgba(0,0,0,0.12)] text-[rgba(0,0,0,0.2)] cursor-default'
            : 'border-[rgba(0,0,0,0.4)] text-ink hover:border-ink cursor-pointer'
        }`}
        style={{ fontSize: '18px', paddingBottom: label === '–' ? '1px' : '0' }}
      >
        {label}
      </button>
    );

    return (
      <div className="flex flex-col gap-5">
        {/* Listing type selector */}
        <div>
          <p className="text-xs font-semibold text-ink uppercase tracking-wider mb-2">
            Listing type
          </p>
          <div className="flex gap-2">
            {(['for-sale', 'for-rent'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setListingType(tab);
                  setListingTab(tab);
                }}
                className={`flex-1 py-2.5 rounded-full text-sm font-semibold transition-colors duration-150 ${
                  listingType === tab
                    ? 'bg-ink text-white shadow-sm'
                    : 'bg-surface-alt text-ink-muted hover:bg-surface-soft'
                }`}
              >
                {tab === 'for-sale' ? 'For Sale' : 'For Rent'}
              </button>
            ))}
          </div>
        </div>

        {/* Property Type */}
        {/*
         * One property type at a time, because that is what the API can apply: the wire contract's
         * `propertyType` is a single enum value under a strict-parsed request. These were checkboxes
         * emitting `propertyType=Condo,Townhome`, which the search page never read before #24 — so
         * the control looked multi-select and filtered nothing at all. Reading the parameter makes
         * it real, and a comma-joined value would now be rejected outright with a 400. Radios keep
         * the UI able to express only what the request can carry.
         *
         * Multi-select is a genuine product capability, not a regression being papered over: it
         * needs `searchRequestSchema` to accept a set, the repository predicate to match on it, and
         * the Lot/Land interlock to keep firing only for a parcels-and-nothing-else selection.
         * Flagged to the product owner on #24 rather than assumed here.
         */}
        <div>
          <p
            className="text-xs font-semibold text-ink uppercase tracking-wider mb-2"
            id="property-type-label"
          >
            Property Type
          </p>
          <div
            className="grid grid-cols-3 gap-x-4 gap-y-1.5"
            role="radiogroup"
            aria-labelledby="property-type-label"
          >
            {PROPERTY_TYPES.map((type) => {
              const active = selectedPropertyTypes.includes(type);
              return (
                <label
                  key={type}
                  className="flex items-center gap-2 text-sm text-ink cursor-pointer select-none py-0.5"
                >
                  <input
                    type="radio"
                    name="propertyType"
                    checked={active}
                    // Clicking the active type clears it, which is how "any type" is expressed.
                    onClick={() => setSelectedPropertyTypes(active ? [] : [type])}
                    onChange={() => undefined}
                    className="h-4 w-4 border-gray-300 text-brand focus:ring-brand/30"
                  />
                  <span className="font-normal">{type}</span>
                </label>
              );
            })}
          </div>
        </div>

        {/* Beds, Baths & Price */}
        <div className="border-t border-surface-border pt-4">
          {parcelOnly && (
            <p id={PARCEL_HINT_ID} className="text-[13px] text-ink-muted pb-2">
              {PARCEL_INTERLOCK_HINT}
            </p>
          )}
          <div className="flex items-center justify-between py-1">
            <span className={`text-sm font-medium ${parcelOnly ? 'text-ink-subtle' : 'text-ink'}`}>
              Bedrooms
            </span>
            <div className="flex items-center gap-4">
              {stepperBtn(
                parcelOnly || bedsIdx === 0,
                () => setSearchBedsIdx(bedsIdx - 1),
                '–',
                parcelHintId,
              )}
              <span
                className={`w-8 text-center text-[15px] font-normal ${parcelOnly ? 'text-ink-subtle' : 'text-ink'}`}
              >
                {parcelOnly ? 'Any' : bedsOpts[bedsIdx]}
              </span>
              {stepperBtn(
                parcelOnly || bedsIdx === BED_OPTIONS.length - 1,
                () => setSearchBedsIdx(bedsIdx + 1),
                '+',
                parcelHintId,
              )}
            </div>
          </div>
          <div className="flex items-center justify-between py-1 mt-2">
            <span className={`text-sm font-medium ${parcelOnly ? 'text-ink-subtle' : 'text-ink'}`}>
              Bathrooms
            </span>
            <div className="flex items-center gap-4">
              {stepperBtn(
                parcelOnly || bathIdx === 0,
                () => setBaths(bathIdx === 1 ? '' : BATHS_OPTS[bathIdx - 1]),
                '–',
                parcelHintId,
              )}
              <span
                className={`w-8 text-center text-[15px] font-normal ${parcelOnly ? 'text-ink-subtle' : 'text-ink'}`}
              >
                {parcelOnly || bathIdx === 0 ? 'Any' : BATHS_OPTS[bathIdx]}
              </span>
              {stepperBtn(
                parcelOnly || bathIdx === BATHS_OPTS.length - 1,
                () => setBaths(BATHS_OPTS[bathIdx + 1]),
                '+',
                parcelHintId,
              )}
            </div>
          </div>
          <div className="flex items-center justify-between py-1 mt-2">
            <span className="text-sm font-medium text-ink">Price</span>
            <div className="flex items-center gap-4">
              {stepperBtn(
                searchMaxPrice === 0,
                () => setSearchMaxPrice(Math.max(0, searchMaxPrice - 25000)),
                '–',
              )}
              <span className="w-24 text-center text-[15px] font-normal text-ink whitespace-nowrap">
                {searchMaxPrice === 0
                  ? 'Any'
                  : searchMaxPrice >= 1000000
                    ? `≤ $${(searchMaxPrice / 1000000).toFixed(searchMaxPrice % 1000000 === 0 ? 0 : 2)}M`
                    : `≤ $${(searchMaxPrice / 1000).toFixed(0)}k`}
              </span>
              {stepperBtn(false, () => setSearchMaxPrice(searchMaxPrice + 25000), '+')}
            </div>
          </div>
        </div>

        {/* Description */}
        <div className="border-t border-surface-border pt-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-ink uppercase tracking-wider">Description</p>
            {description && (
              <button
                type="button"
                onClick={() => setDescription('')}
                className="text-xs font-semibold text-red-500 hover:text-red-700"
              >
                Clear
              </button>
            )}
          </div>
          <textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe your ideal home..."
            className="w-full resize-none rounded-xl border border-surface-border px-4 py-3 text-[15px] text-ink placeholder:text-ink-muted focus:outline-none focus:border-surface-border-strong focus:ring-1 focus:ring-surface-border-strong"
          />
        </div>
      </div>
    );
  }

  function renderWhatPanel(highlightRef: React.RefObject<HTMLDivElement | null>) {
    return (
      <div
        className="search-panel-enter absolute left-0 right-0 z-[200] bg-white rounded-xl shadow-card border border-surface-border max-h-[70vh] overflow-y-auto"
        style={{ top: 'calc(100% + 6px)' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="p-5">{renderWhatPanelContent(highlightRef)}</div>
      </div>
    );
  }

  function renderWhenPanel() {
    return (
      <DateRangePanel
        dateRange={dateRange}
        setDateRange={setDateRange}
        rangePickStep={rangePickStep}
        setRangePickStep={setRangePickStep}
        hoveredDate={hoveredDate}
        setHoveredDate={setHoveredDate}
        calendarBaseMonth={calendarBaseMonth}
        setCalendarBaseMonth={setCalendarBaseMonth}
        onClose={() => setActivePanel(null)}
        listingType={listingType}
      />
    );
  }

  function renderWherePanel(highlightRef: React.RefObject<HTMLDivElement | null>) {
    return (
      <div
        className="search-panel-enter absolute left-0 right-0 z-[200] bg-white rounded-xl shadow-card border border-surface-border overflow-hidden"
        style={{ top: 'calc(100% + 6px)' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="p-4">
          <div className="relative">
            <input
              ref={inputRef}
              type="text"
              value={location}
              autoComplete="off"
              placeholder="Search city, zip, neighborhood, or address"
              className="w-full rounded-full border border-surface-border bg-white px-5 py-3 text-[15px] focus:outline-none focus:border-surface-border-strong focus:ring-1 focus:ring-surface-border-strong pr-10"
              onChange={(e) => {
                const val = e.target.value;
                isCommittedSelectionRef.current = false;
                setIsCommittedSelection(false);
                if (typeof setLocation === 'function') setLocation(val);
                setSelectedSuggestion(null);
                if (debounceRef.current) clearTimeout(debounceRef.current);
                if (!val.trim() || val.trim().length < 2) {
                  setSuggestions([]);
                  setIsDropdownOpen(true);
                  return;
                }
                setLoadingSuggestions(true);
                debounceRef.current = setTimeout(async () => {
                  try {
                    const resp = await fetch(`/api/geocode?q=${encodeURIComponent(val)}`);
                    setSuggestions(resp.ok ? await resp.json() : []);
                  } catch {
                    setSuggestions([]);
                  } finally {
                    setLoadingSuggestions(false);
                    setIsDropdownOpen(true);
                  }
                }, 300);
              }}
              onFocus={async () => {
                setIsDropdownOpen(true);
                if (!location.trim()) await handleFetchNearbyLocations();
              }}
            />
            {location && (
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  if (typeof setLocation === 'function') setLocation('');
                  setSelectedSuggestion(null);
                  isCommittedSelectionRef.current = false;
                  setIsCommittedSelection(false);
                  setSuggestions([]);
                  inputRef.current?.focus({ preventScroll: true });
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded-full hover:bg-black/[0.08] text-ink/50 hover:text-ink transition-colors"
                aria-label="Clear location"
              >
                <svg
                  className="h-3 w-3"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.5}
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>
        <div
          ref={dropdownRef}
          className="relative pb-3 max-h-72 overflow-y-auto"
          onMouseLeave={() => clearHighlight(highlightRef)}
        >
          <div
            ref={highlightRef}
            className="absolute inset-x-0 bg-surface-soft pointer-events-none"
            style={{ top: 0, height: 0, opacity: 0 }}
          />
          <hr className="border-t border-surface-border mb-1" />
          {(location.trim().length < 2 || suggestions.length === 0) && (
            <button
              type="button"
              onMouseEnter={(e) =>
                applyHighlight(
                  highlightRef,
                  e.currentTarget.offsetTop,
                  e.currentTarget.offsetHeight,
                )
              }
              className="relative z-[1] flex w-full items-center gap-3 px-5 py-3 text-left transition-colors"
              onClick={async () => {
                await handleGeolocate();
                setActivePanel(null);
                setIsDropdownOpen(false);
              }}
            >
              <span className="inline-block w-5 h-5 text-brand flex-shrink-0">
                <svg width="20" height="20" fill="none" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
                  <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="2" />
                </svg>
              </span>
              <span className="font-medium text-[15px]">Use current location</span>
            </button>
          )}
          {location.trim().length >= 2 && loadingSuggestions && (
            <div className="px-5 py-3 text-ink-subtle text-sm">Loading?</div>
          )}
          {location.trim().length >= 2 && !loadingSuggestions && suggestions.length === 0 && (
            <div className="px-5 py-3 text-ink-subtle text-sm">No locations found</div>
          )}
          {suggestions.map((s) => (
            <button
              key={s.place_id}
              type="button"
              onMouseEnter={(e) =>
                applyHighlight(
                  highlightRef,
                  e.currentTarget.offsetTop,
                  e.currentTarget.offsetHeight,
                )
              }
              className="relative z-[1] flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors"
              onClick={() => {
                setSelectedSuggestion(s);
                isCommittedSelectionRef.current = true;
                setIsCommittedSelection(true);
                if (typeof setLocation === 'function') setLocation(formatLocationLabel(s));
                setActivePanel(null);
                setIsDropdownOpen(false);
                addRecentSearch(s);
              }}
            >
              <span className="inline-block w-5 h-5 text-ink-subtle flex-shrink-0">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <path
                    d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"
                    fill="currentColor"
                  />
                </svg>
              </span>
              <span className="text-[15px] truncate">
                {highlightMatch(formatLocationLabel(s), location)}
              </span>
            </button>
          ))}
          {/* Nearby */}
          {(location.trim().length < 2 || suggestions.length === 0 || isCommittedSelection) &&
            (loadingNearby || nearbyLocations.length > 0) && (
              <>
                <hr className="border-t border-surface-border my-1" />
                <div className="px-5 pt-2 pb-1 text-[11px] text-ink-subtle font-semibold tracking-widest uppercase">
                  Nearby
                </div>
                {loadingNearby && (
                  <div className="px-5 py-2 text-ink-subtle text-sm">Loading nearby...</div>
                )}
                {!loadingNearby &&
                  nearbyLocations
                    .filter((loc) => {
                      if (!formatLocationLabel(loc)) return false;
                      const locLabel = formatLocationLabel(loc).toLowerCase();
                      if (
                        selectedSuggestion &&
                        loc.lat &&
                        loc.lon &&
                        selectedSuggestion.lat &&
                        selectedSuggestion.lon
                      ) {
                        if (
                          Number(loc.lat).toFixed(5) ===
                            Number(selectedSuggestion.lat).toFixed(5) &&
                          Number(loc.lon).toFixed(5) === Number(selectedSuggestion.lon).toFixed(5)
                        )
                          return false;
                      }
                      if (
                        selectedSuggestion &&
                        locLabel === formatLocationLabel(selectedSuggestion).toLowerCase()
                      )
                        return false;
                      return true;
                    })
                    .map((loc, idx) => (
                      <button
                        key={loc.display_name + idx}
                        type="button"
                        onMouseEnter={(e) =>
                          applyHighlight(
                            highlightRef,
                            e.currentTarget.offsetTop,
                            e.currentTarget.offsetHeight,
                          )
                        }
                        className="relative z-[1] flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors"
                        onClick={() => {
                          const formatted = formatLocationLabel(loc);
                          if (typeof setLocation === 'function') setLocation(formatted);
                          isCommittedSelectionRef.current = true;
                          setIsCommittedSelection(true);
                          setSelectedSuggestion({ ...loc, display_name: formatted });
                          setActivePanel(null);
                          setIsDropdownOpen(false);
                        }}
                      >
                        <span className="inline-block w-5 h-5 text-ink-subtle flex-shrink-0">
                          <svg viewBox="0 0 24 24" fill="none">
                            <path
                              d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"
                              fill="currentColor"
                            />
                          </svg>
                        </span>
                        <span className="text-[15px] truncate">
                          {highlightMatch(formatLocationLabel(loc), location)}
                        </span>
                      </button>
                    ))}
              </>
            )}
          {/* Recent searches */}
          {(location.trim().length < 2 || suggestions.length === 0 || isCommittedSelection) &&
            recentSearches.length > 0 && (
              <>
                <hr className="border-t border-surface-border my-1" />
                <div className="px-5 pt-2 pb-1 text-[11px] text-ink-subtle font-semibold tracking-widest uppercase">
                  Recent
                </div>
                {recentSearches.map((s, idx) => (
                  <div
                    key={s.display_name + idx}
                    onMouseEnter={(e) =>
                      applyHighlight(
                        highlightRef,
                        e.currentTarget.offsetTop,
                        e.currentTarget.offsetHeight,
                      )
                    }
                    className="relative z-[1] flex w-full items-center px-5 py-2.5 transition-colors group"
                  >
                    <button
                      type="button"
                      className="flex items-center flex-1 min-w-0 gap-3"
                      onClick={() => {
                        setSelectedSuggestion(s);
                        isCommittedSelectionRef.current = true;
                        setIsCommittedSelection(true);
                        if (typeof setLocation === 'function') setLocation(formatLocationLabel(s));
                        setActivePanel(null);
                        setIsDropdownOpen(false);
                      }}
                    >
                      <span className="inline-block w-5 h-5 text-ink-subtle flex-shrink-0">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">
                          <path
                            d="M17.01 14h-.8l-.27-.27c.98-1.14 1.57-2.61 1.57-4.23 0-3.59-2.91-6.5-6.5-6.5s-6.5 3-6.5 6.5H2l3.84 4 4.16-4H6.51C6.51 7 8.53 5 11.01 5s4.5 2.01 4.5 4.5c0 2.48-2.02 4.5-4.5 4.5-.65 0-1.26-.14-1.82-.38L7.71 15.1c.97.57 2.09.9 3.3.9 1.61 0 3.08-.59 4.22-1.57l.27.27v.79l5.01 4.99L22 19l-4.99-5z"
                            fill="currentColor"
                          />
                        </svg>
                      </span>
                      <span className="text-[15px] truncate">
                        {highlightMatch(formatLocationLabel(s), location)}
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-label="Remove recent search"
                      tabIndex={-1}
                      className="absolute right-3 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 p-1.5 rounded-full hover:bg-surface-alt transition-opacity"
                      onClick={(e) => {
                        e.stopPropagation();
                        setRecentSearches((prev) => {
                          const updated = prev.filter((_, i) => i !== idx);
                          if (typeof window !== 'undefined')
                            localStorage.setItem('recentSearches', JSON.stringify(updated));
                          return updated;
                        });
                      }}
                    >
                      <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
                        <path
                          d="M5 5l8 8M13 5l-8 8"
                          stroke="#888"
                          strokeWidth="2"
                          strokeLinecap="round"
                        />
                      </svg>
                    </button>
                  </div>
                ))}
              </>
            )}
        </div>
      </div>
    );
  }

  // listingType mirrors context listingTab with a local copy for optimistic tab switch animation
  const [listingType, setListingType] = useState<'for-sale' | 'for-rent'>(listingTab || 'for-sale');

  React.useEffect(() => {
    if (listingTab && listingTab !== listingType) setListingType(listingTab);
  }, [listingTab]);

  // Enhanced search: if location is empty, use geolocation; else require valid suggestion
  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!(location || '').trim()) {
      setIsSearching(true);
      setIsGeolocating(true);
      await handleGeolocate();
      setIsGeolocating(false);
      setIsSearching(false);
      return;
    }
    // If suggestions are still loading, open the where panel so user can see/wait
    if (loadingSuggestions) {
      setActivePanel('where');
      setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 50);
      return;
    }
    // If user hasn't selected a suggestion, but suggestions exist, auto-select the first
    let finalSuggestion = selectedSuggestion;
    if (!selectedSuggestion && suggestions.length > 0) {
      finalSuggestion = suggestions[0];
      setSelectedSuggestion(finalSuggestion);
      isCommittedSelectionRef.current = true;
      setIsCommittedSelection(true);
      if (typeof setLocation === 'function') setLocation(formatLocationLabel(finalSuggestion));
    }
    if (!finalSuggestion) {
      // No valid location — open the where panel and shake it to prompt the user
      setActivePanel('where');
      setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 50);
      setWhereShake(true);
      setTimeout(() => setWhereShake(false), 600);
      return;
    }
    // Use the selected/closest suggestion
    addRecentSearch(finalSuggestion);
    const label = formatLocationLabel(finalSuggestion);
    if (typeof setLocation === 'function') setLocation(label);
    const { zip, street } = extractSearchTerms(finalSuggestion);
    const params = new URLSearchParams();
    params.set('q', label);
    params.set('lat', finalSuggestion.lat);
    params.set('lon', finalSuggestion.lon);
    if (zip) params.set('zip', zip);
    if (street) params.set('street', street);
    if (searchMaxPrice > 0) params.set('maxPrice', String(searchMaxPrice));
    const beds = BED_OPTIONS[bedsIdx].value;
    if (beds) params.set('beds', beds);
    const bathsValue = baths ? bathsParamValue(baths) : undefined;
    if (bathsValue) params.set('baths', bathsValue);
    if (selectedPropertyTypes.length > 0)
      params.set('propertyType', selectedPropertyTypes.join(','));
    params.set('type', LISTING_TYPE_FOR_TAB[listingType]);
    setIsSearching(true);
    router.push(`/search?${params.toString()}`);
    setIsDropdownOpen(false);
    setActivePanel(null);
    if (mode === 'expanded') setHeaderExpanded(false);
  };

  // Always trigger geolocation and update location input
  const handleGeolocate = (): Promise<void> => {
    // Cancel any previous in-flight geolocate fetch
    geoAbortRef.current?.abort();
    const ac = new AbortController();
    geoAbortRef.current = ac;
    const signal = ac.signal;

    return new Promise((resolve) => {
      if (typeof window !== 'undefined' && 'geolocation' in navigator) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            if (signal.aborted) {
              resolve();
              return;
            }
            const { latitude, longitude } = pos.coords;
            (async () => {
              let displayName = `Current Location (${latitude.toFixed(5)}, ${longitude.toFixed(5)})`;
              try {
                const response = await fetch(
                  `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=10&addressdetails=1`,
                  {
                    headers: {
                      Accept: 'application/json',
                      'User-Agent': 'real-estate-platform/1.0',
                    },
                    signal,
                  },
                );
                // error handling is in the correct handler, not here
                if (response.ok) {
                  const data = await response.json();
                  if (data && data.address) {
                    // Compose 'City, State' if possible
                    // error handling is in the correct handler, not here
                    const city =
                      data.address.city || data.address.town || data.address.village || '';
                    // error handling is in the correct handler, not here
                    const state = data.address.state || data.address.state_code || '';
                    const parts = [];
                    if (city) parts.push(city);
                    if (state) parts.push(state);
                    const formatted = parts.join(', ');
                    // error handling is in the correct handler, not here
                    displayName = formatted || displayName;
                  }
                }
              } catch (e: any) {
                if (e?.name === 'AbortError') {
                  resolve();
                  return;
                }
              }
              if (signal.aborted) {
                resolve();
                return;
              }
              if (typeof setLocation === 'function') setLocation(displayName);
              const params = new URLSearchParams();
              params.set('q', displayName);
              if (searchMaxPrice > 0) params.set('maxPrice', String(searchMaxPrice));
              const beds = BED_OPTIONS[bedsIdx].value;
              if (beds) params.set('beds', beds);
              const bathsValue = baths ? bathsParamValue(baths) : undefined;
              if (bathsValue) params.set('baths', bathsValue);
              if (selectedPropertyTypes.length > 0)
                params.set('propertyType', selectedPropertyTypes.join(','));
              params.set('type', LISTING_TYPE_FOR_TAB[listingType]);
              router.push(`/search?${params.toString()}`);
              resolve();
            })();
          },
          (err) => {
            if (signal.aborted) {
              resolve();
              return;
            }
            console.error('[Geolocation] Error getting current position:', err);
            alert(
              'Unable to get your current location. Please check your browser permissions and try again.',
            );
            if (typeof setLocation === 'function') setLocation('');
            const params = new URLSearchParams();
            params.set('q', '');
            if (searchMaxPrice > 0) params.set('maxPrice', String(searchMaxPrice));
            const beds = BED_OPTIONS[bedsIdx].value;
            if (beds) params.set('beds', beds);
            const bathsValue = baths ? bathsParamValue(baths) : undefined;
            if (bathsValue) params.set('baths', bathsValue);
            if (selectedPropertyTypes.length > 0)
              params.set('propertyType', selectedPropertyTypes.join(','));
            params.set('type', LISTING_TYPE_FOR_TAB[listingType]);
            router.push(`/search?${params.toString()}`);
            resolve();
          },
        );
      } else {
        alert('Geolocation is not supported in this browser.');
        if (typeof setLocation === 'function') setLocation('');
        const params = new URLSearchParams();
        params.set('q', '');
        if (searchMaxPrice > 0) params.set('maxPrice', String(searchMaxPrice));
        const beds = BED_OPTIONS[bedsIdx].value;
        if (beds) params.set('beds', beds);
        const bathsValue = baths ? bathsParamValue(baths) : undefined;
        if (bathsValue) params.set('baths', bathsValue);
        if (selectedPropertyTypes.length > 0)
          params.set('propertyType', selectedPropertyTypes.join(','));
        params.set('type', LISTING_TYPE_FOR_TAB[listingType]);
        router.push(`/search?${params.toString()}`);
        resolve();
      }
    });
  };

  // --- helpers (used in both render paths) ---------------------------------

  function _formatMoveInDate(d: string): string {
    if (!d) return '';
    const parts = d.split('-');
    const month = parseInt(parts[1]) - 1;
    const day = parts[2] ? parseInt(parts[2]) : null;
    const year = parseInt(parts[0]);
    const months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    const currentYear = new Date().getFullYear();
    if (day)
      return year !== currentYear ? `${months[month]} ${day}, ${year}` : `${months[month]} ${day}`;
    return `${months[month]} ${year}`;
  }

  function formatDateRangeLabel(range: {
    start: string;
    end: string;
    flexibility: string;
  }): string {
    if (!range.start) return '';
    const months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    function fmt(ds: string) {
      const [y, m, d] = ds.split('-');
      const mo = months[parseInt(m) - 1];
      const currentYear = new Date().getFullYear();
      return parseInt(y) !== currentYear ? `${mo} ${parseInt(d)}, ${y}` : `${mo} ${parseInt(d)}`;
    }
    const flexSuffix: Record<string, string> = {
      '1': '±1d',
      '3': '±3d',
      '7': '±1wk',
      '14': '±2wk',
      '30': '±1mo',
      '60': '±2mo',
      '90': '±3mo',
      '180': '±6mo',
      '365': '±1yr',
      '730': '±2yr',
    };
    if (!range.end || range.start === range.end) {
      const label = fmt(range.start);
      const suf = flexSuffix[range.flexibility];
      return suf ? `${label} ${suf}` : label;
    }
    return `${fmt(range.start)} – ${fmt(range.end)}`;
  }

  // --- mobileSheetMode: full-screen mobile search sheet reusing all panels --

  if (mobileSheetMode) {
    const flexLabelMap: Record<string, string> = {
      '1': '± 1 day',
      '3': '± 3 days',
      '7': '± 1 week',
      '14': '± 2 weeks',
      '30': '± 1 month',
      '60': '± 2 months',
      '90': '± 3 months',
      '180': '± 6 months',
      '365': '± 1 year',
      '730': '± 2 years',
    };
    const whenLabel = dateRange.start
      ? formatDateRangeLabel(dateRange)
      : dateRange.flexibility !== 'exact'
        ? (flexLabelMap[dateRange.flexibility] ?? '')
        : '';

    const handleClearAll = () => {
      if (typeof setLocation === 'function') setLocation('');
      setSelectedSuggestion(null);
      isCommittedSelectionRef.current = false;
      setIsCommittedSelection(false);
      setSuggestions([]);
      setDateRange({ start: '', end: '', flexibility: 'exact' });
      setRangePickStep('start');
      setSelectedPropertyTypes([]);
      setBaths('');
      setDescription('');
      setSearchMaxPrice(0);
      setActivePanel('where');
    };

    const handleSheetSearch = () => {
      const params = new URLSearchParams();
      if (selectedSuggestion) {
        params.set('q', formatLocationLabel(selectedSuggestion));
        params.set('lat', String(selectedSuggestion.lat));
        params.set('lon', String(selectedSuggestion.lon));
      } else if ((location || '').trim()) {
        params.set('q', (location || '').trim());
      }
      params.set('type', LISTING_TYPE_FOR_TAB[listingType]);
      if (dateRange.start) params.set('moveIn', dateRange.start);
      if (dateRange.end && dateRange.end !== dateRange.start)
        params.set('moveInEnd', dateRange.end);
      router.push(`/search?${params.toString()}`);
      onClose?.();
    };

    return (
      <div
        className="fixed inset-0 z-search-overlay bg-surface-alt flex flex-col"
        style={{ animation: 'mss-in 220ms ease both' }}
      >
        <style>
          {
            '@keyframes mss-in { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }'
          }
        </style>

        {/* ── Top bar ──────────────────────────────────────────────────── */}
        <div className="flex-shrink-0 bg-white border-b border-surface-border shadow-card">
          {/* Title row */}
          <div className="flex items-center justify-between px-4 pt-4 pb-3">
            <p className="text-[15px] font-bold text-ink tracking-tight">Search homes</p>
            <button
              onClick={onClose}
              className="h-8 w-8 flex items-center justify-center rounded-full hover:bg-surface-alt transition-colors"
              aria-label="Close search"
            >
              <svg
                className="h-[16px] w-[16px] text-ink"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.5}
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          {/* Listing type tabs */}
          <div className="flex gap-2 px-4 pb-3">
            {(['for-sale', 'for-rent'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setListingTab(tab)}
                className={`flex-1 py-2 rounded-full text-[13px] font-semibold transition-colors duration-150 ${
                  listingType === tab
                    ? 'bg-ink text-white shadow-sm'
                    : 'bg-surface-alt text-ink-muted hover:bg-surface-soft'
                }`}
              >
                {tab === 'for-sale' ? 'For Sale' : 'For Rent'}
              </button>
            ))}
          </div>
        </div>

        {/* ── Cards ────────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-4 pt-4 pb-4 space-y-2.5">
          {/* WHERE card */}
          <div
            className={`bg-white rounded-md shadow-card transition-all duration-200 overflow-hidden ${
              activePanel === 'where' ? 'ring-2 ring-ink' : 'cursor-pointer'
            }`}
            onClick={() => activePanel !== 'where' && setActivePanel('where')}
          >
            <div className="px-5 pt-4 pb-2">
              <p className="text-[11px] font-bold text-ink uppercase tracking-wider">Where?</p>
              {activePanel === 'where' ? (
                <div className="mt-3">
                  {/* Input — same styling as desktop panel */}
                  <div className="relative">
                    <input
                      ref={inputRef}
                      type="text"
                      value={location || ''}
                      autoComplete="off"
                      placeholder="Search city, zip, neighborhood, or address"
                      className="w-full rounded-full border border-surface-border bg-white px-5 py-3 text-[15px] focus:outline-none focus:border-surface-border-strong focus:ring-1 focus:ring-surface-border-strong pr-10"
                      onChange={(e) => {
                        const val = e.target.value;
                        isCommittedSelectionRef.current = false;
                        setIsCommittedSelection(false);
                        if (typeof setLocation === 'function') setLocation(val);
                        setSelectedSuggestion(null);
                        if (debounceRef.current) clearTimeout(debounceRef.current);
                        if (!val.trim() || val.trim().length < 2) {
                          setSuggestions([]);
                          setIsDropdownOpen(true);
                          return;
                        }
                        setLoadingSuggestions(true);
                        debounceRef.current = setTimeout(async () => {
                          try {
                            const r = await fetch(`/api/geocode?q=${encodeURIComponent(val)}`);
                            setSuggestions(r.ok ? await r.json() : []);
                          } catch {
                            setSuggestions([]);
                          } finally {
                            setLoadingSuggestions(false);
                            setIsDropdownOpen(true);
                          }
                        }, 300);
                      }}
                      onFocus={async () => {
                        setIsDropdownOpen(true);
                        if (!(location || '').trim()) await handleFetchNearbyLocations();
                      }}
                    />
                    {(location || '').trim() && (
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          if (typeof setLocation === 'function') setLocation('');
                          setSelectedSuggestion(null);
                          isCommittedSelectionRef.current = false;
                          setIsCommittedSelection(false);
                          setSuggestions([]);
                          inputRef.current?.focus({ preventScroll: true });
                        }}
                        className="absolute right-3 top-1/2 -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded-full hover:bg-black/[0.08] text-ink/50 hover:text-ink transition-colors"
                        aria-label="Clear location"
                      >
                        <svg
                          className="h-3 w-3"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2.5}
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M6 18L18 6M6 6l12 12"
                          />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-[14px] text-ink-muted mt-1 pb-2">{location || 'Anywhere'}</p>
              )}
            </div>

            {/* Dropdown list — same content as desktop panel, but inline */}
            {activePanel === 'where' && (
              <div className="relative pb-3" onMouseLeave={() => clearHighlight(whereHighlightRef)}>
                <div
                  ref={whereHighlightRef}
                  className="absolute inset-x-0 bg-surface-soft pointer-events-none"
                  style={{ top: 0, height: 0, opacity: 0 }}
                />
                <hr className="border-t border-surface-border mb-1" />
                {/* Use current location */}
                {((location || '').trim().length < 2 || suggestions.length === 0) && (
                  <button
                    type="button"
                    onMouseEnter={(e) =>
                      applyHighlight(
                        whereHighlightRef,
                        e.currentTarget.offsetTop,
                        e.currentTarget.offsetHeight,
                      )
                    }
                    className="relative z-[1] flex w-full items-center gap-3 px-5 py-3 text-left transition-colors"
                    onClick={async () => {
                      await handleGeolocate();
                      setActivePanel('when');
                    }}
                  >
                    <span className="inline-block w-5 h-5 text-brand flex-shrink-0">
                      <svg width="20" height="20" fill="none" viewBox="0 0 24 24">
                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
                        <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="2" />
                      </svg>
                    </span>
                    <span className="font-medium text-[15px]">Use current location</span>
                  </button>
                )}
                {(location || '').trim().length >= 2 && loadingSuggestions && (
                  <div className="px-5 py-3 text-ink-subtle text-sm">Loading…</div>
                )}
                {(location || '').trim().length >= 2 &&
                  !loadingSuggestions &&
                  suggestions.length === 0 && (
                    <div className="px-5 py-3 text-ink-subtle text-sm">No locations found</div>
                  )}
                {suggestions.map((s) => (
                  <button
                    key={s.place_id}
                    type="button"
                    onMouseEnter={(e) =>
                      applyHighlight(
                        whereHighlightRef,
                        e.currentTarget.offsetTop,
                        e.currentTarget.offsetHeight,
                      )
                    }
                    className="relative z-[1] flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors"
                    onClick={() => {
                      setSelectedSuggestion(s);
                      isCommittedSelectionRef.current = true;
                      setIsCommittedSelection(true);
                      if (typeof setLocation === 'function') setLocation(formatLocationLabel(s));
                      setSuggestions([]);
                      setIsDropdownOpen(false);
                      addRecentSearch(s);
                      setActivePanel('when');
                    }}
                  >
                    <span className="inline-block w-5 h-5 text-ink-subtle flex-shrink-0">
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <path
                          d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"
                          fill="currentColor"
                        />
                      </svg>
                    </span>
                    <span className="text-[15px] truncate">
                      {highlightMatch(formatLocationLabel(s), location || '')}
                    </span>
                  </button>
                ))}
                {/* Nearby */}
                {((location || '').trim().length < 2 ||
                  suggestions.length === 0 ||
                  isCommittedSelection) &&
                  (loadingNearby || nearbyLocations.length > 0) && (
                    <>
                      <hr className="border-t border-surface-border my-1" />
                      <div className="px-5 pt-2 pb-1 text-[11px] text-ink-subtle font-semibold tracking-widest uppercase">
                        Nearby
                      </div>
                      {loadingNearby && (
                        <div className="px-5 py-2 text-ink-subtle text-sm">Loading nearby...</div>
                      )}
                      {!loadingNearby &&
                        nearbyLocations
                          .filter((loc) => {
                            if (!formatLocationLabel(loc)) return false;
                            const locLabel = formatLocationLabel(loc).toLowerCase();
                            if (
                              selectedSuggestion &&
                              loc.lat &&
                              loc.lon &&
                              selectedSuggestion.lat &&
                              selectedSuggestion.lon
                            ) {
                              if (
                                Number(loc.lat).toFixed(5) ===
                                  Number(selectedSuggestion.lat).toFixed(5) &&
                                Number(loc.lon).toFixed(5) ===
                                  Number(selectedSuggestion.lon).toFixed(5)
                              )
                                return false;
                            }
                            if (
                              selectedSuggestion &&
                              locLabel === formatLocationLabel(selectedSuggestion).toLowerCase()
                            )
                              return false;
                            return true;
                          })
                          .map((loc, idx) => (
                            <button
                              key={loc.display_name + idx}
                              type="button"
                              onMouseEnter={(e) =>
                                applyHighlight(
                                  whereHighlightRef,
                                  e.currentTarget.offsetTop,
                                  e.currentTarget.offsetHeight,
                                )
                              }
                              className="relative z-[1] flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors"
                              onClick={() => {
                                const formatted = formatLocationLabel(loc);
                                if (typeof setLocation === 'function') setLocation(formatted);
                                isCommittedSelectionRef.current = true;
                                setIsCommittedSelection(true);
                                setSelectedSuggestion({ ...loc, display_name: formatted });
                                setIsDropdownOpen(false);
                                setActivePanel('when');
                              }}
                            >
                              <span className="inline-block w-5 h-5 text-ink-subtle flex-shrink-0">
                                <svg viewBox="0 0 24 24" fill="none">
                                  <path
                                    d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"
                                    fill="currentColor"
                                  />
                                </svg>
                              </span>
                              <span className="text-[15px] truncate">
                                {highlightMatch(formatLocationLabel(loc), location || '')}
                              </span>
                            </button>
                          ))}
                    </>
                  )}
                {/* Recent searches */}
                {((location || '').trim().length < 2 ||
                  suggestions.length === 0 ||
                  isCommittedSelection) &&
                  recentSearches.length > 0 && (
                    <>
                      <hr className="border-t border-surface-border my-1" />
                      <div className="px-5 pt-2 pb-1 text-[11px] text-ink-subtle font-semibold tracking-widest uppercase">
                        Recent
                      </div>
                      {recentSearches.map((s, idx) => (
                        <div
                          key={s.display_name + idx}
                          onMouseEnter={(e) =>
                            applyHighlight(
                              whereHighlightRef,
                              e.currentTarget.offsetTop,
                              e.currentTarget.offsetHeight,
                            )
                          }
                          className="relative z-[1] flex w-full items-center px-5 py-2.5 transition-colors group"
                        >
                          <button
                            type="button"
                            className="flex items-center flex-1 min-w-0 gap-3"
                            onClick={() => {
                              setSelectedSuggestion(s);
                              isCommittedSelectionRef.current = true;
                              setIsCommittedSelection(true);
                              if (typeof setLocation === 'function')
                                setLocation(formatLocationLabel(s));
                              setIsDropdownOpen(false);
                              setActivePanel('when');
                            }}
                          >
                            <span className="inline-block w-5 h-5 text-ink-subtle flex-shrink-0">
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                viewBox="0 0 24 24"
                                fill="none"
                              >
                                <path
                                  d="M17.01 14h-.8l-.27-.27c.98-1.14 1.57-2.61 1.57-4.23 0-3.59-2.91-6.5-6.5-6.5s-6.5 3-6.5 6.5H2l3.84 4 4.16-4H6.51C6.51 7 8.53 5 11.01 5s4.5 2.01 4.5 4.5c0 2.48-2.02 4.5-4.5 4.5-.65 0-1.26-.14-1.82-.38L7.71 15.1c.97.57 2.09.9 3.3.9 1.61 0 3.08-.59 4.22-1.57l.27.27v.79l5.01 4.99L22 19l-4.99-5z"
                                  fill="currentColor"
                                />
                              </svg>
                            </span>
                            <span className="text-[15px] truncate">
                              {highlightMatch(formatLocationLabel(s), location || '')}
                            </span>
                          </button>
                          <button
                            type="button"
                            aria-label="Remove recent search"
                            tabIndex={-1}
                            className="absolute right-3 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 p-1.5 rounded-full hover:bg-surface-alt transition-opacity"
                            onClick={(e) => {
                              e.stopPropagation();
                              setRecentSearches((prev) => {
                                const updated = prev.filter((_, i) => i !== idx);
                                if (typeof window !== 'undefined')
                                  localStorage.setItem('recentSearches', JSON.stringify(updated));
                                return updated;
                              });
                            }}
                          >
                            <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
                              <path
                                d="M5 5l8 8M13 5l-8 8"
                                stroke="#888"
                                strokeWidth="2"
                                strokeLinecap="round"
                              />
                            </svg>
                          </button>
                        </div>
                      ))}
                    </>
                  )}
              </div>
            )}
          </div>

          {/* WHEN card */}
          <div
            className={`bg-white rounded-md shadow-card transition-all duration-200 overflow-hidden ${
              activePanel === 'when' ? 'ring-2 ring-ink' : 'cursor-pointer'
            }`}
            onClick={() => activePanel !== 'when' && setActivePanel('when')}
          >
            <div className="px-5 pt-4 pb-4">
              <p className="text-[11px] font-bold text-ink uppercase tracking-wider">When?</p>
              {activePanel === 'when' ? (
                <DateRangePanel
                  dateRange={dateRange}
                  setDateRange={setDateRange}
                  rangePickStep={rangePickStep}
                  setRangePickStep={setRangePickStep}
                  hoveredDate={hoveredDate}
                  setHoveredDate={setHoveredDate}
                  calendarBaseMonth={calendarBaseMonth}
                  setCalendarBaseMonth={setCalendarBaseMonth}
                  // Next card in the sheet's cycle. Was 'who' until that segment was removed
                  // (#34) — the chain now runs where → when → what.
                  onClose={() => setActivePanel('what')}
                  listingType={listingType}
                  inline
                />
              ) : (
                <p className="text-[14px] text-ink-muted mt-1">{whenLabel || 'Anytime'}</p>
              )}
            </div>
          </div>

          {/* WHAT card */}
          <div
            className={`bg-white rounded-md shadow-card transition-all duration-200 overflow-hidden ${
              activePanel === 'what' ? 'ring-2 ring-ink' : 'cursor-pointer'
            }`}
            onClick={() => activePanel !== 'what' && setActivePanel('what')}
          >
            <div className="px-5 pt-4 pb-4">
              <p className="text-[11px] font-bold text-ink uppercase tracking-wider">What?</p>
              {activePanel === 'what' ? (
                <div className="mt-3">{renderWhatPanelContent(whatHighlightRef)}</div>
              ) : (
                <p className="text-[14px] text-ink-muted mt-1 flex items-center">
                  {listingType === 'for-rent' ? 'For Rent' : 'For Sale'}
                  {(() => {
                    const n =
                      (selectedPropertyTypes.length > 0 ? 1 : 0) +
                      (bedsIdx > 0 ? 1 : 0) +
                      (baths ? 1 : 0) +
                      (searchMaxPrice > 0 ? 1 : 0) +
                      (description ? 1 : 0);
                    return n > 0 ? (
                      <span className="ml-1.5 inline-flex items-center justify-center h-[18px] px-1.5 rounded-full bg-black/[0.07] text-ink/60 text-[10px] font-semibold leading-none">
                        +{n} {n === 1 ? 'filter' : 'filters'}
                      </span>
                    ) : null;
                  })()}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* ── Bottom bar ───────────────────────────────────────────────── */}
        <div className="flex-shrink-0 flex items-center justify-between px-5 py-4 bg-white border-t border-surface-border shadow-card">
          <button
            onClick={handleClearAll}
            className="text-[14px] font-semibold text-ink underline underline-offset-2"
          >
            Clear all
          </button>
          <button
            onClick={handleSheetSearch}
            className="flex items-center gap-2 h-12 px-7 rounded-full bg-brand text-white font-semibold text-[14px] hover:bg-brand/90 active:scale-95 transition-transform shadow-md"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.5}
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            Search homes
          </button>
        </div>
      </div>
    );
  }

  // --- pill mode: compact 4-slot pill (click to expand) --------------------

  let content: React.ReactNode;

  if (mode === 'pill') {
    content = (
      <div
        {...{ [SHELL_ATTR]: '' }}
        className={`flex w-full items-center rounded-full border border-surface-border bg-white shadow-card overflow-hidden ${
          morphing ? fieldsInClass : ''
        }`}
      >
        {/* Where */}
        <button
          type="button"
          onClick={() => openFromPill('where')}
          aria-label="Where — edit search"
          className="flex-1 flex flex-col justify-center px-4 py-2 text-left min-w-0 hover:bg-surface-alt/60 transition-colors"
        >
          <span className="text-[10px] font-medium text-ink-muted leading-none mb-1 select-none">
            Where
          </span>
          <span
            className={`text-[13px] leading-snug truncate ${location ? 'text-ink font-bold' : 'text-ink-muted'}`}
          >
            {location || 'Anywhere'}
          </span>
        </button>
        <div className="my-auto h-5 w-px flex-shrink-0 bg-[rgba(0,0,0,0.12)]" />
        {/* When */}
        <button
          type="button"
          onClick={() => openFromPill('when')}
          aria-label="When — edit search"
          className="flex flex-col justify-center px-4 py-2 text-left whitespace-nowrap hover:bg-surface-alt/60 transition-colors"
        >
          <span className="text-[10px] font-medium text-ink-muted leading-none mb-1 select-none">
            When
          </span>
          <span
            className={`text-[13px] leading-snug ${dateRange.start ? 'text-ink font-bold' : 'text-ink-muted'}`}
          >
            {dateRange.start ? formatDateRangeLabel(dateRange) : 'Anytime'}
          </span>
        </button>
        <div className="my-auto h-5 w-px flex-shrink-0 bg-[rgba(0,0,0,0.12)]" />
        {/* What */}
        <button
          type="button"
          onClick={() => openFromPill('what')}
          aria-label="What — edit search"
          className="flex flex-col justify-center px-4 py-2 text-left whitespace-nowrap flex-shrink-0 hover:bg-surface-alt/60 transition-colors"
        >
          <span className="text-[10px] font-medium text-ink-muted leading-none mb-1 select-none">
            What
          </span>
          <span className="text-[13px] text-ink font-bold leading-snug flex items-center">
            {listingType === 'for-rent' ? 'For Rent' : 'For Sale'}
            {(() => {
              const n =
                (selectedPropertyTypes.length > 0 ? 1 : 0) +
                (bedsIdx > 0 ? 1 : 0) +
                (baths ? 1 : 0) +
                (searchMaxPrice > 0 ? 1 : 0) +
                (description ? 1 : 0);
              return n > 0 ? (
                <span className="ml-1.5 inline-flex items-center justify-center h-[18px] px-1.5 rounded-full bg-black/[0.07] text-ink/60 text-[10px] font-semibold leading-none whitespace-nowrap">
                  +{n}
                </span>
              ) : null;
            })()}
          </span>
        </button>
        {/* Search icon button — grows back (or expands) the same as a field
            click, then either submits directly (valid location) or lands on
            the 'where' panel already open (handleSearch's existing fallback). */}
        <div className="flex items-center pr-1.5 pl-1">
          <button
            type="button"
            aria-label="Search"
            onClick={() => {
              openFromPill('where');
              handleSearch({ preventDefault: () => {} } as any);
            }}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-brand text-white"
          >
            <svg
              className="h-[15px] w-[15px]"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.5}
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </button>
        </div>
      </div>
    );
  } else if (mode === 'expanded') {
    // --- expanded: full 4-slot bar shown as a dropdown below the header -----
    content = (
      <div className="relative w-full" ref={panelRef}>
        {/* 4-slot pill */}
        <div className="relative flex items-center rounded-full bg-white shadow-card ring-1 ring-surface-border">
          {activePanel && (
            <div
              className={`absolute rounded-full bg-surface-soft pointer-events-none ${SLOT_IN_CLASS}`}
              style={{
                ...(() => {
                  const s = getIndicatorStyle();
                  const left = typeof s.left === 'number' ? s.left + 1 : s.left;
                  const width = typeof s.width === 'number' ? s.width - 2 : s.width;
                  return { ...s, left, width };
                })(),
                top: '1px',
                bottom: '1px',
                transition:
                  'left 0.22s cubic-bezier(0.4,0,0.2,1), width 0.22s cubic-bezier(0.4,0,0.2,1)',
              }}
            />
          )}
          {/* WHERE */}
          <div
            className={`relative w-2/5 lg:w-1/2 shrink-0 min-w-0 ${whereShake ? 'where-shake' : ''}`}
          >
            <button
              ref={whereRef}
              type="button"
              onClick={() => {
                setActivePanel('where');
                setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 50);
              }}
              className={`relative z-[1] w-full flex flex-col justify-center text-left px-3 sm:px-4 py-2.5 sm:py-3.5 rounded-full transition-colors duration-150 min-w-0 focus:outline-none ${
                activePanel !== 'where' ? 'hover:bg-surface-alt/60' : ''
              }`}
            >
              <span className="text-[11px] sm:text-[12px] font-medium text-ink-muted leading-none mb-1">
                Where
              </span>
              <span
                className={`text-[11px] sm:text-[13px] leading-snug truncate pr-5 ${location ? 'text-ink font-bold' : 'text-ink-subtle'}`}
              >
                {isGeolocating ? (
                  <span className="flex items-center gap-1.5 text-ink-muted">
                    <svg
                      className="h-3.5 w-3.5 animate-spin flex-shrink-0"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="2.5"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                      />
                    </svg>
                    Detecting location…
                  </span>
                ) : (
                  location || 'Anywhere'
                )}
              </span>
            </button>
            {location && activePanel === 'where' && (
              <button
                type="button"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  if (typeof setLocation === 'function') setLocation('');
                  setSelectedSuggestion(null);
                  isCommittedSelectionRef.current = false;
                  setIsCommittedSelection(false);
                  setSuggestions([]);
                }}
                className="absolute right-2 top-1/2 z-[2] -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded-full hover:bg-black/[0.08] text-ink/50 hover:text-ink transition-colors"
                aria-label="Clear location"
              >
                <svg
                  className="h-3 w-3"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.5}
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
          <div
            className={`h-6 w-px flex-shrink-0 bg-[rgba(0,0,0,0.12)] transition-opacity ${activePanel === 'where' || activePanel === 'when' ? 'opacity-0' : ''}`}
          />
          {/* WHEN */}
          <button
            ref={whenRef}
            type="button"
            onClick={() => setActivePanel('when')}
            className={`relative z-[1] flex-1 min-w-0 flex flex-col justify-center text-left px-2 sm:px-3 py-2.5 sm:py-3.5 rounded-full transition-colors duration-150 focus:outline-none ${
              activePanel !== 'when' ? 'hover:bg-surface-alt/60' : ''
            }`}
          >
            <span className="text-[11px] sm:text-[12px] font-medium text-ink-muted leading-none mb-1">
              When
            </span>
            <span
              className={`text-[11px] sm:text-[13px] leading-snug truncate ${dateRange.start ? 'text-ink font-bold' : 'text-ink-muted'}`}
            >
              {dateRange.start ? (
                formatDateRangeLabel(dateRange)
              ) : (
                <>
                  <span className="">Add dates</span>
                </>
              )}
            </span>
          </button>
          <div
            className={`hidden md:block h-6 w-px flex-shrink-0 bg-[rgba(0,0,0,0.12)] transition-opacity ${activePanel === 'when' || activePanel === 'what' ? 'opacity-0' : ''}`}
          />
          {/* WHAT — hidden on mobile, visible md+ */}
          <button
            ref={whatRef}
            type="button"
            onClick={() => setActivePanel('what')}
            className={`hidden md:flex relative z-[1] flex-1 min-w-0 flex-col justify-center text-left px-2 md:px-3 py-2.5 md:py-3.5 rounded-full transition-colors duration-150 focus:outline-none ${
              activePanel !== 'what' ? 'hover:bg-surface-alt/60' : ''
            }`}
          >
            <span className="text-[11px] sm:text-[12px] font-medium text-ink-muted leading-none mb-1">
              What
            </span>
            <span className="text-[11px] sm:text-[13px] text-ink font-bold leading-snug truncate">
              {listingType === 'for-rent' ? 'For Rent' : 'For Sale'}
            </span>
          </button>
          {/* Search */}
          <div ref={searchBtnRef} className="flex items-center pr-1.5 pl-1 flex-shrink-0">
            <button
              type="button"
              disabled={isSearching}
              onClick={() => {
                setActivePanel(null);
                handleSearch({ preventDefault: () => {} } as any);
              }}
              className="flex items-center justify-center rounded-full bg-brand text-white shadow-sm transition hover:bg-brand-700 disabled:opacity-80 h-12 w-12 flex-shrink-0"
              aria-label="Search"
            >
              {isSearching ? (
                <svg className="h-4 w-4 sm:h-5 sm:w-5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="2.5"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                  />
                </svg>
              ) : (
                <svg
                  className="h-4 w-4 sm:h-5 sm:w-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.5}
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
              )}
            </button>
          </div>
        </div>

        {/* WHERE panel */}
        {activePanel === 'where' && renderWherePanel(whereHighlightRef)}

        {/* WHEN panel */}
        {activePanel === 'when' && renderWhenPanel()}

        {/* WHAT panel */}
        {activePanel === 'what' && renderWhatPanel(whatHighlightRef)}
      </div>
    );
  } else {
    // --- large: full 4-slot panel bar, in normal page flow (Airbnb style) ---
    // The two wrappers below are intentionally near-empty pass-throughs: the
    // inset/max-width/vertical centering they used to carry now lives on the
    // dock element itself (DOCK_LARGE_CLASS), so every box from the dock down
    // to the pill coincides and the shape animation has nothing oversized to
    // grow from.
    content = (
      <section className="relative">
        <div className="relative">
          <div ref={panelRef} className="relative w-full">
            {/* -- 4-slot pill ------------------------------------------------- */}
            <div
              {...{ [SHELL_ATTR]: '' }}
              className={`relative flex items-center rounded-full bg-white shadow-card ring-1 ring-surface-border ${
                morphing ? fieldsInClass : ''
              }`}
            >
              {activePanel && (
                <div
                  className={`absolute rounded-full bg-surface-soft pointer-events-none ${SLOT_IN_CLASS}`}
                  style={{
                    ...(() => {
                      const s = getIndicatorStyle();
                      const left = typeof s.left === 'number' ? s.left + 1 : s.left;
                      const width = typeof s.width === 'number' ? s.width - 2 : s.width;
                      return { ...s, left, width };
                    })(),
                    top: '1px',
                    bottom: '1px',
                    transition:
                      'left 0.22s cubic-bezier(0.4,0,0.2,1), width 0.22s cubic-bezier(0.4,0,0.2,1)',
                  }}
                />
              )}
              {/* WHERE slot */}
              <div
                className={`relative w-2/5 lg:w-1/2 shrink-0 min-w-0 ${whereShake ? 'where-shake' : ''}`}
              >
                <button
                  ref={whereRef}
                  type="button"
                  onClick={() => {
                    setActivePanel('where');
                    setIsDropdownOpen(true);
                    setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 50);
                  }}
                  className={`relative z-[1] w-full flex flex-col justify-center text-left px-3 sm:px-4 py-2.5 sm:py-3.5 rounded-full transition-colors duration-150 min-w-0 focus:outline-none ${
                    activePanel !== 'where' ? 'hover:bg-surface-alt/60' : ''
                  }`}
                >
                  <span className="text-[11px] sm:text-[12px] font-medium text-ink-muted leading-none mb-1">
                    Where
                  </span>
                  <span
                    className={`text-[11px] sm:text-[13px] leading-snug truncate pr-5 ${location ? 'text-ink font-bold' : 'text-ink-subtle'}`}
                  >
                    {isGeolocating ? (
                      <span className="flex items-center gap-1.5 text-ink-muted">
                        <svg
                          className="h-3.5 w-3.5 animate-spin flex-shrink-0"
                          fill="none"
                          viewBox="0 0 24 24"
                        >
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="2.5"
                          />
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                          />
                        </svg>
                        Detecting location…
                      </span>
                    ) : (
                      location || 'Add locations'
                    )}
                  </span>
                </button>
                {location && activePanel === 'where' && (
                  <button
                    type="button"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (typeof setLocation === 'function') setLocation('');
                      setSelectedSuggestion(null);
                      isCommittedSelectionRef.current = false;
                      setIsCommittedSelection(false);
                      setSuggestions([]);
                    }}
                    className="absolute right-2 top-1/2 z-[2] -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded-full hover:bg-black/[0.08] text-ink/50 hover:text-ink transition-colors"
                    aria-label="Clear location"
                  >
                    <svg
                      className="h-3 w-3"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2.5}
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>

              <div
                className={`h-6 w-px flex-shrink-0 bg-[rgba(0,0,0,0.12)] transition-opacity duration-150 ${activePanel === 'where' || activePanel === 'when' ? 'opacity-0' : ''}`}
              />

              {/* WHEN slot */}
              <button
                ref={whenRef}
                type="button"
                onClick={() => setActivePanel('when')}
                className={`relative z-[1] flex-1 min-w-0 flex flex-col justify-center text-left px-2 sm:px-3 py-2.5 sm:py-3.5 rounded-full transition-colors duration-150 focus:outline-none ${
                  activePanel !== 'when' ? 'hover:bg-surface-alt/60' : ''
                }`}
              >
                <span className="text-[11px] sm:text-[12px] font-medium text-ink-muted leading-none mb-1">
                  When
                </span>
                <span
                  className={`text-[11px] sm:text-[13px] leading-snug truncate ${dateRange.start ? 'text-ink font-bold' : 'text-ink-subtle'}`}
                >
                  {dateRange.start ? (
                    formatDateRangeLabel(dateRange)
                  ) : (
                    <>
                      <span className="">Add dates</span>
                    </>
                  )}
                </span>
              </button>

              <div
                className={`hidden sm:block h-6 w-px flex-shrink-0 bg-[rgba(0,0,0,0.12)] transition-opacity duration-150 ${activePanel === 'when' || activePanel === 'what' ? 'opacity-0' : ''}`}
              />

              {/* WHAT slot — hidden on mobile, visible sm+ */}
              <button
                ref={whatRef}
                type="button"
                onClick={() => setActivePanel('what')}
                className={`hidden sm:flex relative z-[1] flex-1 min-w-0 flex-col justify-center text-left px-2 sm:px-3 py-2.5 sm:py-3.5 rounded-full transition-colors duration-150 focus:outline-none ${
                  activePanel !== 'what' ? 'hover:bg-surface-alt/60' : ''
                }`}
              >
                <span className="text-[11px] sm:text-[12px] font-medium text-ink-muted leading-none mb-1">
                  What
                </span>
                <span className="text-[11px] sm:text-[13px] text-ink font-bold leading-snug truncate flex items-center">
                  {listingType === 'for-rent' ? 'For Rent' : 'For Sale'}
                  {(() => {
                    const n =
                      (selectedPropertyTypes.length > 0 ? 1 : 0) +
                      (bedsIdx > 0 ? 1 : 0) +
                      (baths ? 1 : 0) +
                      (searchMaxPrice > 0 ? 1 : 0) +
                      (description ? 1 : 0);
                    return n > 0 ? (
                      <span className="ml-1.5 inline-flex items-center justify-center h-[18px] px-1.5 rounded-full bg-black/[0.07] text-ink/60 text-[10px] font-semibold leading-none">
                        +{n} {n === 1 ? 'filter' : 'filters'}
                      </span>
                    ) : null;
                  })()}
                </span>
              </button>

              {/* Search button */}
              <div
                ref={searchBtnRef}
                className="relative z-[1] flex items-center pr-1.5 pl-1 flex-shrink-0"
              >
                <button
                  type="button"
                  disabled={isSearching}
                  onClick={() => {
                    setActivePanel(null);
                    handleSearch({ preventDefault: () => {} } as any);
                  }}
                  className="flex items-center justify-center rounded-full bg-brand text-white shadow-sm transition hover:bg-brand-700 disabled:opacity-80 h-12 w-12 flex-shrink-0"
                  aria-label="Search"
                >
                  {isSearching ? (
                    <svg
                      className="h-4 w-4 sm:h-5 sm:w-5 animate-spin"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="2.5"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                      />
                    </svg>
                  ) : (
                    <svg
                      className="h-4 w-4 sm:h-5 sm:w-5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2.5}
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                      />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {/* Panels wait out the morph. Clicking a pill field sets activePanel
                and scrolls to the top, so with the grow no longer delayed the
                panel would otherwise mount mid-flight — inside the bar, and
                therefore inside its transform, growing from 47% scale along with
                it. They open the moment the bar settles instead. */}

            {/* WHERE panel */}
            {activePanel === 'where' && !morphing && renderWherePanel(whereHighlightRef2)}

            {/* WHEN panel */}
            {activePanel === 'when' && !morphing && renderWhenPanel()}

            {/* -- PANEL: WHAT (property criteria) ----------------------------- */}
            {activePanel === 'what' && !morphing && renderWhatPanel(whatHighlightRef2)}
          </div>
        </div>
      </section>
    );
  }

  return (
    <motion.div
      ref={dockRef}
      layout={framerLayout}
      transition={DOCK_TRANSITION}
      style={mode === 'large' ? undefined : DOCK_STYLE[mode]}
      className={`hidden md:block ${mode === 'large' ? DOCK_LARGE_CLASS : ''}`}
      data-search-bar-dock={mode}
    >
      {content}
    </motion.div>
  );
}
