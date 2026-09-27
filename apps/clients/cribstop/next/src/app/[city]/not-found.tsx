import Link from 'next/link';

/** An unknown place or address under `/<city>-<st>/...` (#349, #350). Never an unfiltered search. */
export default function PlaceNotFound() {
  return (
    <div className="mx-auto max-w-lg px-6 py-16 text-center">
      <h1 className="text-xl font-semibold tracking-tight text-ink">Place not found</h1>
      <p className="mt-2 text-sm text-ink-muted">
        We could not find this place or address. Check the spelling, or search again.
      </p>
      <Link href="/" className="btn-primary mt-6 inline-flex">
        Search homes
      </Link>
    </div>
  );
}
