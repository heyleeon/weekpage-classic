// Pseudo-localization, dev only (Android / Chromium call it en-XA): every translated string comes
// back accented, ~40 % longer and bracketed — "Settings" → "[Šéţţîñĝš ~~~~]". One look at the
// window shows copy that skipped the resources (no brackets), text that gets cut off (no closing
// bracket) and layouts that only fit the language they were drawn in.
//
// Turn it on: browser preview `?pseudo`, or `VITE_PSEUDO_LOCALE=1 pnpm tauri:dev`; then pick
// English in Settings (the accents and the length only mean something over the longest copy).
// src/i18n/index.ts registers it only when import.meta.env.DEV, so release builds never run it.

const ACCENTS: Record<string, string> = {
  a: "á",
  b: "ƀ",
  c: "ç",
  d: "ð",
  e: "é",
  f: "ƒ",
  g: "ĝ",
  h: "ĥ",
  i: "î",
  j: "ĵ",
  k: "ķ",
  l: "ļ",
  m: "ɱ",
  n: "ñ",
  o: "ö",
  p: "þ",
  q: "ǫ",
  r: "ŕ",
  s: "š",
  t: "ţ",
  u: "û",
  v: "ṽ",
  w: "ŵ",
  x: "ẋ",
  y: "ý",
  z: "ž",
  A: "Å",
  B: "Ɓ",
  C: "Ç",
  D: "Ð",
  E: "É",
  F: "Ƒ",
  G: "Ĝ",
  H: "Ĥ",
  I: "Î",
  J: "Ĵ",
  K: "Ķ",
  L: "Ļ",
  M: "Ṁ",
  N: "Ñ",
  O: "Ö",
  P: "Þ",
  Q: "Ǫ",
  R: "Ŕ",
  S: "Š",
  T: "Ţ",
  U: "Û",
  V: "Ṽ",
  W: "Ŵ",
  X: "Ẋ",
  Y: "Ý",
  Z: "Ž",
};

/** How much longer than the real copy (German / French run ~30–40 % over English). */
const EXPANSION = 0.4;

/** `<tags>` of <Trans> and leftover `{{vars}}` pass through untouched. */
const KEEP = /(<[^>]*>|\{\{[^}]*\}\})/;

/** Pseudo-localizes one translated string. */
export function pseudoLocalize(value: string): string {
  let length = 0;
  const body = value
    .split(KEEP)
    .map((part, i) => {
      if (i % 2 === 1) return part;
      const chars = [...part];
      length += chars.length;
      return chars.map((c) => ACCENTS[c] ?? c).join("");
    })
    .join("");
  const pad = "~".repeat(Math.ceil(length * EXPANSION));
  return pad ? `[${body} ${pad}]` : `[${body}]`;
}

/** `?pseudo` in the page URL, or VITE_PSEUDO_LOCALE=1 in the dev server's environment. */
export function pseudoRequested(search: string, envFlag: string | undefined): boolean {
  return new URLSearchParams(search).has("pseudo") || envFlag === "1";
}
