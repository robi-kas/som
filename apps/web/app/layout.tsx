import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: { default: 'New Chapter POS', template: '%s · New Chapter POS' },
  description: 'Point of sale, kitchen display and back office for New Chapter cafe',
  applicationName: 'New Chapter POS',
  // A private staff app: never show it in Google (see also app/robots.ts).
  robots: { index: false, follow: false, nocache: true },
  formatDetection: { telephone: false },
  manifest: '/manifest.webmanifest',
  icons: { icon: [{ url: '/icon.svg', type: 'image/svg+xml' }, { url: '/icon-512.png', sizes: '512x512', type: 'image/png' }], apple: '/icon-512.png' },
  appleWebApp: { capable: true, title: 'New Chapter POS', statusBarStyle: 'black-translucent' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0e0f0c',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Fonts: Archivo (display), IBM Plex (text), Noto Sans Ethiopic (Amharic). System fonts are the fallback when offline. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Archivo:wght@600;700;800;900&family=IBM+Plex+Mono:wght@500&family=IBM+Plex+Sans:wght@400;500;600;700&family=Noto+Sans+Ethiopic:wght@400;600;700&display=swap"
        />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
