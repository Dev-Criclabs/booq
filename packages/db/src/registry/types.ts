// Table class registry (F01-T05; F01 design 3.1; build plan section 4).
//   S     setup data: BOOQ staff may see it in the support view (decision D27)
//   D     club data: players, bookings, payments ... BOOQ staff never (the default for anything new)
//   P     platform schema: BOOQ's own data
//   infra bookkeeping that belongs to no club (the migration table)
export type TableClass = 'S' | 'D' | 'P' | 'infra';

export interface TableEntry {
  class: TableClass;
  /** 'club' (default for S and D): has club_id. 'self': the club table itself, whose id is the club. */
  scope?: 'club' | 'self';
  /** Columns of an S table that look personal but are allowed (for example the owner contact, decision D2). */
  allowColumns?: string[];
}

/** One feature's tables, keyed by "schema.table". */
export type Fragment = Record<string, TableEntry>;
export type Registry = Record<string, TableEntry>;
