'use client';

import { useCallback, useEffect, useState } from 'react';

/** Counts whole seconds down to zero. `start(n)` restarts it. `start(0)` stops it. */
export function useCountdown(initialSeconds = 0) {
  const [seconds, setSeconds] = useState(initialSeconds);
  const [run, setRun] = useState(0);

  // The interval restarts only when the countdown starts or stops, not on every tick.
  const running = seconds > 0;
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setSeconds((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [running, run]);

  const start = useCallback((next: number) => {
    setSeconds(Math.max(0, Math.ceil(next)));
    setRun((n) => n + 1);
  }, []);
  return { seconds, start };
}
