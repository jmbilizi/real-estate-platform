import React, { useRef, useState } from 'react';
import { DropdownContainer } from '@/components/DropdownContainer';

export interface ToolbarOption<T extends string> {
  value: T;
  label: string;
}

/**
 * A results-toolbar dropdown (#502). Same look and behavior as `SortDropdown`: a 44px button with a
 * leading icon and a listbox beneath it. `label` names the control for screen readers.
 */
export default function ToolbarSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  icon,
  prefix,
  testId,
}: {
  label: string;
  value: T;
  options: readonly ToolbarOption<T>[];
  onChange: (v: T) => void;
  icon: React.ReactNode;
  /** Visible text before the current value, for example "Group by:". */
  prefix?: string;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value);

  return (
    <>
      <div ref={wrapperRef}>
        <button
          type="button"
          data-testid={testId}
          aria-label={`${label}: ${current?.label ?? ''}`}
          className="min-h-11 bg-transparent px-2 py-0.5 text-sm font-semibold transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 cursor-pointer text-ink flex items-center gap-1.5"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <span className="shrink-0 text-ink-muted self-center" aria-hidden="true">
            {icon}
          </span>
          <span className="border-b border-ink">
            {prefix ? `${prefix} ` : null}
            {current?.label}
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
          <ul className="py-2" role="listbox" aria-label={label}>
            {options.map((option) => (
              <li
                key={option.value}
                role="option"
                aria-selected={option.value === value}
                className={`flex min-h-11 items-center justify-between px-5 py-3 text-sm cursor-pointer transition text-ink hover:bg-gray-50 ${option.value === value ? 'bg-gray-100 font-semibold' : ''}`}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                <span>{option.label}</span>
              </li>
            ))}
          </ul>
        </DropdownContainer>
      )}
    </>
  );
}
