import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Turnstone Village Square",
  description: "Family records, governance and succession, kept in one place.",
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en-GB">
      <body className="antialiased">{children}</body>
    </html>
  );
}
