import type { Metadata } from 'next';
import './globals.css';
import { ThemeProvider } from '@/components/ThemeProvider';
import { RateLimitBanner } from '@/components/RateLimitBanner';

export const metadata: Metadata = {
  title: 'Business Exchange — Partner Portal',
  description: 'B2B Integration Platform',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ThemeProvider>
          <RateLimitBanner />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
