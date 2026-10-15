// OpenAI-compatible chat client for Nebius Token Factory, plus the routing between the two
// Nemotron tiers. Every call returns a "receipt" (model, tier, tokens, latency) that the app
// shows to the family, so it is always visible which model handled what.
import { extractJson, stripReasoning, toApiSchema, validate } from "./json.js";
import { createMockProvider } from "./mock.js";

export class LlmError extends Error {
  constructor(message, { status, retryable } = {}) {
    super(message);
    this.status = status;
    this.retryable = Boolean(retryable);
  }
}

export function createProvider(llmConfig, { fetchImpl = globalThis.fetch } = {}) {
  if (llmConfig.provider === "mock") return createMockProvider(llmConfig);
  if (llmConfig.provider !== "nebius") throw new Error(`unknown LLM provider ${llmConfig.provider}`);
  return new NebiusProvider(llmConfig, fetchImpl);
}

class NebiusProvider {
  constructor(cfg, fetchImpl) {
    this.name = "nebius";
    this.cfg = cfg;
    this.fetch = fetchImpl;
    this.base = cfg.baseUrl.endsWith("/") ? cfg.baseUrl : cfg.baseUrl + "/";
    // Per-model memory of which request features the endpoint accepted, so a feature that
    // returns 400 once is not retried on every call.
    this.features = new Map();
    this.resolved = null;
  }

  modelFor(tier) {
    const r = this.resolved || {};
    return tier === "deep" ? r.deep || this.cfg.deepModel : r.fast || this.cfg.fastModel;
  }

  // Ask Token Factory which models exist and make sure both tiers point at a real NVIDIA model.
  // If a configured id is missing (catalogue ids change), pick the closest Nemotron instead of
  // failing at the first user action.
  async resolveModels() {
    const res = await this.fetch(this.base + "models", { headers: this.headers() });
    if (!res.ok) throw new LlmError(`model list failed (${res.status})`, { status: res.status });
    const body = await res.json();
    const ids = (body.data || []).map((m) => m.id);
    const nvidia = ids.filter((id) => /nemotron/i.test(id));
    const pick = (wanted, prefer) => {
      if (ids.includes(wanted)) return wanted;
      const lower = ids.find((id) => id.toLowerCase() === wanted.toLowerCase());
      if (lower) return lower;
      for (const p of prefer) {
        const hit = nvidia.find((id) => p.test(id));
        if (hit) return hit;
      }
      return nvidia[0] || wanted;
    };
    this.resolved = {
      fast: pick(this.cfg.fastModel, [/super/i, /nano/i, /lightning/i]),
      deep: pick(this.cfg.deepModel, [/ultra/i, /super/i]),
      available: nvidia,
    };
    return this.resolved;
  }

  headers() {
    return { authorization: `Bearer ${this.cfg.apiKey}`, "content-type": "application/json", accept: "application/json" };
  }

  async complete({ tier = "fast", system, user, schema, schemaName = "result", temperature = 0.2, maxTokens = 1800 }) {
    const model = this.modelFor(tier);
    const thinking = tier === "deep" ? this.cfg.deepThinking : this.cfg.fastThinking;
    const feat = this.features.get(model) || { format: schema ? "json_schema" : "none", thinkingFlag: true };
    const messages = [
      { role: "system", content: system },
      { role: "user", content: user },
    ];
    const started = Date.now();
    let lastErr;
    for (let attempt = 0; attempt < 4; attempt++) {
      const body = { model, messages, temperature, max_tokens: thinking ? maxTokens + 2500 : maxTokens };
      if (feat.format === "json_schema") body.response_format = { type: "json_schema", json_schema: { name: schemaName, schema: toApiSchema(schema) } };
      else if (feat.format === "json_object") body.response_format = { type: "json_object" };
      if (feat.thinkingFlag) body.chat_template_kwargs = { enable_thinking: thinking };
      let res;
      try {
        res = await this.fetch(this.base + "chat/completions", {
          method: "POST",
          headers: this.headers(),
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.cfg.timeoutMs),
        });
      } catch (err) {
        lastErr = new LlmError(`network error: ${err.name}`, { retryable: true });
        await sleep(800 * (attempt + 1));
        continue;
      }
      if (res.status === 400 || res.status === 422) {
        const detail = (await res.text()).slice(0, 300);
        // Degrade one feature at a time, remembering it for this model.
        if (feat.thinkingFlag && /chat_template_kwargs|enable_thinking|extra/i.test(detail)) feat.thinkingFlag = false;
        else if (feat.format === "json_schema") feat.format = "json_object";
        else if (feat.format === "json_object") feat.format = "none";
        else if (feat.thinkingFlag) feat.thinkingFlag = false;
        else throw new LlmError(`request rejected (${res.status})`, { status: res.status });
        this.features.set(model, feat);
        lastErr = new LlmError(`request rejected (${res.status})`, { status: res.status });
        continue;
      }
      if (res.status === 429 || res.status >= 500) {
        lastErr = new LlmError(`Token Factory busy (${res.status})`, { status: res.status, retryable: true });
        const retryAfter = Number(res.headers.get("retry-after")) || attempt + 1;
        await sleep(Math.min(8000, retryAfter * 1000));
        continue;
      }
      if (!res.ok) throw new LlmError(`Token Factory error (${res.status})`, { status: res.status });
      this.features.set(model, feat);
      const data = await res.json();
      const msg = data.choices?.[0]?.message || {};
      const text = stripReasoning(msg.content || "");
      const receipt = {
        provider: "nebius",
        model: data.model || model,
        tier,
        thinking,
        promptTokens: data.usage?.prompt_tokens ?? null,
        completionTokens: data.usage?.completion_tokens ?? null,
        reasoningChars: (msg.reasoning_content || "").length,
        latencyMs: Date.now() - started,
      };
      if (!schema) return { text, receipt };
      let parsed;
      try {
        parsed = extractJson(text);
      } catch (err) {
        // One repair round: the model sees its own output and the parse error.
        if (attempt < 3 && !messages.some((m) => m.role === "assistant")) {
          messages.push({ role: "assistant", content: text.slice(0, 4000) });
          messages.push({ role: "user", content: "That was not valid JSON. Reply again with only the JSON object that matches the schema." });
          continue;
        }
        throw new LlmError("model did not return JSON");
      }
      const { value, errors } = validate(schema, parsed);
      receipt.schemaWarnings = errors.length;
      return { json: value, text, receipt };
    }
    throw lastErr || new LlmError("Token Factory request failed");
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
