import { cookies, headers } from 'next/headers';
import type { Lang } from '../client/i18n';
import { baseLang, cookieLang } from '../client/lang';

// The first-paint language on the server: the guest's `lang` cookie, else the browser's first
// language that the app supports. The page refines it with the LINE language and the club default.
export async function requestLang(): Promise<Lang> {
  const fromCookie = cookieLang((await cookies()).toString());
  if (fromCookie) return fromCookie;
  const accept = (await headers()).get('accept-language') ?? '';
  for (const tag of accept.split(',')) {
    const l = baseLang(tag.split(';')[0]?.trim());
    if (l) return l;
  }
  return 'th';
}
