import React from 'react';

export default function FilterButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children?: React.ReactNode;
}) {
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onClick();
      }}
      aria-label="Filters"
      className="relative inline-flex items-center justify-center rounded-full transition duration-200 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-brand"
      style={{ width: '2.5rem', height: '2.5rem' }}
    >
      <svg
        className="h-7 w-7 text-gray-500 transition-colors duration-200 hover:text-brand"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.4}
        viewBox="0 0 24 24"
      >
        <circle cx="17" cy="7" r="2" />
        <circle cx="7" cy="12" r="2" />
        <circle cx="17" cy="17" r="2" />
        <line x1="3" y1="7" x2="15" y2="7" />
        <line x1="9" y1="12" x2="21" y2="12" />
        <line x1="3" y1="17" x2="15" y2="17" />
      </svg>
      {children}
    </span>
  );
}
