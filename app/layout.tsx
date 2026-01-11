import type { Metadata, Viewport } from 'next';
import './globals.css';
import ServiceWorkerRegistration from './ServiceWorkerRegistration';

export const metadata: Metadata = {
  title: 'JSON to SQLite Converter',
  description: 'Convert large JSON files to SQLite databases entirely in your browser',
  keywords: ['json', 'sqlite', 'converter', 'browser', 'privacy'],
  manifest: '/json-to-sqlite/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'JSON2SQLite',
  },
};

export const viewport: Viewport = {
  themeColor: '#7c3aed',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <ServiceWorkerRegistration />
        {children}
      </body>
    </html>
  );
}
