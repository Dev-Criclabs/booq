-- F04-T22a / migration 0516: a class seat is an order line (F08 gate 3; CLASS-01-AC14, AC17; R4 of F04).
-- order_line.kind gains 'class_seat'. Like a court hour, coach or add-on line it must name its booking, so F09 can
-- return value seat by seat (D21, D40). The allocation columns are the same as for a court hour, and the checks of
-- 0303 (net, split, the deferred sums against the order) apply unchanged. Numbered above 0504, which also redefines the
-- kind CHECK (adding wallet_credit), and above 0303, which defines both constraints (D159): the list below holds every
-- kind. Built after F06-T03b, as the orchestrator asked.
alter table public.order_line drop constraint order_line_kind_values;
alter table public.order_line add constraint order_line_kind_values
  check (kind in ('court_hour', 'coach', 'add_on', 'package', 'wallet_credit', 'class_seat'));
alter table public.order_line drop constraint order_line_booking_link;
alter table public.order_line add constraint order_line_booking_link
  check (kind not in ('court_hour', 'coach', 'add_on', 'class_seat') or booking_id is not null);
