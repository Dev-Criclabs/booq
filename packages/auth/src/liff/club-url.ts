// Every deep link is built here, so it always contains the club (AUTH-01-AC14, design 6.3): a link
// for club A never signs a player in to club B. `baseUrl` is the APP_BASE_URL setting and is never in code.

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function clubUrl(baseUrl: string, slug: string, path = ''): string {
  if (!/^https:\/\//.test(baseUrl)) throw new Error('clubUrl: the base URL must be https');
  if (!SLUG.test(slug) || slug.length > 63) throw new Error('clubUrl: bad club slug');
  if (path !== '' && (!path.startsWith('/') || path.startsWith('//') || path.includes('\\') || /[\r\n]/.test(path))) throw new Error('clubUrl: bad path');
  return `${baseUrl.replace(/\/+$/, '')}/c/${slug}${path}`;
}
