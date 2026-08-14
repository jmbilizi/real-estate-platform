import SearchExperience from '@/components/SearchExperience';

/**
 * The search route.
 *
 * The experience itself lives in `components/SearchExperience` because the standalone listing page
 * renders it too, as the backdrop behind the detail modal — and a route file should not be imported
 * from another route.
 *
 * The filters are read here, on the server, and handed down. They used to be picked up from
 * `window.location.search` in an effect after mount, which meant the first render always searched
 * with *no* filters: loading `/search?q=Alexandria,+VA` fired an unfiltered nationwide query,
 * discarded it a tick later, and fired the real one. Reading them here is also what lets the server
 * render the correct filter count and result state instead of a generic empty one.
 *
 * **There is deliberately no `<Suspense>` around the experience, and adding one back would empty
 * this page again.** A Suspense boundary is a promise to ship its *fallback* in the first HTML and
 * stream the real content in afterwards — so wrapping the whole body in one meant the document went
 * out with a header, a search bar and the words "Loading search…", and every one of this page's
 * pieces (the split layout, the map panel, the card skeletons) waited for the client. Measured with
 * a production build, not just `next dev`: removing the boundary took the first-HTML body from 3,455
 * bytes to 8,985.
 *
 * Nothing here needs a boundary. There is no `useSearchParams()` in the subtree — that is exactly
 * what reading `searchParams` above avoids — and no async work: the results arrive from a client
 * fetch, so the server's job is to render the skeleton state, which it can do synchronously.
 */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolved = await searchParams;

  /*
   * Rebuilt into a query string rather than passed as the object, so the one parser
   * (`parseFiltersFromSearchParams`) stays the only thing that decides what a URL means — including
   * for `amenities`, the one genuinely repeatable parameter.
   */
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(resolved)) {
    if (Array.isArray(value)) value.forEach((entry) => params.append(key, entry));
    else if (value !== undefined) params.append(key, value);
  }

  return <SearchExperience initialQuery={params.toString()} />;
}
