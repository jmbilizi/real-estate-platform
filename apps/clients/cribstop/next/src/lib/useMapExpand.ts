'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** Set on `<html>` while the map is expanded. `globals.css` keys the stacking and scroll rules on it. */
export const MAP_EXPANDED_ATTRIBUTE = 'data-map-expanded';

/**
 * Expanded (full screen) state of the search map (#556).
 *
 * This is a CSS expand, not the Fullscreen API: the map keeps its place in the DOM, so Leaflet
 * keeps its state and nothing remounts when the window resizes. The state lives here, not in the
 * layout, so a resize cannot reset it.
 *
 * Expand pushes one history entry, so Back exits the expanded map instead of leaving the page. An
 * exit by button or Escape pops that entry again, so Back never lands on a dead step. If the push
 * fails, nothing is claimed: Back then behaves as it always does.
 */
export function useMapExpand(container: HTMLElement | null) {
  const [expanded, setExpanded] = useState(false);
  const expandedRef = useRef(false);
  const pushedRef = useRef(false);

  const enter = useCallback(() => {
    if (expandedRef.current) return;
    expandedRef.current = true;
    setExpanded(true);
    try {
      window.history.pushState({ mapExpanded: true }, '', window.location.href);
      pushedRef.current = true;
    } catch {
      pushedRef.current = false;
    }
  }, []);

  const exit = useCallback(() => {
    if (!expandedRef.current) return;
    expandedRef.current = false;
    setExpanded(false);
    if (pushedRef.current) {
      pushedRef.current = false;
      // Pop only the entry that expand pushed. A later entry, such as a listing panel, is not ours.
      if (window.history.state?.mapExpanded) window.history.back();
    }
  }, []);

  useEffect(() => {
    if (!expanded) return;

    const onPopState = () => {
      // The entry that expand pushed is already gone: only the state needs to follow.
      if (!expandedRef.current) return;
      expandedRef.current = false;
      pushedRef.current = false;
      setExpanded(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      // A dialog above the map owns Escape.
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      exit();
    };

    window.addEventListener('popstate', onPopState);
    window.addEventListener('keydown', onKeyDown);
    document.documentElement.setAttribute(MAP_EXPANDED_ATTRIBUTE, '');
    container?.classList.add('fullscreen-map');
    return () => {
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('keydown', onKeyDown);
      document.documentElement.removeAttribute(MAP_EXPANDED_ATTRIBUTE);
      container?.classList.remove('fullscreen-map');
    };
  }, [expanded, container, exit]);

  return { expanded, enter, exit };
}
