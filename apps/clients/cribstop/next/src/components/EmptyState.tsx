'use client';

import { ReactNode } from 'react';
import { Home, MapPin, RefreshCw, Search } from 'lucide-react';
import Button from './Button';

interface EmptyStateProps {
  /**
   * Variant determines the icon and default messaging.
   * @default 'search'
   */
  variant?: 'search' | 'error' | 'location' | 'generic' | 'failed';
  /** Override the default title */
  title?: string;
  /** Override the default description (set to false to hide completely) */
  description?: string | false;
  /** Custom action element (defaults to a retry button for error/failed variants) */
  action?: ReactNode;
  /** Callback for retry action on error/failed variants */
  onRetry?: () => void;
  /** Compact mode for inline use (smaller padding, smaller icon) */
  compact?: boolean;
}

/**
 * Friendly empty states with floating illustrations and clear CTAs.
 *
 * Loading failures are handled gracefully rather than silently hiding content.
 * The floating icon animation adds playfulness without being distracting.
 */
export default function EmptyState({
  variant = 'search',
  title,
  description,
  action,
  onRetry,
  compact = false,
}: EmptyStateProps) {
  const config = {
    search: {
      icon: Search,
      defaultTitle: 'No results found',
      defaultDescription: 'Try adjusting your filters or search in a different area.',
    },
    error: {
      icon: Home,
      defaultTitle: 'Could not load homes',
      defaultDescription: 'Something went wrong while fetching listings. Give it another try.',
      showRetry: true,
    },
    failed: {
      icon: RefreshCw,
      defaultTitle: 'Failed to load',
      defaultDescription: 'This section could not be loaded.',
      showRetry: true,
    },
    location: {
      icon: MapPin,
      defaultTitle: 'Set your location',
      defaultDescription: 'Enter a city, neighborhood, or ZIP code to find homes near you.',
    },
    generic: {
      icon: Home,
      defaultTitle: 'Nothing here yet',
      // Not "check back later" — that promises inventory is coming, which this component
      // cannot know. States only what is true now: this view has no matching listings.
      defaultDescription: 'No listings match this view.',
    },
  }[variant];

  const Icon = config.icon;
  const showRetry = 'showRetry' in config && config.showRetry;

  if (compact) {
    return (
      <div className="flex flex-col items-center justify-center py-6 text-center">
        <div className="mb-3 animate-float-slow rounded-full bg-surface-alt p-2">
          <Icon className="h-5 w-5 text-ink-muted" />
        </div>
        <p className="text-sm font-medium text-ink">{title || config.defaultTitle}</p>
        {description !== false && (
          <p className="mt-1 max-w-[240px] text-xs text-ink-muted">
            {description || config.defaultDescription}
          </p>
        )}
        {(showRetry || action) && (
          <div className="mt-3">
            {action ||
              (onRetry && (
                <Button variant="secondary" size="sm" onClick={onRetry}>
                  Try again
                </Button>
              ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-12 text-center sm:py-16">
      {/* Floating illustration */}
      <div className="relative mb-6">
        <div className="animate-float-slow rounded-full bg-gradient-to-br from-brand/10 to-accent-deep/10 p-6">
          <Icon className="h-10 w-10 text-brand sm:h-12 sm:w-12" strokeWidth={1.5} />
        </div>
        {/* Decorative dots */}
        <div className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-brand/20" />
        <div className="absolute -bottom-1 -left-2 h-2 w-2 rounded-full bg-accent-deep/20" />
      </div>

      {/* Content */}
      <h3 className="text-lg font-semibold text-ink sm:text-xl">{title || config.defaultTitle}</h3>
      {description !== false && (
        <p className="mt-2 max-w-[320px] text-sm leading-relaxed text-ink-muted sm:text-base">
          {description || config.defaultDescription}
        </p>
      )}

      {/* Action */}
      {(showRetry || action) && (
        <div className="mt-6">
          {action || (onRetry && <Button onClick={onRetry}>Try again</Button>)}
        </div>
      )}
    </div>
  );
}

/**
 * Empty state row for carousel failures — fits inline in the grid layout.
 */
export function EmptyStateCard({
  variant = 'failed',
  onRetry,
}: {
  variant?: 'failed' | 'error';
  onRetry?: () => void;
}) {
  const config = {
    failed: {
      icon: RefreshCw,
      title: 'Failed to load',
    },
    error: {
      icon: Home,
      title: 'Unavailable',
    },
  }[variant];

  const Icon = config.icon;

  return (
    <div className="flex h-full min-h-[280px] flex-col items-center justify-center rounded-md border border-dashed border-surface-border bg-surface-alt/50 p-4 text-center">
      <div className="animate-float-slow mb-3 rounded-full bg-surface-soft p-3">
        <Icon className="h-6 w-6 text-ink-subtle" strokeWidth={1.5} />
      </div>
      <p className="text-sm font-medium text-ink">{config.title}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-2 text-xs text-brand hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
        >
          Tap to retry
        </button>
      )}
    </div>
  );
}
