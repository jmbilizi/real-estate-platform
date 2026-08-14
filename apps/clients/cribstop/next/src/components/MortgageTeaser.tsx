export default function MortgageTeaser({ price }: { price: number }) {
  const downPayment = price * 0.2;
  const loan = price - downPayment;
  const monthlyRate = 0.068 / 12;
  const n = 30 * 12;
  const monthly = Math.round(
    (loan * (monthlyRate * Math.pow(1 + monthlyRate, n))) / (Math.pow(1 + monthlyRate, n) - 1),
  );

  return (
    <div className="rounded-2xl border border-surface-border bg-brand-50/50 p-6">
      {/* `title-md` (16px/600) per DESIGN.md. */}
      <h3 className="text-base font-semibold text-ink">Estimated monthly payment</h3>
      {/*
       * `display-sm` (20px/600, -0.18px) — the same style the listing price uses, deliberately.
       * This was 30px/800: a size and a weight the design system does not define, on a figure
       * derived from a guessed 6.8% rate.
       *
       * The tracking matters as much as the size here: the price carried `tracking-tight`
       * (-0.5px) and this carried none, so at identical size and weight the two figures still had
       * visibly different letterforms. -0.18px is the spec value for `display-sm`; neither was it.
       */}
      <p className="mt-2 text-xl font-semibold tracking-[-0.18px] text-brand-700">
        ${monthly.toLocaleString()}
        <span className="text-sm font-normal text-ink-muted"> / month</span>
      </p>
      <div className="mt-3 space-y-1 text-sm text-ink-muted">
        <p>20% down &middot; 6.8% rate &middot; 30-yr fixed</p>
        <p>Down payment: ${downPayment.toLocaleString()}</p>
      </div>
      <p className="mt-3 text-xs text-ink-subtle">
        This is an estimate only. Contact us for personalized rates.
      </p>
    </div>
  );
}
