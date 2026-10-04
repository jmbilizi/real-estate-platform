'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';

/** The page sections the bar can link to, in page order. A link shows only if its id is in the DOM. */
const SECTIONS = [
  { id: 'overview', label: 'Overview' },
  { id: 'facts', label: 'Facts' },
  { id: 'map', label: 'Map' },
  { id: 'history', label: 'History' },
  { id: 'nearby', label: 'Nearby' },
] as const;

/** Gap in px between the bar and a section after a link click. */
const SCROLL_GAP = 12;

/** Fallback for the site header height. `--navbar-h` in `globals.css` is the source. */
const NAVBAR_FALLBACK = 65;

interface Props {
  /** The gallery panel. The bar shows after it scrolls out of view. */
  galleryRef: RefObject<HTMLElement | null>;
  /** The detail root. Section ids are looked up inside it. */
  scopeRef: RefObject<HTMLElement | null>;
  /** The price as the overview shows it. */
  price: ReactNode;
  /** Street line only, or the location when the seller withheld the address. */
  address: string;
  /** Section ids to hide although their element exists (a section still loading). */
  skip?: readonly string[];
  /** The CTA buttons come from the parent, so one place wires them (#132). */
  actions: ReactNode;
}

function navbarHeight(): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--navbar-h');
  return parseInt(raw, 10) || NAVBAR_FALLBACK;
}

/**
 * Desktop sticky bar (#569). Phones never show it: `hidden md:block` keeps it out of the layout and
 * the accessibility tree, and the bottom bar stays their CTA.
 *
 * The zero-height sticky wrapper takes no space, so showing the bar moves nothing and the loading
 * skeleton needs no matching block.
 *
 * Two scroll hosts exist. In the modal the body (`[data-scroll-body]`) scrolls and the bar sticks
 * at the top of the panel. On the property page and the `/listing/[id]` hard load the window
 * scrolls, so the bar sticks under the site header.
 */
export default function ListingStickyBar({
  galleryRef,
  scopeRef,
  price,
  address,
  skip = [],
  actions,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [inDialog, setInDialog] = useState(false);
  const [visible, setVisible] = useState(false);
  const [presentKey, setPresentKey] = useState('');
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    setInDialog(wrapRef.current?.closest('[role="dialog"]') != null);
  }, []);

  const skipKey = skip.join(',');
  // No dependency list on purpose: a section can mount after any render. The state changes only
  // when the set of ids changes.
  useLayoutEffect(() => {
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

  // Visibility: the bar shows after the gallery has left the top of the view.
  useEffect(() => {
    const gallery = galleryRef.current;
    if (!gallery || typeof IntersectionObserver === 'undefined') return;
    const body = scrollBody();
    const observer = new IntersectionObserver(
      ([entry]) =>
        setVisible(
          !entry.isIntersecting && entry.boundingClientRect.top < (entry.rootBounds?.top ?? 0),
        ),
      { root: body, rootMargin: `-${body ? 0 : navbarHeight()}px 0px 0px 0px` },
    );
    observer.observe(gallery);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [galleryRef, inDialog]);

  // Scroll-spy: the first linked section in the band below the bar is the active one.
  useEffect(() => {
    const scope = scopeRef.current;
    if (!scope || !visible || typeof IntersectionObserver === 'undefined') return;
    const ids = linkKey ? linkKey.split(',') : [];
    const inView = new Set<string>();
    const body = scrollBody();
    const barH = barRef.current?.offsetHeight ?? 0;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) inView.add(e.target.id);
          else inView.delete(e.target.id);
        }
        const first = ids.find((id) => inView.has(id));
        if (first) setActive(first);
      },
      { root: body, rootMargin: `-${(body ? 0 : navbarHeight()) + barH}px 0px -55% 0px` },
    );
    for (const id of ids) {
      const el = scope.querySelector(`#${id}`);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeRef, visible, linkKey, inDialog]);

  function scrollToSection(id: string) {
    const target = scopeRef.current?.querySelector(`#${id}`);
    if (!target) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const barH = barRef.current?.offsetHeight ?? 0;
    const body = scrollBody();
    const host: { scrollBy: (o: ScrollToOptions) => void } = body ?? window;
    const hostTop = body ? body.getBoundingClientRect().top : navbarHeight();
    const delta = target.getBoundingClientRect().top - hostTop - barH - SCROLL_GAP;
    host.scrollBy({ top: delta, behavior: reduce ? 'auto' : 'smooth' });
    setActive(id);
  }

  return (
    <div
      ref={wrapRef}
      className="sticky z-20 hidden h-0 md:block"
      style={{ top: inDialog ? 'env(safe-area-inset-top, 0px)' : 'var(--navbar-h, 65px)' }}
      data-testid="listing-sticky-bar-anchor"
    >
      {visible && (
        <div
          ref={barRef}
          data-testid="listing-sticky-bar"
          className="absolute inset-x-0 top-0 border-b border-surface-border bg-white/95 shadow-[0_4px_16px_rgba(0,0,0,0.08)] backdrop-blur-sm"
        >
          <div className="mx-auto flex max-w-7xl items-center gap-4 px-6 py-2.5 sm:px-8">
            <div className="min-w-0 shrink">
              <p className="truncate text-base font-semibold tracking-[-0.18px] text-ink">
                {price}
              </p>
              <p className="truncate text-[13px] text-ink-muted">{address}</p>
            </div>
            {links.length > 0 && (
              <nav aria-label="Listing sections" className="min-w-0 overflow-x-auto">
                <ul className="flex items-center gap-1">
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
            <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div>
          </div>
        </div>
      )}
    </div>
  );
}
