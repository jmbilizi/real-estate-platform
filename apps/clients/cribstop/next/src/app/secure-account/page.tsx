import type { Metadata } from 'next';
import SecureAccountForm from '@/components/SecureAccountForm';

export const metadata: Metadata = {
  title: 'Secure your account',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

// The token is in the query string, so the page is never static or cached.
export const dynamic = 'force-dynamic';

/**
 * The "This wasn't me" link from a security notice (#662). A hard-navigation page: the notice
 * opens a fresh tab. Loading the page does nothing. The user must press the button, and only a
 * POST uses the token.
 */
export default async function SecureAccountPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolved = await searchParams;
  const token = typeof resolved.token === 'string' ? resolved.token : null;

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4 py-10 sm:py-16">
      <SecureAccountForm token={token} />
    </div>
  );
}
