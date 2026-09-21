import ResetPasswordForm from '@/components/ResetPasswordForm';

/**
 * A hard-navigation page, not an intercepted modal route: the link in the reset email opens a
 * fresh browser tab, so this must be a real page that renders standalone (#137).
 */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolved = await searchParams;
  const email = typeof resolved.email === 'string' ? resolved.email : null;
  const code = typeof resolved.code === 'string' ? resolved.code : null;

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4 py-16">
      <ResetPasswordForm email={email} code={code} />
    </div>
  );
}
