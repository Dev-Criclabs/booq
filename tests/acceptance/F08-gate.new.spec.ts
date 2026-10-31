// F08 acceptance sweep gate (QA, same style as F04-gate.new.spec.ts). Every criterion has a real test (a traced pointer or a QA test) or is listed with its reason.
// A listed criterion that gains a test fails as stale, so the list only shrinks. Where a criterion is traced for its database side only, docs/qa/f08-sweep.md says so.
import { defineGate } from './gate';

defineGate('F08', {
  'F08/CLASS-01-AC15': 'C8 offering the drop in price or the 8 pack when there are no group credits: the C8 screen and the F06 R3-AC3 flow are not built',
  'F08/CLASS-01-AC18': 'a rule for test authors (do not copy the canvas sample sessions); nothing to run: the lane and QA tests use their own data',
}, 39);
