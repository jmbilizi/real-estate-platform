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
      <h3 className="font-display text-base font-bold text-ink">Estimated Monthly Payment</h3>
      <p className="mt-2 font-display text-3xl font-extrabold text-brand-700">
        ${monthly.toLocaleString()}
        <span className="text-base font-normal text-ink-muted">/mo</span>
      </p>
      <div className="mt-3 space-y-1 text-sm text-ink-muted">
        <p>20% down &middot; 6.8% rate &middot; 30-yr fixed</p>
        <p>Down payment: ${downPayment.toLocaleString()}</p>
      </div>
      <p className="mt-3 text-xs text-ink-subtle">This is an estimate only. Contact us for personalized rates.</p>
    </div>
  );
}
