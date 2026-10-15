// Local retrieval for "Ask the care log": a small BM25 over the notes. Retrieval happens on the
// server, so only the handful of relevant notes (redacted) is sent to the model, not the log.
const STOP = new Set("a an and are as at be but by did do does for from had has have he her his how i in is it its me my of on or our she so that the their them then there they this to was we were what when where which who why will with you".split(" "));

export function tokens(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOP.has(t))
    .map((t) => (t.length > 4 ? t.replace(/(ing|ed|es|s)$/, "") : t));
}

export function retrieve(notes, query, k = 8) {
  const q = [...new Set(tokens(query))];
  if (!q.length || !notes.length) return notes.slice(-k);
  const docs = notes.map((n) => tokens(`${n.text} ${n.capture?.summary || ""}`));
  const avg = docs.reduce((s, d) => s + d.length, 0) / docs.length || 1;
  const df = new Map();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) || 0) + 1);
  const N = docs.length;
  const scored = docs.map((d, i) => {
    let score = 0;
    for (const t of q) {
      const tf = d.filter((x) => x === t).length;
      if (!tf) continue;
      const idf = Math.log(1 + (N - (df.get(t) || 0) + 0.5) / ((df.get(t) || 0) + 0.5));
      score += idf * ((tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * (d.length / avg))));
    }
    return { note: notes[i], score };
  });
  const hits = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score).slice(0, k).map((s) => s.note);
  // Always include the two most recent notes so "how was she today?" has something to stand on.
  for (const n of notes.slice(-2)) if (!hits.includes(n)) hits.push(n);
  return hits.sort((a, b) => a.at.localeCompare(b.at));
}
