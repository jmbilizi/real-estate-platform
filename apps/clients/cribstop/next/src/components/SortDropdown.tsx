import React, { useRef, useState } from 'react';
import { DropdownContainer } from 'shared-next/src/components';
import type { SearchFilters } from '@/lib/types';

const SORT_OPTIONS: { value: SearchFilters['sort']; label: string }[] = [
  { value: 'recommended', label: 'Recommended' },
  { value: 'newest', label: 'Newest' },
  { value: 'price-asc', label: 'Price: Low → High' },
  { value: 'price-desc', label: 'Price: High → Low' },
];

export default function SortDropdown({
  value,
  onChange,
}: {
  value: SearchFilters['sort'];
  onChange: (v: SearchFilters['sort']) => void;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="bg-white shadow-md rounded-full px-6 py-2 text-base font-semibold border border-surface-border transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 cursor-pointer flex items-center gap-2 text-red-500"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {SORT_OPTIONS.find((o) => o.value === value)?.label}
        <span className="ml-2 text-ink-muted">
          <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
            <path
              d="M6 9l6 6 6-6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>
      {open && (
        <DropdownContainer
          onClose={() => setOpen(false)}
          belowTrigger
          triggerRef={buttonRef}
          style={{ minWidth: buttonRef.current?.offsetWidth || 180 }}
        >
          <ul className="py-2" role="listbox">
            {SORT_OPTIONS.map((option) => (
              <li
                key={option.value}
                role="option"
                aria-selected={option.value === value}
                className={`px-6 py-2 text-base cursor-pointer transition 
                  ${option.value === value ? 'bg-gray-100 font-bold text-red-500' : 'bg-white text-ink'}
                  hover:bg-gray-50`}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                {option.label}
              </li>
            ))}
          </ul>
        </DropdownContainer>
      )}
    </>
  );
}
