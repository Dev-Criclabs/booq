// F06-T15: the typed refusals of the package and wallet reads. A code, never text (CC-5, TEXT-01); the route maps each code
// to a status and the client to a locale key.
export type PackageErrorCode = 'bad_input' | 'not_found' | 'forbidden';

export class PackageError extends Error {
  constructor(readonly code: PackageErrorCode) {
    super(code);
  }
}
