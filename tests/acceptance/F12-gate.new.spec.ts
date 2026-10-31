// F12 acceptance sweep gate (QA, same style as F04-gate.new.spec.ts). Every criterion has a real test (a traced pointer or a QA test) or is listed with its reason.
// A listed criterion that gains a test fails as stale, so the list only shrinks. Where a criterion is traced for its database side only, docs/qa/f12-sweep.md says so.
import { defineGate } from './gate';

defineGate('F12', {
  'F12/CPORT-01': 'Today shows the coach\'s own sessions in time order: the portal route and screen are not built (the function app.coach_day exists, no test calls it)',
  'F12/CPORT-02': 'Schedule shows approved leave days with no session on them: the portal screen is not built (app.coach_schedule exists, no test calls it)',
}, 7);
