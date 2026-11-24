'use client';

import { useEffect, useId, useRef, useState } from 'react';

/**
 * A paragraph that shows five lines, then "…more" when the text is longer. The check measures the
 * rendered box, so a short text never gets the button, at any width.
 */
export default function ExpandableText({
  text,
  className = '',
}: {
  text: string;
  className?: string;
}) {
  const ref = useRef<HTMLParagraphElement>(null);
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || expanded) return;
    const measure = () => setOverflows(el.scrollHeight > el.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text, expanded]);

  return (
    <>
      <p ref={ref} id={id} className={`${expanded ? '' : 'line-clamp-5'} ${className}`}>
        {text}
      </p>
      {overflows && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setExpanded((v) => !v)}
          className="-ml-2 mt-1 inline-flex min-h-11 items-center rounded-full px-2 text-[15px] font-semibold text-brand-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          {expanded ? 'Show less' : '…more'}
        </button>
      )}
    </>
  );
}
