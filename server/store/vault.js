// Storage. Private mode keeps ONE household in an AES-256-GCM encrypted file on the family's own
// server. Demo mode gives every visitor a short-lived sandbox seeded with a fictional household,
// held in memory only, so judges can try everything without seeing each other's notes.
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function deriveKey(secret, salt) {
  if (/^[A-Za-z0-9+/=_-]{43,44}$/.test(secret)) {
    const raw = Buffer.from(secret, secret.includes("-") || secret.includes("_") ? "base64url" : "base64");
    if (raw.length === 32) return raw;
  }
  return scryptSync(secret, salt, 32);
}

export function seal(obj, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(obj), "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from("HN1"), iv, cipher.getAuthTag(), body]);
}

export function open(buf, key) {
  if (buf.subarray(0, 3).toString() !== "HN1") throw new Error("not a Hearthnote vault");
  const iv = buf.subarray(3, 15);
  const tag = buf.subarray(15, 31);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(buf.subarray(31)), decipher.final()]).toString("utf8"));
}

export class PrivateVault {
  constructor({ dataDir, secret }) {
    mkdirSync(dataDir, { recursive: true });
    this.file = join(dataDir, "household.vault");
    const saltFile = join(dataDir, "vault.salt");
    if (!existsSync(saltFile)) writeFileSync(saltFile, randomBytes(16), { mode: 0o600 });
    let s = secret;
    if (!s) {
      // No key configured: generate one next to the data. Fine for a single-box install; the
      // README tells operators to set HEARTH_VAULT_KEY so the key lives outside the volume.
      const keyFile = join(dataDir, "vault.key");
      if (!existsSync(keyFile)) writeFileSync(keyFile, randomBytes(32).toString("base64"), { mode: 0o600 });
      s = readFileSync(keyFile, "utf8").trim();
      this.generatedKey = true;
    }
    this.key = deriveKey(s, readFileSync(saltFile));
  }

  load() {
    if (!existsSync(this.file)) return null;
    return open(readFileSync(this.file), this.key);
  }

  save(household) {
    const tmp = this.file + ".tmp";
    writeFileSync(tmp, seal(household, this.key), { mode: 0o600 });
    renameSync(tmp, this.file);
  }
}

export class DemoSessions {
  constructor({ seed, ttlMinutes = 180, max = 500 }) {
    this.seed = seed; // () => fresh household
    this.ttl = ttlMinutes * 60_000;
    this.max = max;
    this.map = new Map();
  }

  get(id) {
    const s = id && this.map.get(id);
    if (!s) return null;
    s.seen = Date.now();
    return s;
  }

  create() {
    this.sweep();
    if (this.map.size >= this.max) {
      const oldest = [...this.map.entries()].sort((a, b) => a[1].seen - b[1].seen)[0];
      if (oldest) this.map.delete(oldest[0]);
    }
    const id = randomBytes(18).toString("base64url");
    const s = { id, household: this.seed(), calls: 0, seen: Date.now() };
    this.map.set(id, s);
    return s;
  }

  reset(id) {
    const s = this.map.get(id);
    if (s) s.household = this.seed();
    return s;
  }

  sweep() {
    const cutoff = Date.now() - this.ttl;
    for (const [k, v] of this.map) if (v.seen < cutoff) this.map.delete(k);
  }
}
