import React, { useRef, useState } from 'react';
import { DropdownContainer } from '@/components/DropdownContainer';

export interface ToolbarOption<T extends string> {
  value: T;
  label: string;
}

/** The one button style for Filters, Group by and Sort in the results toolbar (#502). */
export const TOOLBAR_BUTTON_CLASS =
  'min-h-11 min-w-11 justify-center bg-transparent px-2 py-0.5 text-sm font-semibold transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 cursor-pointer text-ink flex items-center gap-1.5';

/** The visible label of a toolbar button. Below `sm` only the icon shows. */
export const TOOLBAR_LABEL_CLASS = 'hidden sm:inline';

/**
 * A results-toolbar dropdown. The button shows a fixed label (from `sm` up) and an icon. The current
 * choice shows as a checkmark in the list and in the button's accessible name, never as button text.
 */
export default function ToolbarSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  icon,
  testId,
}: {
  label: string;
  value: T;
  options: readonly ToolbarOption<T>[];
  onChange: (v: T) => void;
  icon: React.ReactNode;
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
          aria-label={`${label}, current: ${current?.label ?? ''}`}
          className={TOOLBAR_BUTTON_CLASS}
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <span className="shrink-0 text-ink-muted self-center" aria-hidden="true">
            {icon}
          </span>
          <span className={TOOLBAR_LABEL_CLASS}>{label}</span>
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
                    aria-hidden="true"
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
