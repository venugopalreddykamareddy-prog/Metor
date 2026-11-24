// When an answer flags a term as unrecognized, any specific setting, flag, command or config key it
// still names is unverified: the model may have invented it (seen in testing: "fast-asynchronous
// updates", "a ServiceEntry that bypasses Envoy"). Found with explicit patterns only.

const PATTERNS: RegExp[] = [
  /`[^`\n]{2,60}`/g, // `inline code`
  /(?<![\w-])--?[a-z][\w-]{2,}/gi, // --flags, -flags
  /\b[a-z]+(?:[A-Z][a-z0-9]+)+(?:\.[a-z]+(?:[A-Z][a-z0-9]+)*)*\b/g, // camelCase / dotted.configKeys
  /\b[a-z][\w.-]*\s*[:=]\s*(?:true|false|\d+[a-z%]*)\b/gi, // key: value, key=value
  /[“"][^”"\n]{2,40}[”"]\s+(?:feature|flag|setting|mode|option|parameter)/gi, // "something" feature
];

/** Specific settings, flags, commands or config keys named in the text (deduplicated, in order). */
export function unverifiedSpecifics(text: string): string[] {
  const found = new Set<string>();
  let rest = text;
  for (const p of PATTERNS) {
    for (const m of rest.matchAll(p)) found.add(m[0].trim());
    if (p === PATTERNS[0]) rest = rest.replace(p, ' '); // don't count code spans twice
  }
  return [...found].slice(0, 5);
}
