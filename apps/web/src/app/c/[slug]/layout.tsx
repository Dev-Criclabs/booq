import type { ReactNode } from 'react';
import '../../../ui/player.css';
import { requestLang } from '../../../ui/request-lang';

// The player app shell under /c/{slug} (D6). Fonts: DM Sans, Noto Sans Thai, and Cormorant
// Garamond for the club wordmark only (PRD palette D).
const FONTS = 'https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400..700&family=Noto+Sans+Thai:wght@400;500;600&family=Cormorant+Garamond:wght@500&display=swap';

export const viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#4E6B54' };

export default async function PlayerLayout({ children }: { children: ReactNode }) {
  return (
    <html lang={await requestLang()}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href={FONTS} />
      </head>
      <body>{children}</body>
    </html>
  );
}
