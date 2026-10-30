-- F10-T02 / migration 0601: message_outbox. FA 5.3; F10 design 4.1, 5.1 and 7. Requirements: LINE-03-AC6
-- (the row is the message log: type, club, recipient, time and result, never text), CC-1, CC-3.
-- Class D. Rows are created only by app.enqueue_message (F10-T06, 0605) and moved on by the sender
-- (F10-T08, T09). Grants and the read policies of the sender and the platform reader are F10-T07 (0606);
-- until then no application role can reach the table.

-- Keys of params that name a personal field (CC-3, Architect review of 30 Oct): the outbox holds ids and
-- values, never names, phone numbers or dates of birth. camelCase keys are read as snake_case first, and
-- nested objects and arrays are checked too. A CHECK, so the rule is enforced, not promised.
create function app.message_params_ok(j jsonb) returns boolean
language plpgsql immutable set search_path = pg_catalog
as $$
declare
  k text;
  s text;
  e jsonb;
begin
  case jsonb_typeof(j)
    when 'object' then
      for k in select jsonb_object_keys(j) loop
        s := lower(regexp_replace(k, '([a-z0-9])([A-Z])', '\1_\2', 'g'));
        if s in ('date_of_birth', 'line_user_id', 'line_id', 'id_card', 'national_id')
           or string_to_array(s, '_') && array['name', 'names', 'phone', 'mobile', 'tel', 'email', 'dob', 'birth', 'address'] then
          return false;
        end if;
        if not app.message_params_ok(j -> k) then
          return false;
        end if;
      end loop;
    when 'array' then
      for e in select jsonb_array_elements(j) loop
        if not app.message_params_ok(e) then
          return false;
        end if;
      end loop;
    else null;
  end case;
  return true;
end $$;
alter function app.message_params_ok(jsonb) owner to booq_owner;

create table public.message_outbox (
  club_id uuid not null,
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,                       -- the recipient: a player, coach, staff member or owner of the club
  kind text not null,                          -- the catalogue key of F10 design 5.4
  params jsonb not null default '{}',          -- ids and values only (CC-3)
  dedupe_key text not null,
  send_at timestamptz not null default app.now(),
  status text not null default 'pending',
  void_reason text,
  attempts integer not null default 0,
  last_error text,                             -- a code (timeout, cap, token, http_500 ...), never a message body
  retry_key uuid not null default gen_random_uuid(),   -- X-Line-Retry-Key, stable for the row (FA 5.3)
  sent_at timestamptz,
  is_test boolean not null default false,
  created_at timestamptz not null default app.now(),
  primary key (club_id, id),
  foreign key (club_id, user_id) references public.app_user (club_id, id),
  constraint message_outbox_dedupe unique (club_id, dedupe_key),
  constraint message_outbox_kind_format check (kind ~ '^[a-z][a-z0-9_]*$'),
  constraint message_outbox_dedupe_key_present check (dedupe_key <> ''),
  constraint message_outbox_params_object check (jsonb_typeof(params) = 'object'),
  constraint message_outbox_params_not_personal check (app.message_params_ok(params)),
  constraint message_outbox_status_values check (status in ('pending', 'sent', 'void', 'failed', 'undeliverable')),
  constraint message_outbox_void_reason_values check (void_reason in ('cancelled', 'moved', 'cap', 'switch_off', 'no_credits', 'superseded')),
  constraint message_outbox_void_has_reason check ((status = 'void') = (void_reason is not null)),
  constraint message_outbox_sent_has_time check ((status = 'sent') = (sent_at is not null)),
  constraint message_outbox_attempts_non_negative check (attempts >= 0)
);
-- The sender's claim: due pending rows by send time (F10 design 5.2).
create index message_outbox_due on public.message_outbox (send_at) where status = 'pending';

-- Identity never changes; sent, void, failed and undeliverable are final; pending may stay pending on a
-- retry (F10 design 7). params may still be cleared by the anonymise handler, so it is not frozen here.
create function app.keep_outbox_identity() returns trigger
language plpgsql set search_path = pg_catalog
as $$
begin
  if new.club_id <> old.club_id or new.id <> old.id or new.user_id <> old.user_id or new.kind <> old.kind
     or new.dedupe_key <> old.dedupe_key or new.retry_key <> old.retry_key or new.created_at <> old.created_at then
    raise exception 'a message''s club, recipient, kind, dedupe key and retry key do not change' using errcode = 'P0001';
  end if;
  if old.status <> 'pending' and (new.status <> old.status or new.void_reason is distinct from old.void_reason) then
    raise exception 'a % message is final', old.status using errcode = 'P0001';
  end if;
  return new;
end $$;
alter function app.keep_outbox_identity() owner to booq_owner;
revoke all on function app.keep_outbox_identity() from public;
create trigger message_outbox_identity before update on public.message_outbox for each row execute function app.keep_outbox_identity();

alter table public.message_outbox owner to booq_owner;
alter table public.message_outbox enable row level security;
alter table public.message_outbox force row level security;
revoke all on public.message_outbox from public;
create policy message_outbox_tenant on public.message_outbox as restrictive for all to booq_app, booq_worker
  using (club_id = app.club_id()) with check (club_id = app.club_id());
create policy message_outbox_definer on public.message_outbox for all to booq_owner using (true) with check (true);

-- A Testing club's messages are test data (D4, D32) and go at Go live, before the people they address.
select app.register_test_table('public.message_outbox', 110);
