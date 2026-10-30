// The reminder hours (F10-T07b). Product constants, not club settings: the PRD change log row "Scope" fixes reminders
// at 24 h and 2 h before start, and D116 makes the numbers settings in code and variables in the text. The message
// catalogue (app.message_kinds.hours_before, migration 0607) holds the same values; a test keeps them equal.
export const REMINDER_HOURS = { reminder_24h: 24, reminder_2h: 2 } as const;

export type ReminderKind = keyof typeof REMINDER_HOURS;
