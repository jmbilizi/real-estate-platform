import React, { useRef, useState } from 'react';
import { DropdownContainer } from '@/components/DropdownContainer';
import type { SearchFilters } from '@/lib/types';

const SORT_OPTIONS: { value: SearchFilters['sort']; label: string }[] = [
  { value: 'recommended', label: 'Recommended' },
  { value: 'price-desc', label: 'Highest price' },
  { value: 'price-asc', label: 'Lowest price' },
  { value: 'newest', label: 'Newest' },
];

export default function SortDropdown({
  value,
  onChange,
}: {
  value: SearchFilters['sort'];
  onChange: (v: SearchFilters['sort']) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  return (
    <>
      <div ref={wrapperRef}>
        <button
          type="button"
          className="bg-transparent px-0 py-0.5 text-sm font-semibold transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 cursor-pointer text-red-500 flex items-center gap-1.5"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <svg
            width="20"
            height="22"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="shrink-0 text-ink-muted self-center"
            aria-hidden="true"
          >
            <path d="m3 18 4 4 4-4" />
            <path d="M7 22V2" />
            <path d="m21 6-4-4-4 4" />
            <path d="M17 2v20" />
          </svg>
          <span className="border-b border-ink">
            {SORT_OPTIONS.find((o) => o.value === value)?.label}
          </span>
        </button>
      </div>
      {open && (
        <DropdownContainer
          onClose={() => setOpen(false)}
          belowTrigger
          alignRight
          triggerRef={wrapperRef}
          style={{ minWidth: wrapperRef.current?.offsetWidth || 180 }}
        >
          <ul className="py-2" role="listbox">
            {SORT_OPTIONS.map((option) => (
              <li
                key={option.value}
                role="option"
                aria-selected={option.value === value}
                className={`flex items-center justify-between px-5 py-3 text-sm cursor-pointer transition text-ink hover:bg-gray-50 ${option.value === value ? 'bg-gray-100 font-semibold' : ''}`}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                <span>{option.label}</span>
                {option.value === value && (
                  <svg
                    width="16"
                    height="16"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-ink ml-4 shrink-0"
                  >
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                )}
              </li>
            ))}
          </ul>
        </DropdownContainer>
      )}
    </>
  );
}
