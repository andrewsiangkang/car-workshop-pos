import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Workshop POS System",
  description: "Professional car workshop POS and management system",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased bg-slate-50 text-slate-900">
        {children}
      </body>
    </html>
  );
}
