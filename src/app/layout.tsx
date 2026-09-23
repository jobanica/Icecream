import type { Metadata, Viewport } from "next";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "Soft-Serve Partners",
  description: "Daily sales, counter checks, remittances, audits and payouts for soft-serve partner stores",
  appleWebApp: { capable: true, title: "Soft-Serve" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#e11d48",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-muted/40 antialiased">
        {children}
        <Toaster position="top-center" richColors />
      </body>
    </html>
  );
}
