import './globals.css';
import type { Metadata } from 'next';
import { Suspense } from 'react';
import NextTopLoader from 'nextjs-toploader';
import { AppProvider } from '@/lib/context';
import SiteHeader from '@/components/SiteHeader';
import Footer from '@/components/Footer';
import AuthModalListener from '@/components/AuthModalListener';

export const metadata: Metadata = {
  title: 'Cribstop.com – Find Your Next Home',
  description: 'Browse homes for sale and rent in the DMV area. Powered by Real Broker LLC.',
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
          {modal}
        </AppProvider>
      </body>
    </html>
  );
}
