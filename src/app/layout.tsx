import type { Metadata, Viewport } from 'next';
import { Fraunces, Manrope } from 'next/font/google';
import './globals.css';

const heading = Fraunces({
  subsets: ['latin'],
  variable: '--font-heading',
  display: 'swap',
});

const body = Manrope({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'My Closet',
    template: '%s · My Closet',
  },
  description: 'Tu armario digital: prendas, conjuntos y calendario, siempre disponible.',
  applicationName: 'My Closet',
  icons: {
    icon: [{ url: '/icon-192.png', type: 'image/png' }],
    apple: [{ url: '/apple-touch-icon.png' }],
  },
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'My Closet',
  },
};

export const viewport: Viewport = {
  themeColor: '#F8F5F2',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${heading.variable} ${body.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-background text-text-primary font-body">
        {children}
      </body>
    </html>
  );
}
