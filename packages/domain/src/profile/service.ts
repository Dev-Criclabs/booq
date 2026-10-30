import { validateFullName, validatePhone, type NameErrorCode, type PhoneErrorCode } from '../phone';
import { priceGroupFor, type PriceGroup } from '../price-group';

// Profile editing (F02-T14; AUTH-02-AC15 to AC23, AC29; D12). A signed-in player changes their own
// name, phone, date of birth, level and language, any subset, any number of times; nothing is locked.
// The update is on the signed-in id only (a body cannot name another person), and the database lets a
// player write just these columns on their own row. Every change is audited by the trigger with the old
// and new values in the personal columns and the player as actor (AC21). The price group in the answer
// is worked out from the saved date of birth and today's Bangkok date by the one shared function (D12).

export type ProfileEditErrorCode = 'forbidden' | 'bad_input' | 'invalid';
export interface ProfileFieldErrors {
  fullName?: NameErrorCode;
  phone?: PhoneErrorCode;
  dateOfBirth?: 'dob_invalid' | 'dob_future';
  level?: 'level_invalid';
  language?: 'language_invalid';
}
export class ProfileEditError extends Error {
  constructor(readonly code: ProfileEditErrorCode, readonly fields?: ProfileFieldErrors) {
    super(code);
  }
}

export interface ProfileTx {
  // Rows are untyped here: the caller's own transaction type fits this shape.
  query(text: string, params?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
}
export interface ProfileActor {
  clubId: string;
  userId: string | null;
  roles: readonly string[];
}
export interface Profile {
  fullName: string | null;
  phone: string | null;
  dateOfBirth: string | null;
  level: string | null;
  language: string | null;
  priceGroup: PriceGroup;
}

const FIELDS = new Set(['fullName', 'phone', 'dateOfBirth', 'level', 'language']);
const LEVELS = ['new', 'beginner', 'intermediate', 'advanced'] as const;

function realDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).toISOString().slice(0, 10) === s;
}

export function createProfileEditService(deps: { /** Today's Asia/Bangkok date from the clock. */ today(): string }) {
  const toProfile = (r: any): Profile => ({
    fullName: r.full_name ?? null,
    phone: r.phone ?? null,
    dateOfBirth: r.dob ?? null,
    level: r.level ?? null,
    language: r.language ?? null,
    priceGroup: priceGroupFor(r.dob ?? null, deps.today()),
  });
  const SELECT = `select full_name, phone, date_of_birth::text as dob, level, language from public.app_user where id = app.user_id()`;

  return {
    async get(tx: ProfileTx, actor: ProfileActor): Promise<Profile> {
      if (!actor.userId) throw new ProfileEditError('forbidden');
      const row = (await tx.query(SELECT)).rows[0];
      if (!row) throw new ProfileEditError('forbidden');
      return toProfile(row);
    },

    async update(tx: ProfileTx, actor: ProfileActor, body: unknown): Promise<Profile> {
      if (!actor.userId) throw new ProfileEditError('forbidden');
      if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new ProfileEditError('bad_input');
      const keys = Object.keys(body);
      if (keys.length === 0 || keys.some((k) => !FIELDS.has(k))) throw new ProfileEditError('bad_input');
      const b = body as Record<string, unknown>;

      const errors: ProfileFieldErrors = {};
      const set: string[] = [];
      const params: unknown[] = [];
      const put = (column: string, value: unknown) => {
        params.push(value);
        set.push(`${column} = $${params.length}`);
      };

      if ('fullName' in b) {
        const r = typeof b['fullName'] === 'string' ? validateFullName(b['fullName']) : ({ ok: false, code: 'name_invalid' } as const);
        if (r.ok) put('full_name', r.value);
        else errors.fullName = r.code;
      }
      if ('phone' in b) {
        const r = typeof b['phone'] === 'string' ? validatePhone(b['phone']) : ({ ok: false, code: 'phone_invalid' } as const);
        if (r.ok) {
          put('phone', (b['phone'] as string).trim());
          put('phone_normalized', r.value.replace(/^\+/, ''));
        } else errors.phone = r.code;
      }
      if ('dateOfBirth' in b) {
        const v = b['dateOfBirth'];
        if (v === null) put('date_of_birth', null);
        else if (typeof v !== 'string' || !realDate(v)) errors.dateOfBirth = 'dob_invalid';
        else if (v > deps.today()) errors.dateOfBirth = 'dob_future';
        else put('date_of_birth', v);
      }
      if ('level' in b) {
        const v = b['level'];
        if (v === null || (typeof v === 'string' && (LEVELS as readonly string[]).includes(v))) put('level', v);
        else errors.level = 'level_invalid';
      }
      if ('language' in b) {
        const v = b['language'];
        if (v === 'th' || v === 'en') put('language', v);
        else errors.language = 'language_invalid';
      }
      if (Object.keys(errors).length > 0) throw new ProfileEditError('invalid', errors);

      const row = (await tx.query(`update public.app_user set ${set.join(', ')} where id = app.user_id() returning full_name, phone, date_of_birth::text as dob, level, language`, params)).rows[0];
      if (!row) throw new ProfileEditError('forbidden');
      return toProfile(row);
    },
  };
}
