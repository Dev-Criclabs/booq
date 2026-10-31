'use client';
import { useEffect, useMemo, useState } from 'react';
import type { Lang } from '../../client/i18n';
import { loadProducts, tabFrom, type PublicProduct, type Tab } from '../../client/packages';
import { useClub, useLiff } from '../../client/use-club';
import { Packages } from '../packages/Packages';
import { Loading, StateScreen } from '../StateScreen';

// /c/{slug}/packages, C9 Packages (F06-T17). A public page: a guest sees the products and signs in at checkout (C10P).
// ?tab=solo or ?tab=group opens that tab; switching tabs keeps the address in step without a reload.

export function PackagesScreen({ slug, initialLang }: { slug: string; initialLang: Lang }) {
  const liff = useLiff();
  const { load, lang, t, retry } = useClub(slug, initialLang, liff);
  const [products, setProducts] = useState<PublicProduct[] | null>(null);
  const [failure, setFailure] = useState<'offline' | 'not_found' | null>(null);
  const [tab, setTab] = useState<Tab>('court');
  const [attempt, setAttempt] = useState(0);
  const f = useMemo(() => (typeof window === 'undefined' ? fetch : window.fetch.bind(window)), []);

  useEffect(() => {
    setTab(tabFrom(window.location.search));
  }, []);

  useEffect(() => {
    if (load.state !== 'ready') return;
    let live = true;
    setFailure(null);
    void loadProducts(slug, f).then((r) => {
      if (!live) return;
      if (r.ok) setProducts(r.value);
      else setFailure(r.status === 404 ? 'not_found' : 'offline');
    });
    return () => {
      live = false;
    };
  }, [load, slug, f, attempt]);

  const onTab = (next: Tab) => {
    setTab(next);
    const url = new URL(window.location.href);
    if (next === 'court') url.searchParams.delete('tab');
    else url.searchParams.set('tab', next);
    window.history.replaceState(null, '', url);
  };

  if (load.state === 'not_found' || failure === 'not_found') return <StateScreen t={t} testId="not-found" textKey="P-new.page_not_found" />;
  if (load.state === 'offline' || failure === 'offline') {
    return <StateScreen t={t} offline testId="offline" titleKey="P-0326" textKey="P-0327" actionKey="P-0328" onAction={() => (load.state === 'offline' ? retry() : setAttempt((n) => n + 1))} />;
  }
  if (load.state === 'loading' || products === null) return <Loading />;
  return <Packages t={t} lang={lang} slug={slug} products={products} tab={tab} onTab={onTab} />;
}
