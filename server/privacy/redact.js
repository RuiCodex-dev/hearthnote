// The privacy gate. Before any text leaves the server for Token Factory, names of the care
// circle, private terms the family listed, and identifier-shaped strings (phone numbers,
// e-mail, Belgian national register numbers, IBANs, street addresses, birth dates) are
// replaced with stable placeholders. Model output is re-identified locally on the way back.
//
// The model therefore reasons about "[P1]'s dizziness after starting amlodipine" and never
// sees who [P1] is or where she lives.

const PATTERNS = [
  ["EMAIL", /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi],
  ["IBAN", /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,3})?\b/g],
  // Belgian national register number: YY.MM.DD-XXX.XX (separators optional).
  ["NATIONAL_ID", /\b\d{2}[.\s]?\d{2}[.\s]?\d{2}[-\s]\d{3}[.\s]?\d{2}\b/g],
  ["PHONE", /(?:\+|00)\d{2}[\s./-]?\(?0?\)?\d{1,4}(?:[\s./-]?\d{2,4}){2,4}|\b0\d{1,3}(?:[\s./-]?\d{2,3}){3,4}\b/g],
  ["DOB", /\b(?:born|dob|date of birth|geboren|née?)\b[^.\n]{0,12}?\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/gi],
  ["ADDRESS", /\b[\p{Lu}][\p{L}'-]*(?:straat|laan|steenweg|plein|weg|lei|dreef|kaai|rue|avenue|boulevard|chaussée|street|road|lane)\s+\d+[a-z]?(?:\s*(?:bus|box|bte)\s*\d+)?\b/giu],
  ["ADDRESS", /\b(?:rue|avenue|boulevard|chaussée|place)\s+(?:de\s+la\s+|du\s+|des\s+|de\s+)?[\p{Lu}][\p{L}'-]+\s+\d+[a-z]?\b/gu],
];

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function createRedactor({ people = [], privateTerms = [] } = {}) {
  // people: [{ token: "P1", names: ["Mireille", "Mireille Peeters"], role: "mum, 81" }]
  const nameRules = [];
  for (const p of people) {
    for (const n of [...(p.names || [])].sort((a, b) => b.length - a.length)) {
      if (n && n.trim().length >= 2) nameRules.push({ re: new RegExp(`(?<![\\p{L}\\p{N}])${escape(n.trim())}(?![\\p{L}\\p{N}])`, "giu"), token: `[${p.token}]` });
    }
  }
  const termRules = privateTerms
    .filter((t) => t && t.text && t.text.trim().length >= 2)
    .map((t, i) => ({ re: new RegExp(`(?<![\\p{L}\\p{N}])${escape(t.text.trim())}(?![\\p{L}\\p{N}])`, "giu"), token: `[${t.token || `PRIVATE${i + 1}`}]`, original: t.text.trim() }));

  function redact(text) {
    if (!text) return { text: "", found: [] };
    let out = String(text);
    const found = [];
    const counters = {};
    const seen = new Map();
    // Identifier shapes first, so a name inside an e-mail address goes out as part of [EMAIL1]
    // and comes back exactly as written.
    for (const [kind, re] of PATTERNS) {
      out = out.replace(re, (m) => {
        if (/^\[[A-Z]+\d*\]$/.test(m)) return m;
        const key = `${kind}:${m}`;
        if (!seen.has(key)) {
          counters[kind] = (counters[kind] || 0) + 1;
          seen.set(key, `[${kind}${counters[kind]}]`);
        }
        const token = seen.get(key);
        found.push({ kind: kind.toLowerCase(), token, original: m });
        return token;
      });
    }
    for (const r of termRules) out = out.replace(r.re, () => (found.push({ kind: "private", token: r.token }), r.token));
    for (const r of nameRules) out = out.replace(r.re, () => (found.push({ kind: "name", token: r.token }), r.token));
    return { text: out, found };
  }

  // Build a reverse map from the people/terms plus whatever identifiers a redaction found.
  function restorer(found = []) {
    const map = new Map();
    for (const p of people) map.set(`[${p.token}]`, p.display || p.names?.[0] || p.token);
    for (const t of termRules) map.set(t.token, t.original);
    for (const f of found) if (f.original) map.set(f.token, f.original);
    const re = /\[(?:P\d+|PRIVATE\d+|EMAIL\d+|IBAN\d+|NATIONAL_ID\d+|PHONE\d+|DOB\d+|ADDRESS\d+|[A-Z_]+\d*)\]/g;
    // Models sometimes drop the brackets ("Bram - P3", "assignee": "P2"); a bare token is
    // restored only when it names a known person or private word.
    const bare = /(?<![\p{L}\p{N}\[])(P\d+|PRIVATE\d+)(?![\p{L}\p{N}\]])/gu;
    const restoreString = (s) => s.replace(re, (tok) => (map.has(tok) ? map.get(tok) : tok)).replace(bare, (tok) => (map.has(`[${tok}]`) ? map.get(`[${tok}]`) : tok));
    const restore = (v) => {
      if (typeof v === "string") return restoreString(v);
      if (Array.isArray(v)) return v.map(restore);
      if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, restore(x)]));
      return v;
    };
    return restore;
  }

  // The legend the model gets: roles, never names.
  function legend() {
    return people.map((p) => `[${p.token}] = ${p.role}`).join("\n");
  }

  return { redact, restorer, legend };
}
