// Turning model text into trusted data: strip reasoning, find the JSON, validate it.

export function stripReasoning(text) {
  if (typeof text !== "string") return "";
  // Hybrid reasoning models may inline their thinking. Keep only what follows it.
  let out = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const open = out.lastIndexOf("<think>");
  if (open !== -1) out = out.slice(0, open);
  return out.trim();
}

export function extractJson(text) {
  const clean = stripReasoning(text);
  const fenced = clean.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [];
  if (fenced) candidates.push(fenced[1]);
  candidates.push(clean);
  const first = clean.indexOf("{");
  const last = clean.lastIndexOf("}");
  if (first !== -1 && last > first) candidates.push(clean.slice(first, last + 1));
  for (const c of candidates) {
    try {
      return JSON.parse(c);
    } catch { /* try the next shape */ }
  }
  throw new Error("model output was not valid JSON");
}

// A deliberately small JSON-schema subset validator (type, properties, required, items, enum,
// maxItems, maxLength). It also COERCES harmless drift (a number where a string is expected,
// a missing optional array) so one quirky field does not throw away a whole capture.
export function validate(schema, value, path = "$") {
  const errors = [];
  const out = walk(schema, value, path, errors);
  return { value: out, errors };
}

function walk(schema, value, path, errors) {
  if (!schema) return value;
  const type = schema.type;
  if (schema.enum) {
    if (!schema.enum.includes(value)) {
      if (schema.default !== undefined) return schema.default;
      errors.push(`${path}: expected one of ${schema.enum.join("|")}`);
      return schema.enum[schema.enum.length - 1];
    }
    return value;
  }
  if (type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      errors.push(`${path}: expected object`);
      value = {};
    }
    const out = {};
    for (const [k, sub] of Object.entries(schema.properties || {})) {
      if (value[k] === undefined || value[k] === null) {
        if ((schema.required || []).includes(k)) {
          if (sub.type === "array") out[k] = [];
          else if (sub.type === "string" && sub.nullable) out[k] = null;
          else errors.push(`${path}.${k}: required`);
        } else if (sub.type === "array") out[k] = [];
        else out[k] = null;
        continue;
      }
      out[k] = walk(sub, value[k], `${path}.${k}`, errors);
    }
    return out;
  }
  if (type === "array") {
    if (!Array.isArray(value)) {
      if (value === undefined || value === null || value === "") return [];
      value = [value];
    }
    const max = schema.maxItems ?? 50;
    return value.slice(0, max).map((v, i) => walk(schema.items, v, `${path}[${i}]`, errors));
  }
  if (type === "string") {
    if (value === null && schema.nullable) return null;
    if (typeof value === "number" || typeof value === "boolean") value = String(value);
    if (typeof value !== "string") {
      errors.push(`${path}: expected string`);
      return "";
    }
    return value.slice(0, schema.maxLength ?? 2000).trim();
  }
  if (type === "integer" || type === "number") {
    const n = Number(value);
    if (!Number.isFinite(n)) {
      errors.push(`${path}: expected number`);
      return schema.minimum ?? 0;
    }
    let v = type === "integer" ? Math.round(n) : n;
    if (schema.minimum !== undefined) v = Math.max(schema.minimum, v);
    if (schema.maximum !== undefined) v = Math.min(schema.maximum, v);
    return v;
  }
  if (type === "boolean") return Boolean(value);
  return value;
}

// The schema the API sees must be plain JSON Schema; strip our private hints.
export function toApiSchema(schema) {
  if (!schema || typeof schema !== "object") return schema;
  if (Array.isArray(schema)) return schema.map(toApiSchema);
  const out = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === "nullable" || k === "default") continue;
    out[k] = toApiSchema(v);
  }
  if (schema.nullable && typeof schema.type === "string") out.type = [schema.type, "null"];
  return out;
}
