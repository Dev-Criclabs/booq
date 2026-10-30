-- D152 / migration 0048 (after 0034, which creates the setup steps this registers into): the privacy notice and terms, versioned. Design: docs/architecture/legal-notice.md.
-- A release is one published set (privacy and terms, each in Thai and English) under a label v1, v2, ... made here.
-- Only a platform admin publishes (P6 entry with a hash of each text, never the text). Releases are append-only.
-- The app reads the current label (app.current_notice_version, also a column of public.public_club_config) and the
-- rendered text (app.render_notice: {clubName} and {legalName} are the only fields, filled from the club in the
-- context; the legal name is public through this function alone). app.sign_up_player now refuses a notice version
-- that is not the current one. Draft to Testing is blocked until a release exists (setup step legal_notice).
-- No legal text is written in this repository.

create table platform.legal_release (
  seq integer primary key check (seq > 0),
  version text generated always as ('v' || seq::text) stored,
  published_at timestamptz not null default app.now(),
  published_by uuid not null references platform.platform_staff (id),
  constraint legal_release_version_unique unique (version)
);
create table platform.legal_text (
  seq integer not null references platform.legal_release (seq),
  kind text not null check (kind in ('privacy', 'terms')),
  language text not null check (language in ('th', 'en')),
  title text not null check (btrim(title) <> ''),
  body text not null check (btrim(body) <> ''),
  primary key (seq, kind, language)
);
alter table platform.legal_release owner to booq_owner;
alter table platform.legal_text owner to booq_owner;
revoke all on platform.legal_release, platform.legal_text from public;
grant select on platform.legal_release, platform.legal_text to booq_platform;
do $$
declare t text;
begin
  foreach t in array array['legal_release', 'legal_text'] loop
    execute format('create trigger %1$s_append_only before update or delete on platform.%1$I for each row execute function app.refuse_change()', t);
    execute format('create trigger %1$s_no_truncate before truncate on platform.%1$I for each statement execute function app.refuse_change()', t);
  end loop;
end $$;

-- p_texts: {"privacy": {"th": {"title", "body"}, "en": {...}}, "terms": {...}}. Returns the new version label.
create function platform.publish_legal_release(p_texts jsonb) returns text
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_staff uuid := platform.staff_id();
  v_seq integer;
  v_kind text;
  v_lang text;
  v_title text;
  v_body text;
  v_field text;
  v_hashes jsonb := '{}'::jsonb;
begin
  if v_staff is null or not platform.is_admin() then
    raise exception 'legal:not_allowed' using errcode = '42501';
  end if;
  if p_texts is null or jsonb_typeof(p_texts) <> 'object' then
    raise exception 'legal:invalid_texts' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('legal_release', 0));
  select coalesce(max(seq), 0) + 1 into v_seq from platform.legal_release;
  insert into platform.legal_release (seq, published_by) values (v_seq, v_staff);
  foreach v_kind in array array['privacy', 'terms'] loop
    foreach v_lang in array array['th', 'en'] loop
      v_title := p_texts -> v_kind -> v_lang ->> 'title';
      v_body := p_texts -> v_kind -> v_lang ->> 'body';
      if btrim(coalesce(v_title, '')) = '' or btrim(coalesce(v_body, '')) = '' then
        raise exception 'legal:missing_text:%:%', v_kind, v_lang using errcode = 'P0001';
      end if;
      for v_field in select m[1] from regexp_matches(v_title || ' ' || v_body, '\{([^{}]*)\}', 'g') as m loop
        if v_field not in ('clubName', 'legalName') then
          raise exception 'legal:unknown_field:%', v_field using errcode = 'P0001';
        end if;
      end loop;
      insert into platform.legal_text (seq, kind, language, title, body) values (v_seq, v_kind, v_lang, v_title, v_body);
      v_hashes := v_hashes || jsonb_build_object(v_kind || '_' || v_lang || '_sha256', encode(sha256(convert_to(v_title || E'\n' || v_body, 'UTF8')), 'hex'));
    end loop;
  end loop;
  perform platform.write_audit('legal.release_published', null, 'legal_release', 'v' || v_seq::text, jsonb_build_object('version', 'v' || v_seq::text) || v_hashes, null, null);
  return 'v' || v_seq::text;
end $$;

create function app.current_notice_version() returns text
language sql stable security definer set search_path = pg_catalog
as $$ select r.version from platform.legal_release r order by r.seq desc limit 1 $$;

-- The text of the current release for the club in the context, with the club fields filled. Null when nothing is
-- published, the kind or language is unknown, or there is no club.
create function app.render_notice(p_kind text, p_language text) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog
as $$
declare
  v_club uuid := app.club_id();
  v_seq integer;
  v_title text;
  v_body text;
  c public.club%rowtype;
  v_name text;
  v_legal text;
