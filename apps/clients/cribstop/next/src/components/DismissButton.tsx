import ToolbarIconButton, { CLOSE_ICON } from '@/components/ToolbarIconButton';

interface DismissButtonProps {
  onClick: () => void;
  /** Accessible label. Defaults to "Close". */
  label?: string;
  className?: string;
}

/** The close button of every dialog and panel. It is the shared ToolbarIconButton. */
export default function DismissButton({ onClick, label = 'Close', className }: DismissButtonProps) {
  return (
    <ToolbarIconButton label={label} icon={CLOSE_ICON} onClick={onClick} className={className} />
  );
}
