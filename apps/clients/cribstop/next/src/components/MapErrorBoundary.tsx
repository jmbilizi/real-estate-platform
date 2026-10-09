'use client';

import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

/** A map failure must not blank the page. Results and filters stay usable beside this panel. */
export default class MapErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error('Map failed to render', error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div
        role="status"
        className="flex h-full w-full items-center justify-center bg-surface-soft p-4 text-center text-sm font-semibold text-ink-subtle"
      >
        Map unavailable
      </div>
    );
  }
}
