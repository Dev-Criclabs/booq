import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { translator, type Lang } from '../client/i18n';
import type { ScheduleDay, SlotState } from '../client/schedule';
import { CourtSchedule, type CourtScheduleProps } from './CourtSchedule';

// F03-T24: BOOK-01-AC7 (every state distinct without colour), AC14 (waitlist), BOOK-02-AC4 (paused).

const noop = () => {};
const states: SlotState[] = ['open', 'held', 'taken', 'closed', 'past', 'mine'];
const hours = states.map((state, i) => ({ start: `2027-01-09T${String(16 + i)}:00:00+07:00`, state, waitlist: state === 'taken' }));
const day: ScheduleDay = { date: '2027-01-09', courts: [{ id: 'c1', name: '1', sport: 'tennis', hours }, { id: 'c2', name: '2', sport: 'tennis', hours: hours.map((x) => ({ ...x, state: 'open' as const, waitlist: false })) }], dayFull: false, waitlist: false };

function render(lang: Lang, over: Partial<CourtScheduleProps> = {}) {
  const props: CourtScheduleProps = {
    t: translator(lang), lang, slug: 'hunter', dates: ['2027-01-09', '2027-01-10'], date: '2027-01-09', onDate: noop, day, loading: false,
    selection: { courtId: 'c2', starts: [hours[0]!.start] }, onTap: noop, onContinue: noop, onBack: noop, dayFull: null, closedForBooking: false, paused: false, ...over,
  };
  return renderToStaticMarkup(createElement(CourtSchedule, props));
}

describe('C4 states', () => {
  it('BOOK-01-AC7: each of the seven states has its own word and its own icon, in both languages', () => {
    for (const lang of ['en', 'th'] as const) {
      const html = render(lang);
      const cells = [...html.matchAll(/class="slot slot-(\w+)" data-state="\w+"[^>]*>(<svg.*?<\/svg>)<span class="slot-text">(.*?)<\/span><\/(?:div|button)>/g)].map((m) => ({ state: m[1]!, icon: m[2]!, text: m[3]!.replace(/<[^>]+>/g, '') }));
      const byState = new Map(cells.map((c) => [c.state, c]));
      expect([...byState.keys()].sort()).toEqual(['closed', 'held', 'mine', 'open', 'past', 'selected', 'taken']);
      expect(new Set([...byState.values()].map((c) => c.text)).size).toBe(7);
      expect(new Set([...byState.values()].map((c) => c.icon)).size).toBe(7);
    }
  });
  it('only Open and Selected hours are buttons; the rest cannot be chosen', () => {
    const html = render('en');
    const buttons = [...html.matchAll(/<button type="button" class="slot slot-(\w+)"/g)].map((m) => m[1]);
    expect(new Set(buttons)).toEqual(new Set(['open', 'selected']));
  });
  it('BOOK-01-AC14: a taken hour with a waitlist offers it; on a full day it reads Join waitlist', () => {
    const t = translator('en');
    expect(render('en')).toContain(t('P-0054'));
    expect(render('en', { day: { ...day, dayFull: true }, dayFull: { fromTime: '16:00', next: null } })).toContain(t('P-0324'));
  });
  it('the summary names the court, date and hours from one key, with no price', () => {
    const html = render('en');
    expect(html).toContain('Court 2 · Sat 9 Jan · 16:00 to 17:00');
    expect(html).not.toContain('฿');
  });
  it('BOOK-02-AC4: a paused club shows the paused notice and no grid, with Bookings still in the nav', () => {
    const t = translator('th');
    const html = render('th', { paused: true });
    expect(html).toContain(t('P-0442'));
    expect(html).not.toContain('data-testid="grid"');
    expect(html).toContain('href="/c/hunter/bookings"');
  });
});
