import { CLOSE_ICON } from '@/components/ToolbarIconButton';

interface DismissButtonProps {
  onClick: () => void;
  /** Accessible label. Defaults to "Close". */
  label?: string;
  className?: string;
}

/**
 * The close button of every dialog and panel: a 32px glyph with no border and no fill, a light
 * hover background, and a 44px tap area from the pseudo element.
 */
export default function DismissButton({
  onClick,
  label = 'Close',
  className = '',
}: DismissButtonProps) {
  const position = /\b(absolute|fixed|sticky)\b/.test(className) ? '' : 'relative';
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`${position} inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-ink-muted transition-colors duration-150 before:absolute before:-inset-1.5 before:content-[''] hover:bg-gray-100 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 ${className}`}
    >
      {CLOSE_ICON}
    </button>
  );
}
