import React, { useRef, useState } from 'react';
import { DropdownContainer } from '@/components/DropdownContainer';
import ToolbarIconButton from '@/components/ToolbarIconButton';

export interface ToolbarOption<T extends string> {
  value: T;
  label: string;
}

/**
 * A results-toolbar dropdown behind the shared icon button. The current choice shows as a checkmark
 * in the list and in the button's accessible name, never as button text.
 */
export default function ToolbarSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  icon,
  testId,
  active = false,
}: {
  label: string;
  value: T;
  options: readonly ToolbarOption<T>[];
  onChange: (v: T) => void;
  icon: React.ReactNode;
  testId?: string;
  /** Show the dark look, for a non-default choice. */
  active?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value);

  return (
    <>
      <div ref={wrapperRef}>
        <ToolbarIconButton
          data-testid={testId}
          tooltip={label}
          label={`${label}, current: ${current?.label ?? ''}`}
          icon={icon}
          active={active}
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="listbox"
          aria-expanded={open}
        />
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
