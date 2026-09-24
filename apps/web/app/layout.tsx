import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "asan — engine spike",
  description: "Real-time yoga form feedback. All vision runs on your device.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