begin
  if v_club is null or p_kind not in ('privacy', 'terms') or p_language not in ('th', 'en') then
    return null;
  end if;
  select r.seq into v_seq from platform.legal_release r order by r.seq desc limit 1;
  if v_seq is null then return null; end if;
  select * into c from public.club where id = v_club;
  if not found then return null; end if;
  select t.title, t.body into v_title, v_body from platform.legal_text t where t.seq = v_seq and t.kind = p_kind and t.language = p_language;
  v_name := case when p_language = 'th' then c.name_th else c.name_en end;
  v_legal := coalesce(nullif(btrim(c.legal_name), ''), v_name);
  return jsonb_build_object(
    'version', 'v' || v_seq::text, 'language', p_language,
    'title', replace(replace(v_title, '{clubName}', v_name), '{legalName}', v_legal),
    'body', replace(replace(v_body, '{clubName}', v_name), '{legalName}', v_legal));
end $$;

create or replace view public.public_club_config with (security_barrier = true) as
select c.name_th, c.name_en, c.default_language, c.status, l.liff_id, app.current_notice_version() as notice_version
  from public.club c
  left join public.line_connection l on l.club_id = c.id
 where c.id = app.club_id();

-- Draft to Testing needs a published release: without one nobody can sign up, tester or owner.
create function app.setup_legal_notice(p_club uuid) returns boolean
language sql stable security definer set search_path = pg_catalog
as $$ select exists (select 1 from platform.legal_release) $$;

do $$
declare f text;
begin
  foreach f in array array['platform.publish_legal_release(jsonb)', 'app.current_notice_version()', 'app.render_notice(text, text)', 'app.setup_legal_notice(uuid)'] loop
    execute format('alter function %s owner to booq_owner', f);
    execute format('revoke all on function %s from public', f);
  end loop;
  grant execute on function platform.publish_legal_release(jsonb) to booq_platform;
  grant execute on function app.current_notice_version() to booq_app, booq_worker, booq_platform;
  grant execute on function app.render_notice(text, text) to booq_app;
end $$;
select app.register_setup_step('legal_notice', 60, 'booq', 'app.setup_legal_notice(uuid)'::regprocedure);

-- sign_up_player (0025) with the version check.
create or replace function app.sign_up_player(
  p_session_token_hash text, p_full_name text, p_phone text, p_phone_normalized text, p_language text,
  p_notice_version text, p_consent_language text, p_invite_hash text default null
) returns uuid
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_status text;
  -- No %rowtype: auth_session is created by F02's migration 0102, after this one.
  v_sid uuid;
  v_line text;
  v_name text;
  v_created timestamptz;
  v_expires timestamptz;
  v_invite_kind text;
  v_test boolean := false;
  v_user uuid;
  v_notice text;
begin
  if v_club is null then
    raise exception 'sign_up_player needs a club in the context' using errcode = 'P0001';
  end if;
  select s.id, s.line_user_id, s.pending_display_name, s.created_at, s.expires_at
    into v_sid, v_line, v_name, v_created, v_expires
    from public.auth_session s
   where s.club_id = v_club and s.token_hash = p_session_token_hash
     and s.state = 'pending_profile' and s.revoked_at is null and s.expires_at > app.now()
   for update;
  if not found then
    raise exception 'sign_up:no_pending_session' using errcode = 'P0001';
  end if;
  -- The consent is for the text that is current now (D152): a stale version makes the client show the text again.
  v_notice := app.current_notice_version();
  if v_notice is null then
    raise exception 'sign_up:no_notice' using errcode = 'P0001';
  end if;
  if p_notice_version is distinct from v_notice then
    raise exception 'sign_up:notice_version_stale' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.app_user u where u.club_id = v_club and u.line_user_id = v_line) then
    raise exception 'sign_up:already_registered' using errcode = 'P0001';
  end if;

  select c.status into v_status from public.club c where c.id = v_club;
  if v_status in ('draft', 'testing') then
    select i.kind into v_invite_kind from public.club_invite i
     where i.club_id = v_club and i.token_hash = p_invite_hash and i.kind in ('owner', 'tester')
       and i.used_at is null and i.expires_at > app.now()
       and (i.bound_line_user_id is null or i.bound_line_user_id = v_line);
    if v_invite_kind is null then
      raise exception 'sign_up:not_a_tester' using errcode = 'P0001';
    end if;
    v_test := v_invite_kind = 'tester';
  end if;

  insert into public.app_user (club_id, line_user_id, display_name, full_name, phone, phone_normalized, language, is_test)
    values (v_club, v_line, v_name, p_full_name, p_phone, p_phone_normalized, p_language, v_test)
    returning id into v_user;
  insert into public.app_user_role (club_id, user_id, role) values (v_club, v_user, 'player');
  insert into public.user_consent (club_id, user_id, notice_version, language) values (v_club, v_user, p_notice_version, p_consent_language);

  delete from public.auth_session where club_id = v_club and id = v_sid;
  insert into public.auth_session (club_id, token_hash, user_id, line_user_id, state, created_at, expires_at)
    values (v_club, p_session_token_hash, v_user, v_line, 'active', v_created, v_expires);
  return v_user;
end $$;
alter function app.sign_up_player(text, text, text, text, text, text, text, text) owner to booq_owner;
revoke all on function app.sign_up_player(text, text, text, text, text, text, text, text) from public;
grant execute on function app.sign_up_player(text, text, text, text, text, text, text, text) to booq_app;
