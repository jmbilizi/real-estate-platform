'use client';

import { trackEvent } from './analytics';
import { useImpression } from './useImpression';

/** Where a card sits, for impression and click events (#826). Without it a card sends none. */
export interface CardTrack {
  listType: 'grid' | 'map' | 'favorites' | 'similar';
  rowId: string;
  position: number;
  /** Set only for a ranked home-feed row. */
  feed?: { variant: string; modelVersion: string; explore: boolean };
}

function feedOptions(listingId: string, track: CardTrack, feed: NonNullable<CardTrack['feed']>) {
  return {
    listingId,
    props: {
      row_id: track.rowId,
      position: track.position,
      variant: feed.variant,
      model_version: feed.modelVersion,
      explore: feed.explore,
    },
  };
}

/** The impression ref and the click reporter for one listing card. */
export function useCardTracking(listingId: string, track: CardTrack | undefined) {
  const impressionRef = useImpression<HTMLDivElement>(
    track ? `${track.listType}:${track.rowId}:${listingId}` : null,
    () => {
      if (!track) return;
      trackEvent('listing_impression', {
        listingId,
        props: { row_id: track.rowId, card_position: track.position, list_type: track.listType },
      });
      if (track.feed) trackEvent('feed_impression', feedOptions(listingId, track, track.feed));
    },
  );

  const reportClick = () => {
    if (!track) return;
    trackEvent('listing_click', {
      listingId,
      props: { row_id: track.rowId, card_position: track.position, target: 'card' },
    });
    if (track.feed) trackEvent('feed_click', feedOptions(listingId, track, track.feed));
  };

  return { impressionRef, reportClick };
}
