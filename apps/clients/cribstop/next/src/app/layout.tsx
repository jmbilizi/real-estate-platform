import "./globals.css";
import type { Metadata } from "next";
import { Suspense } from "react";
import { AppProvider } from "@/lib/context";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import AuthModalListener from "@/components/AuthModalListener";

export const metadata: Metadata = {
  title: "Cribstop.com – Find Your Next Home",
  description: "Browse homes for sale and rent in the DMV area. Powered by Real Broker LLC.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col">
        <AppProvider>
          <Header />
          <main className="flex-1">{children}</main>
          <Footer />
          <Suspense fallback={null}>
            <AuthModalListener />
          </Suspense>
        </AppProvider>
      </body>
    </html>
  );
}
