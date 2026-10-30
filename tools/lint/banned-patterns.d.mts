export interface Violation {
  path: string;
  line: number;
  rule: 'no-service-role' | 'no-raw-pg';
}
export function isScanned(path: string): boolean;
export function findViolations(path: string, text: string): Violation[];
export function scanRepository(root?: string): Violation[];
