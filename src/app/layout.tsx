import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import '@/styles/globals.css';

const inter = Inter({
  subsets: ['latin', 'latin-ext'],
  display: 'swap',
  variable: '--font-sans',
});

export const metadata: Metadata = {
  metadataBase: new URL('https://analytics.motolia.pl'),
  title: 'Motolia Analytics — GA4 Dashboard',
  description: 'Premium analytics dashboard for Motolia — real-time GA4 data, TV spot overlay, channel performance, and conversion tracking.',
  icons: {
    icon: [
      { url: '/favicon.png', type: 'image/png' },
      { url: '/icon.png', type: 'image/png' },
      { url: '/favicon.ico', type: 'image/x-icon' },
    ],
    shortcut: '/favicon.ico',
    apple: '/icon.png',
  },
  openGraph: {
    title: 'Motolia Analytics — GA4 Dashboard',
    description: 'Premium analytics dashboard for Motolia — real-time GA4 data, TV spot overlay, channel performance, and conversion tracking.',
    url: 'https://analytics.motolia.pl',
    siteName: 'Motolia Analytics',
    images: [
      {
        url: '/opengraph-image.png',
        width: 1200,
        height: 630,
        alt: 'Motolia Analytics Dashboard',
      },
    ],
    locale: 'pl_PL',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Motolia Analytics — GA4 Dashboard',
    description: 'Premium analytics dashboard for Motolia — real-time GA4 data, TV spot overlay, channel performance, and conversion tracking.',
    images: ['/opengraph-image.png'],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pl" className={inter.variable}>
      <body style={{ fontFamily: 'var(--font-sans)' }}>{children}</body>
    </html>
  );
}
