// The coach portal's API faked for the browser tests (F12): sessions relative to the clock, so Done and Next are real whatever the day.
const HOUR = 3600_000;
const at = (ms) => new Date(Math.floor(ms / HOUR) * HOUR).toISOString();

/** A day for K1: two done, one next (a group), one later, relative to now. */
export function daySessions(now = Date.now(), { long = false } = {}) {
  const h = (n) => Math.floor(now / HOUR) * HOUR + n * HOUR;
  const name = long ? 'Wanchalerm Sriwongsawat-Chaiyaphum Thanachotiwat' : 'Ploy Srisuk';
  return [
    { kind: 'solo', ref_id: 'b0000000-0000-4000-8000-000000000001', start_at: at(h(-3)), end_at: at(h(-2)), court: 'Court 1', held: false, student_name: 'Somchai Jaidee', class_name_th: null, class_name_en: null, level: 'beginner', players: 1, capacity: null, needs_attention: false, status: 'confirmed' },
    { kind: 'solo', ref_id: 'b0000000-0000-4000-8000-000000000002', start_at: at(h(-2)), end_at: at(h(-1)), court: 'Court 2', held: false, student_name: 'Nok', class_name_th: null, class_name_en: null, level: 'intermediate', players: 1, capacity: null, needs_attention: false, status: 'confirmed' },
    { kind: 'group', ref_id: 'c0000000-0000-4000-8000-000000000003', start_at: at(h(1)), end_at: at(h(2)), court: 'Court 1', held: false, student_name: null,
      class_name_th: long ? 'คลินิกฝึกตีโต้และเสิร์ฟสำหรับมือใหม่ผู้ใหญ่ รอบเย็นวันธรรมดา' : 'คลินิกมือใหม่ผู้ใหญ่', class_name_en: long ? 'Adult beginner rally and serve clinic, weekday evening session' : 'Adult beginner clinic',
      level: 'beginner', players: 5, capacity: 6, needs_attention: false, status: 'scheduled' },
    { kind: 'solo', ref_id: 'b0000000-0000-4000-8000-000000000004', start_at: at(h(3)), end_at: at(h(4)), court: 'Court 2', held: false, student_name: name, class_name_th: null, class_name_en: null, level: 'beginner', players: 1, capacity: null, needs_attention: false, status: 'confirmed' },
  ];
}

/**
 * The `extra` hook of openPage for the coach portal. `today`: the rows (or 'forbidden' for a person who is not a coach, 'offline');
 * `restCap`: the number. Everything else falls through to the harness.
 */
export function coachFakes({ today = daySessions(), restCap = 6, week = (from) => weekItems(from), ...more } = {}) {
  return async ({ method, path, url, body }) => {
    if (!/\/coach\//.test(path)) return null;
    if (today === 'forbidden') return { status: 403, json: { code: 'forbidden' } };
    if (/\/coach\/today$/.test(path)) return { status: 200, json: { date: url.searchParams.get('date'), count: today.length, hours: today.length, sessions: today } };
    if (/\/coach\/rest-cap$/.test(path)) return { status: 200, json: { restCapHours: restCap } };
    if (/\/coach\/schedule$/.test(path)) {
      const items = week(url.searchParams.get('from'), url.searchParams.get('to'));
      const n = (item, kind) => items.filter((r) => r.item === item && (!kind || r.kind === kind)).length;
      return { status: 200, json: { from: url.searchParams.get('from'), to: url.searchParams.get('to'), counts: { solo: n('session', 'solo'), group: n('session', 'group'), leave: n('leave') }, items } };
    }
    if (more.handle) return more.handle({ method, path, url, body });
    return null;
  };
}

const bkk = (day, hhmm) => new Date(`${day}T${hhmm}:00+07:00`).toISOString();
const addDay = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);

/** A week for K2 from its Monday: solo and group classes, an afternoon leave, a pending trip, the club's court maintenance and the coach's own closed hours. */
export function weekItems(monday, { long = false } = {}) {
  const d = (n) => addDay(monday, n);
  const base = { court: null, held: false, student_name: null, class_name_th: null, class_name_en: null, level: null, players: null, capacity: null, needs_attention: false, note: null };
  const solo = (day, hh, who, court) => ({ ...base, item: 'session', kind: 'solo', ref_id: `b-${day}-${hh}`, start_at: bkk(day, hh), end_at: bkk(day, `${String(Number(hh.slice(0, 2)) + 1).padStart(2, '0')}:00`), court, student_name: who, status: 'confirmed', players: 1 });
  const group = (day, hh, players) => ({ ...base, item: 'session', kind: 'group', ref_id: `c-${day}-${hh}`, start_at: bkk(day, hh), end_at: bkk(day, `${String(Number(hh.slice(0, 2)) + 1).padStart(2, '0')}:00`), court: 'Court 1',
    class_name_th: long ? 'คลินิกฝึกตีโต้และเสิร์ฟสำหรับมือใหม่ผู้ใหญ่ รอบเย็นวันธรรมดา' : 'คลินิกมือใหม่', class_name_en: long ? 'Adult beginner rally and serve clinic, weekday evening session' : 'Adult beginner clinic', level: 'beginner', players, capacity: 6, status: 'scheduled' });
  return [
    solo(d(0), '07:00', long ? 'Wanchalerm Sriwongsawat-Chaiyaphum' : 'Ploy', 'Court 1'),
    group(d(0), '19:00', 4),
    solo(d(1), '09:00', 'Nok', 'Court 2'),
    { ...base, item: 'leave', kind: null, ref_id: 'l1', start_at: bkk(d(1), '13:00'), end_at: bkk(d(1), '17:00'), status: 'approved', note: long ? 'Afternoon off to renew the passport and visa at the immigration office' : 'Afternoon off' },
    { ...base, item: 'blocked', kind: null, ref_id: 'k1', start_at: bkk(d(2), '10:00'), end_at: bkk(d(2), '12:00'), court: 'Court 1', status: 'closed', note: 'maintenance' },
    solo(d(2), '18:00', 'Ann', 'Court 2'),
    group(d(3), '20:00', 6),
    { ...base, item: 'blocked', kind: null, ref_id: 'k2', start_at: bkk(d(4), '06:00'), end_at: bkk(d(4), '09:00'), status: 'closed' },
    { ...base, item: 'leave', kind: null, ref_id: 'l2', start_at: bkk(d(5), '00:00'), end_at: bkk(addDay(monday, 6), '00:00'), status: 'pending', note: null },
  ];
}
