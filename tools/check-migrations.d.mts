export const BLOCKS: { name: string; from: number; to: number }[];
export function checkNames(names: string[]): string[];
export function checkImmutable(base: Map<string, string>, current: Map<string, string>): string[];
export function run(dir?: string, env?: Record<string, string | undefined>): { problems: string[]; count: number };
export function definedObjects(sql: string): Set<string>;
export function checkLateRedefinitions(base: Map<string, string>, current: Map<string, string>): string[];
