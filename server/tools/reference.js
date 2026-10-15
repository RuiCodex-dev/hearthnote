// Reference lookup for the medication-change check. Only the medication NAME leaves the
// server - never a note, a symptom or a person. Uses Tavily web search restricted to public
// health-information sites when a TAVILY_API_KEY is configured; otherwise returns nothing and
// the skill says plainly that no reference was available.
const DOMAINS = ["medlineplus.gov", "nhs.uk", "ema.europa.eu", "mayoclinic.org", "drugs.com"];

export function createReferenceLookup({ apiKey, fetchImpl = globalThis.fetch } = {}) {
  if (!apiKey) return null;
  const cache = new Map();
  return async function lookup(medication) {
    const name = String(medication || "").toLowerCase().replace(/[^a-z0-9 -]/g, "").trim().slice(0, 40);
    if (!name) return [];
    if (cache.has(name)) return cache.get(name);
    const res = await fetchImpl("https://api.tavily.com/search", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ query: `${name} common side effects`, search_depth: "basic", include_domains: DOMAINS, max_results: 4 }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const refs = (data.results || []).slice(0, 4).map((r, i) => ({
      id: `S${i + 1}`,
      title: String(r.title || "").slice(0, 120),
      url: String(r.url || ""),
      content: String(r.content || "").replace(/\s+/g, " ").slice(0, 600),
    }));
    cache.set(name, refs);
    return refs;
  };
}
