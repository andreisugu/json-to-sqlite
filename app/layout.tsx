import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'JSON to SQLite Converter',
  description: 'Convert large JSON files to SQLite databases entirely in your browser',
  keywords: ['json', 'sqlite', 'converter', 'browser', 'privacy'],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
