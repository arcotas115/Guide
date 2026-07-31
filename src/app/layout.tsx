import type { Metadata, Viewport } from 'next';
import { Instrument_Sans, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';

const instrumentSans = Instrument_Sans({
  variable: '--font-instrument-sans',
  subsets: ['latin'],
});

// Mono is metadata only — course codes, roll numbers, times, marks.
const ibmPlexMono = IBM_Plex_Mono({
  variable: '--font-ibm-plex-mono',
  subsets: ['latin'],
  weight: ['400', '500'],
});

export const metadata: Metadata = {
  title: 'Campus',
  description:
    'Your courses, deadlines, timetable and attendance — in one calm place.',
};

// Student screens are the mobile-first surface, so the viewport is pinned to
// device width. themeColor matches --canvas so the phone status bar blends in.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#fafaf8',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${instrumentSans.variable} ${ibmPlexMono.variable} h-full antialiased`}
    >
      {/* tnum: tabular numerals, so percentages and marks line up in columns. */}
      <body className="flex min-h-full flex-col [font-feature-settings:'tnum'_1]">
        {children}
      </body>
    </html>
  );
}
