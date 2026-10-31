import type { ReactNode } from 'react';
import '../ui/console.css';

// The console's shell. Pages are English only; the console is not indexed.
// i18n-ignore the product name
export const metadata = { title: 'BOOQ console', robots: { index: false, follow: false } };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
