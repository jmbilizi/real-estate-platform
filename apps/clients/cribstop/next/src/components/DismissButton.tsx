interface DismissButtonProps {
  onClick: () => void;
  /** Accessible label. Defaults to "Close". */
  label?: string;
  className?: string;
}

/**
 * Reusable dismiss / close button.
 * Matches the close button style used in Modal / AuthForm.
 */
export default function DismissButton({ onClick, label = 'Close', className }: DismissButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={[
        'flex items-center justify-center w-9 h-9 rounded-full',
        'text-gray-600 hover:bg-gray-100',
        'transition-colors duration-150',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-ink/30',
        className ?? '',
      ]
        .join(' ')
        .trim()}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </button>
  );
}
