// Deterministic red-flag check that runs on every note BEFORE any model call. A language model
// is never the thing standing between a family and an emergency number: if a note describes a
// possible emergency, the app says so immediately, offline, with no inference involved.

const RULES = [
  { id: "chest", label: "chest pain or pressure", re: /\b(chest (pain|pressure|tightness)|pain in (her|his|the) chest|pijn op de borst)\b/i },
  { id: "breathing", label: "trouble breathing", re: /\b(can'?t breathe|cannot breathe|struggling to breathe|short(ness)? of breath|gasping|blue lips)\b/i },
  { id: "stroke", label: "possible stroke signs", re: /\b(face (is )?droop\w*|drooping (face|mouth)|slurred speech|speech (was|is) slurred|sudden(ly)? (weak|numb)\w*|can'?t (lift|raise) (her|his|one) arm)\b/i },
  { id: "unresponsive", label: "unresponsive or fainted", re: /\b(unresponsive|unconscious|passed out|fainted|won'?t wake|would not wake|blacked out)\b/i },
  { id: "head", label: "fall with a head injury", re: /\b(fell|fall|fallen)\b[^.]{0,60}\b(hit|bumped|struck|cut) (her|his|the)? ?head\b|\bhead injury\b/i },
  { id: "bleeding", label: "heavy bleeding", re: /\b(heavy|won'?t stop|wouldn'?t stop|uncontrolled) bleed\w*|\bbleeding (heavily|a lot)\b/i },
  { id: "selfharm", label: "talk of self-harm", re: /\b(want(s|ed)? to die|kill (her|him|my)self|end (it|her life|his life)|suicid\w*|self[- ]harm)\b/i },
  { id: "confusion", label: "sudden severe confusion", re: /\b(suddenly (very )?confused|didn'?t recogni[sz]e (me|us)|did not recogni[sz]e (me|us)|delirious)\b/i },
];

export function redFlags(text) {
  if (!text) return [];
  return RULES.filter((r) => r.re.test(text)).map(({ id, label }) => ({ id, label }));
}

export const EMERGENCY_ADVICE = {
  number: "112",
  text: "This note mentions something that can be an emergency. If it is happening now, call 112 (EU emergency number) or your local emergency number. Hearthnote has saved the note, but it is not a medical service.",
};
