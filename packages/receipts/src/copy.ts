// The text of a receipt comes from the language files by key (TEXT-01). `createCopy` turns one language's dictionary into
// the `t(key, variables)` the template calls. A key that is missing, or a variable the text needs and the caller did not
// give (or the other way round), is an error, so a receipt can never go out with a hole or a stray `{name}` in it.
export type Language = 'th' | 'en';
export type Dictionary = Readonly<Record<string, string>>;
export type Translate = (key: string, variables?: Readonly<Record<string, string | number>>) => string;

const VARIABLE = /\{([A-Za-z][A-Za-z0-9]*)\}/g;

export function variablesOf(text: string): string[] {
  return [...new Set([...text.matchAll(VARIABLE)].map((m) => m[1]!))].sort();
}

export function createCopy(dictionary: Dictionary): Translate {
  return (key, variables = {}) => {
    const text = dictionary[key];
    // i18n-ignore: a developer assertion that stops a bad build of a receipt; no person ever sees it
    if (text === undefined) throw new Error(`receipt text key ${key} is not in the language file`);
    const needed = variablesOf(text);
    const given = Object.keys(variables).sort();
    // i18n-ignore: same, an internal assertion
    if (needed.join() !== given.join()) throw new Error(`receipt text key ${key} needs variables [${needed.join(', ')}] and got [${given.join(', ')}]`);
    return text.replace(VARIABLE, (_, name: string) => String(variables[name]));
  };
}
