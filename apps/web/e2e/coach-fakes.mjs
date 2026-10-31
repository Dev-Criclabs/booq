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
export function coachFakes({ today = daySessions(), restCap = 6, ...more } = {}) {
  return async ({ method, path, url, body }) => {
    if (!/\/coach\//.test(path)) return null;
    if (today === 'forbidden') return { status: 403, json: { code: 'forbidden' } };
    if (/\/coach\/today$/.test(path)) return { status: 200, json: { date: url.searchParams.get('date'), count: today.length, hours: today.length, sessions: today } };
    if (/\/coach\/rest-cap$/.test(path)) return { status: 200, json: { restCapHours: restCap } };
    if (more.handle) return more.handle({ method, path, url, body });
    return null;
  };
}
