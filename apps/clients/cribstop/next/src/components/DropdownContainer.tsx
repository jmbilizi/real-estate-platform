'use client';

import React, { useEffect, useRef } from 'react';

interface DropdownContainerProps {
  onClose: () => void;
  belowTrigger?: boolean;
  triggerRef: React.RefObject<HTMLElement | null>;
  style?: React.CSSProperties;
  children: React.ReactNode;
}

export function DropdownContainer({
  onClose,
  belowTrigger: _belowTrigger,
  triggerRef,
  style,
  children,
}: DropdownContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Calculate position based on trigger
  const rect = triggerRef.current?.getBoundingClientRect();
  const top = rect ? rect.bottom + window.scrollY + 6 : 0;
  const left = rect ? rect.left + window.scrollX : 0;

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node) &&
        !triggerRef.current?.contains(e.target as Node)
      ) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose, triggerRef]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div
      ref={containerRef}
      style={{ position: 'absolute', top, left, zIndex: 50, ...style }}
      className="bg-white rounded-2xl shadow-xl border border-surface-border overflow-hidden"
    >
      {children}
    </div>
  );
}
