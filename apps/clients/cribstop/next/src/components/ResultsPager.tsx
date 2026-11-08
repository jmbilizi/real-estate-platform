import type { MouseEvent, ReactNode } from 'react';

/** A plain click goes to the handler. A modified click keeps the browser's own link behavior. */
function isPlainClick(event: MouseEvent): boolean {
  return !(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0);
}

/**
 * The numbered pager under a results list. Shared by the listing grid and the neighborhood grid.
 *
 * With `hrefFor`, each control is a real link (#847). A crawler follows it without running the
 * script, and the click handler still moves the page without a reload.
 */
export default function ResultsPager({
  page,
  pageCount,
  onPage,
  hrefFor,
}: {
  page: number;
  /** The deepest page the pager may offer. */
  pageCount: number;
  onPage: (page: number) => void;
  /** The URL of a page. Omit it and the controls are buttons. */
  hrefFor?: (page: number) => string;
}) {
  if (pageCount <= 1) return null;

  const control = (
    target: number,
    className: string,
    children: ReactNode,
    extra: { disabled?: boolean; label?: string; current?: boolean } = {},
  ) => {
    const aria = {
      'aria-label': extra.label,
      'aria-current': extra.current ? ('page' as const) : undefined,
    };
    if (hrefFor && !extra.disabled) {
      return (
        <a
          key={extra.label ?? target}
          href={hrefFor(target)}
          className={className}
          onClick={(event) => {
            if (!isPlainClick(event)) return;
            event.preventDefault();
            onPage(target);
          }}
          {...aria}
        >
          {children}
        </a>
      );
    }
    return (
      <button
        key={extra.label ?? target}
        className={className}
        onClick={() => onPage(target)}
        disabled={extra.disabled}
        {...aria}
      >
        {children}
      </button>
    );
  };

  return (
    <div className="flex justify-center mt-10">
      <nav
        aria-label="Pagination"
        className="inline-flex items-center gap-1 rounded-full bg-white/90 px-4 py-2 shadow-lg border border-surface-border"
      >
        {control(
          Math.max(1, page - 1),
          'px-3 py-1.5 rounded-full font-semibold text-ink-muted hover:text-ink disabled:opacity-40',
          '<',
          { disabled: page === 1, label: 'Previous page' },
        )}
        {Array.from({ length: pageCount }, (_, i) => i + 1).map((p) =>
          p === 1 || p === pageCount || Math.abs(p - page) <= 2 ? (
            control(
              p,
              `px-3 py-1.5 rounded-full font-semibold transition ${
                p === page ? 'bg-ink text-white shadow' : 'text-ink-muted hover:text-ink'
              }`,
              p,
              { current: p === page },
            )
          ) : (p === page - 3 || p === page + 3) && pageCount > 7 ? (
            <span key={p} className="px-2 text-ink-muted">
              …
            </span>
          ) : null,
        )}
        {control(
          Math.min(pageCount, page + 1),
          'px-3 py-1.5 rounded-full font-semibold text-ink-muted hover:text-ink disabled:opacity-40',
          '>',
          { disabled: page === pageCount, label: 'Next page' },
        )}
      </nav>
    </div>
  );
}
