/** The numbered pager under a results list. Shared by the listing grid and the neighborhood grid. */
export default function ResultsPager({
  page,
  pageCount,
  onPage,
}: {
  page: number;
  /** The deepest page the pager may offer. */
  pageCount: number;
  onPage: (page: number) => void;
}) {
  if (pageCount <= 1) return null;
  return (
    <div className="flex justify-center mt-10">
      <nav className="inline-flex items-center gap-1 rounded-full bg-white/90 px-4 py-2 shadow-lg border border-surface-border">
        <button
          className="px-3 py-1.5 rounded-full font-semibold text-ink-muted hover:text-ink disabled:opacity-40"
          onClick={() => onPage(Math.max(1, page - 1))}
          disabled={page === 1}
          aria-label="Previous page"
        >
          &lt;
        </button>
        {Array.from({ length: pageCount }, (_, i) => i + 1).map((p) =>
          p === 1 || p === pageCount || Math.abs(p - page) <= 2 ? (
            <button
              key={p}
              className={`px-3 py-1.5 rounded-full font-semibold transition ${
                p === page ? 'bg-ink text-white shadow' : 'text-ink-muted hover:text-ink'
              }`}
              onClick={() => onPage(p)}
              aria-current={p === page ? 'page' : undefined}
            >
              {p}
            </button>
          ) : (p === page - 3 || p === page + 3) && pageCount > 7 ? (
            <span key={p} className="px-2 text-ink-muted">
              …
            </span>
          ) : null,
        )}
        <button
          className="px-3 py-1.5 rounded-full font-semibold text-ink-muted hover:text-ink disabled:opacity-40"
          onClick={() => onPage(Math.min(pageCount, page + 1))}
          disabled={page === pageCount}
          aria-label="Next page"
        >
          &gt;
        </button>
      </nav>
    </div>
  );
}
