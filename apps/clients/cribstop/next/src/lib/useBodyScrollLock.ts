'use client';

import { useEffect, useRef } from 'react';

/**
 * Locks page scroll while `locked` is true — the page behind a search dropdown or typeahead must
 * not scroll, or the search bar's scroll-driven dock swap (large/pill/expanded) fires underneath
 * an open panel (#360).
 *
 * `overflow: hidden` alone lets iOS Safari rubber-band-scroll the page anyway, so the body is
 * pinned with `position: fixed` instead (the standard iOS-safe recipe) and restored to its saved
 * scroll position on unlock. A locked body has no scrollbar, so its width is compensated with
 * padding — otherwise removing/restoring the scrollbar shifts the whole page a few pixels.
 *
 * Elements with their own `overflow-y-auto` (the dropdown/panel lists) are unaffected: locking the
 * body does not touch their scroll containers.
 */
export function useBodyScrollLock(locked: boolean) {
  const savedScrollY = useRef(0);

  useEffect(() => {
    if (!locked) return;
    const { body, documentElement } = document;

    savedScrollY.current = window.scrollY;
    const scrollbarWidth = window.innerWidth - documentElement.clientWidth;
    const existingPaddingRight = parseFloat(getComputedStyle(body).paddingRight) || 0;

    const previous = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
      paddingRight: body.style.paddingRight,
    };

    body.style.position = 'fixed';
    body.style.top = `-${savedScrollY.current}px`;
    body.style.left = '0';
    body.style.right = '0';
    body.style.width = '100%';
    if (scrollbarWidth > 0) {
      body.style.paddingRight = `${existingPaddingRight + scrollbarWidth}px`;
    }

    return () => {
      body.style.position = previous.position;
      body.style.top = previous.top;
      body.style.left = previous.left;
      body.style.right = previous.right;
      body.style.width = previous.width;
      body.style.paddingRight = previous.paddingRight;
      // Restoring `position` first, then scrolling: while `position: fixed` the page has no
      // scroll position of its own to restore — jumping to it only works once flow is back.
      window.scrollTo(0, savedScrollY.current);
    };
  }, [locked]);
}
