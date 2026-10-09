/**
 * #755. Callers that ask for the same read at the same moment share one database query.
 *
 * It holds a result only while the query runs, so it adds no staleness. A home page load fires the
 * same dozen reads for every visitor. Without this, ten visitors in one second run 120 queries.
 * With it, they run 12.
 *
 * A rejection reaches every waiting caller, then the key clears so the next call retries.
 */
export type SingleFlight = <T>(key: string, run: () => Promise<T>) => Promise<T>;

export function createSingleFlight(): SingleFlight {
  const inFlight = new Map<string, Promise<unknown>>();

  return <T>(key: string, run: () => Promise<T>): Promise<T> => {
    const existing = inFlight.get(key);
    if (existing !== undefined) {
      return existing as Promise<T>;
    }
    const started = run().finally(() => {
      inFlight.delete(key);
    });
    inFlight.set(key, started);
    return started;
  };
}
