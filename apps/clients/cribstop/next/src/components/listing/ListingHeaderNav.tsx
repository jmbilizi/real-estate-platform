'use client';

import { useEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';

/** The page sections the nav can link to, in page order. A link shows only if its id is in the DOM. */
const SECTIONS = [
  { id: 'overview', label: 'Overview' },
  { id: 'facts', label: 'Facts' },
  { id: 'map', label: 'Map' },
  { id: 'history', label: 'History' },
  { id: 'nearby', label: 'Nearby' },
] as const;

/** Gap in px between the header and a section after a link click. */
const SCROLL_GAP = 12;

/** Quiet time in ms after the last scroll event before the scroll-spy resumes. */
const SETTLE_MS = 150;

/** Fallback for the site header height. `--navbar-h` in `globals.css` is the source. */
const NAVBAR_FALLBACK = 65;

interface Props {
  /** The detail header. Its height is the scroll offset when the window scrolls. */
  headerRef: RefObject<HTMLElement | null>;
  /** The detail root. Section ids are looked up inside it. */
  scopeRef: RefObject<HTMLElement | null>;
  /** The price as the overview shows it. */
  price: ReactNode;
  /** Street line only, or the location when the seller withheld the address. */
  address: string;
  /** Section ids to hide although their element exists (a section still loading). */
  skip?: readonly string[];
}

function navbarHeight(): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--navbar-h');
  return parseInt(raw, 10) || NAVBAR_FALLBACK;
}

/**
 * Desktop price, address and section links for the detail header (#594, replaces the sticky bar of
 * #569). Phones never show it: `hidden md:flex` keeps it out of the layout and the accessibility
 * tree, and the header stays back, Share and Save there.
 *
 * Two scroll hosts exist. In the modal the body (`[data-scroll-body]`) scrolls below the header, so
 * the header covers nothing and the offset is the gap alone. On the property page and the
 * `/listing/[id]` hard load the window scrolls and the header sticks under the site header, so the
 * offset adds both heights.
 *
 * The links hide by container width (`.listing-header-nav` in `globals.css`), before the price or
 * the address squeeze.
 */
export default function ListingHeaderNav({
  headerRef,
  scopeRef,
  price,
  address,
  skip = [],
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [inDialog, setInDialog] = useState(false);
  const [presentKey, setPresentKey] = useState('');
  const [active, setActive] = useState<string | null>(null);
  /** True while a link-click scroll runs. The scroll-spy must not overwrite the clicked link then. */
  const spyLocked = useRef(false);
  const unlockSpy = useRef<(() => void) | null>(null);
  useEffect(() => () => unlockSpy.current?.(), []);

  useEffect(() => {
    setInDialog(wrapRef.current?.closest('[role="dialog"]') != null);
  }, []);

  const skipKey = skip.join(',');
  // No dependency list on purpose: a section can mount after any render. The state changes only
  // when the set of ids changes.
  useEffect(() => {
    const scope = scopeRef.current;
    if (!scope) return;
    const skipped = skipKey.split(',');
    const key = SECTIONS.filter(
      (s) => !skipped.includes(s.id) && scope.querySelector(`#${s.id}`) !== null,
    )
      .map((s) => s.id)
      .join(',');
    setPresentKey(key);
  });

  const links = SECTIONS.filter((s) => presentKey.split(',').includes(s.id));
  const linkKey = links.map((s) => s.id).join(',');

  /** The modal body, or null when the window scrolls. */
  const scrollBody = () =>
    inDialog ? (scopeRef.current?.querySelector<HTMLElement>('[data-scroll-body]') ?? null) : null;

  /** Px of the scroll host's top edge that the header covers. Zero in the modal. */
  const coveredTop = (body: HTMLElement | null) =>
    body ? 0 : navbarHeight() + (headerRef.current?.offsetHeight ?? 0);

  // Scroll-spy: the first linked section in the band below the header is the active one.
  useEffect(() => {
    const scope = scopeRef.current;
    if (!scope || typeof IntersectionObserver === 'undefined') return;
    const ids = linkKey ? linkKey.split(',') : [];
    const inView = new Set<string>();
    const body = scrollBody();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) inView.add(e.target.id);
          else inView.delete(e.target.id);
        }
        if (spyLocked.current) return;
        const first = ids.find((id) => inView.has(id));
        if (first) setActive(first);
      },
      { root: body, rootMargin: `-${coveredTop(body)}px 0px -55% 0px` },
    );
    for (const id of ids) {
      const el = scope.querySelector(`#${id}`);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeRef, linkKey, inDialog]);

  function scrollToSection(id: string) {
    const target = scopeRef.current?.querySelector(`#${id}`);
    if (!target) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const body = scrollBody();
    const host: { scrollBy: (o: ScrollToOptions) => void } = body ?? window;
    const hostTop = body ? body.getBoundingClientRect().top : 0;
    const delta = target.getBoundingClientRect().top - hostTop - coveredTop(body) - SCROLL_GAP;
    // The clicked link is active at once and stays so until the scroll settles. A smooth scroll
    // crosses other sections, and a section near the page end may never reach the active band.
    setActive(id);
    lockSpyUntilScrollSettles(body ?? window);
    host.scrollBy({ top: delta, behavior: reduce ? 'auto' : 'smooth' });
  }

  function lockSpyUntilScrollSettles(target: HTMLElement | Window) {
    unlockSpy.current?.();
    spyLocked.current = true;
    let timer: ReturnType<typeof setTimeout>;
    const release = () => {
      clearTimeout(timer);
      target.removeEventListener('scroll', rearm);
      spyLocked.current = false;
      unlockSpy.current = null;
    };
    const rearm = () => {
      clearTimeout(timer);
      timer = setTimeout(release, SETTLE_MS);
    };
    target.addEventListener('scroll', rearm, { passive: true });
    unlockSpy.current = release;
    rearm();
  }

  return (
    <div
      ref={wrapRef}
      data-testid="listing-header-nav"
      className="hidden min-w-0 flex-1 items-center gap-5 md:flex"
    >
      <div className="min-w-0 max-w-[20rem] shrink">
        <p className="truncate text-[17px] font-semibold leading-6 tracking-[-0.18px] text-ink">
          {price}
        </p>
        <p className="truncate text-[13px] leading-4 text-ink-muted">{address}</p>
      </div>
      {links.length > 0 && (
        <nav
          aria-label="Listing sections"
          className="listing-header-nav shrink-0 border-l border-surface-border pl-4"
        >
          <ul className="flex items-center gap-0.5">
            {links.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => scrollToSection(s.id)}
                  aria-current={active === s.id ? 'true' : undefined}
                  className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                    active === s.id
                      ? 'bg-surface-alt text-ink'
                      : 'text-ink-muted hover:bg-surface-soft hover:text-ink'
                  }`}
                >
                  {s.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  );
}
