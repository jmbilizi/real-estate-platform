import './globals.css';
import type { Metadata } from 'next';
import { Suspense } from 'react';
import NextTopLoader from 'nextjs-toploader';
import { AppProvider } from '@/lib/context';
import SiteHeader from '@/components/SiteHeader';
import Footer from '@/components/Footer';
import AuthModalListener from '@/components/AuthModalListener';
import ListingModalListener from '@/components/ListingModalListener';
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
          <Suspense fallback={null}>
            <ListingModalListener />
          </Suspense>
          <Toast />
          {modal}
        </AppProvider>
      </body>
    </html>
  );
}
