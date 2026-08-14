import './globals.css';
import type { Metadata } from 'next';
import { Suspense } from 'react';
import NextTopLoader from 'nextjs-toploader';
import { AppProvider } from '@/lib/context';
import SiteHeader from '@/components/SiteHeader';
import Footer from '@/components/Footer';
import AuthModalListener from '@/components/AuthModalListener';
import ListingPanelHost from '@/components/listing/ListingPanelHost';
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
           * The listing panel mounts here, and deliberately not as a route.
           *
           * It has been both other things. It was `?listing=<id>` read by a client component in
           * this layout, which could not exist until hydration. Then it was a real route
           * (`/listing/[id]`) intercepted by `@modal/(.)listing/[id]`, which fixed reloads but made
           * *opening* a listing wait on an RSC payload and a chunk — measured at 519ms of nothing
           * after the click, on a page whose data the panel did not even use.
           *
           * Both entry paths are now served by the thing that suits each. A **hard** load of
           * `/listing/[id]` is still a route, still resolved on the server, so the listing is in the
           * first HTML. A **soft** open is client state (`lib/listing-panel`) rendered by the host
           * below, so it paints on the click. `ListingPanelHost` renders null until something opens
           * a listing, so this costs nothing on every other page.
           *
           * `AuthModalListener` and `{modal}` are unaffected: `@modal` still carries login/signup.
           */}
          <ListingPanelHost />
          <OnboardingListener />
          <Toast />
          {modal}
        </AppProvider>
      </body>
    </html>
  );
}
