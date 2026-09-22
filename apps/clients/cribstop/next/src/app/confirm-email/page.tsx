import ConfirmEmailPanel from '@/components/ConfirmEmailPanel';

/**
 * A hard-navigation page, not an intercepted modal route: the link in the confirmation email
 * opens a fresh browser tab, so this must render standalone (#148, mirroring #137's
 * `/reset-password`). The settled path is `/confirm-email` (stakeholder ruling 2026-09-16,
 * recorded on #147/#148) — it must match account-service's `AccountRecovery:ConfirmationPath`.
 */
export default async function ConfirmEmailPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolved = await searchParams;
  const userId = typeof resolved.userId === 'string' ? resolved.userId : null;
  const code = typeof resolved.code === 'string' ? resolved.code : null;

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4 py-16">
      <ConfirmEmailPanel userId={userId} code={code} />
    </div>
  );
}
