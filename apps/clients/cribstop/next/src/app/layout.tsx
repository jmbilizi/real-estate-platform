import './globals.css';
import type { Metadata } from 'next';
import { Suspense } from 'react';
import NextTopLoader from 'nextjs-toploader';
import { AppProvider } from '@/lib/context';
import SiteHeader from '@/components/SiteHeader';
import Footer from '@/components/Footer';
import AuthModalListener from '@/components/AuthModalListener';
import OnboardingListener from '@/components/OnboardingListener';
import Toast from '@/components/Toast';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = {
  title: `${BRAND.brokerage} — ${BRAND.titleSuffix}`,
  description: BRAND.metaDescription,
};

export default function RootLayout({
  children,
  modal,
}: {
  children: React.ReactNode;
  modal: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col">
        <NextTopLoader color="#FF385C" showSpinner={false} height={3} />
        <AppProvider>
          <SiteHeader />
          <main className="flex-1">{children}</main>
          <Footer />
          <Suspense fallback={null}>
            <AuthModalListener />
          </Suspense>
          {/*
           * There is deliberately no listing equivalent of `AuthModalListener` here.
           *
           * Listings used to open via `?listing=<id>` read by a client component in this layout,
           * which meant the modal could not exist until hydration — on a reload it always arrived
           * after the background page had shipped and begun fetching its own data. Listings are a
           * real route now (`/listing/[id]`, intercepted by `@modal/(.)listing/[id]`), so the
           * server renders them and `{modal}` below mounts them.
           */}
          <OnboardingListener />
          <Toast />
          {modal}
        </AppProvider>
      </body>
    </html>
  );
}
