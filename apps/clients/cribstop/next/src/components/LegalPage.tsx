import { BRAND } from '@/lib/brand';
import { formatEffectiveDate, type LegalContent } from '@/lib/legal-content';

/**
 * Server-rendered shell for a legal page (`/privacy`, `/terms`). Copy comes entirely from the
 * `content` prop, a JSON content module under `src/content/legal/` — this component never holds
 * page-specific copy itself, so approved wording from #156 is a content change only.
 */
export default function LegalPage({ content }: { content: LegalContent }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
      {content.isDraft && (
        <div
          role="status"
          className="mb-8 rounded-2xl border-2 border-amber-400 bg-amber-50 p-4 text-sm font-medium text-amber-900"
        >
          Draft — not approved for publication. This page does not state {BRAND.brokerageShort}
          &apos;s actual policy.
        </div>
      )}

      <h1 className="font-display text-3xl font-extrabold sm:text-4xl">{content.title}</h1>
      <p className="mt-2 text-sm text-ink-muted">
        Effective date: {formatEffectiveDate(content.effectiveDate)}
      </p>

      <div className="mt-10 space-y-8">
        {content.sections.map((section) => (
          <section key={section.heading}>
            <h2 className="font-display text-xl font-bold">{section.heading}</h2>
            <div className="mt-3 max-w-prose space-y-3 text-sm leading-relaxed text-ink-muted">
              {section.body.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </div>
          </section>
        ))}
      </div>

      <p className="mt-12 font-medium text-ink">
        Brokered by {BRAND.brokerageShort}. {BRAND.equalHousingOpportunity}.
      </p>
    </div>
  );
}
