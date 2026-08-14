import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { networkInterfaces } from "os";

const ALPH = "abcdefghjkmnpqrstuvwxyz23456789";

export function nid(n = 8) {
  const b = randomBytes(n);
  let s = "";
  for (let i = 0; i < n; i++) s += ALPH[b[i] % ALPH.length];
  return s;
}

export function nowIso() {
  return new Date().toISOString();
}

export function roundMoney(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export function totals(items, vatMode, depositPct) {
  const subtotal = roundMoney(
    (items || []).reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.unitPrice) || 0), 0)
  );
  let vat = 0;
  let total = subtotal;
  if (vatMode === "add") {
    vat = roundMoney(subtotal * 0.15);
    total = roundMoney(subtotal + vat);
  } else if (vatMode === "none") {
    vat = 0;
    total = subtotal;
  } else {
    vat = roundMoney(subtotal - subtotal / 1.15);
    total = subtotal;
  }
  const depositAmount = roundMoney(total * (Number(depositPct) || 0) / 100);
  return { subtotal, vat, total, depositAmount };
}

export function hashPin(pin) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(String(pin), salt, 32).toString("hex");
  return `${salt}:${hash}`;
}

export function checkPin(pin, stored) {
  if (!stored || !pin) return false;
  const [salt, hash] = String(stored).split(":");
  if (!salt || !hash) return false;
  const next = scryptSync(String(pin), salt, 32);
  const prev = Buffer.from(hash, "hex");
  if (next.length !== prev.length) return false;
  return timingSafeEqual(next, prev);
}

/** SA phones → 27XXXXXXXXX digits only. */
export function normPhone(raw) {
  let d = String(raw || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("27")) return d;
  if (d.startsWith("0")) return "27" + d.slice(1);
  if (d.length === 9) return "27" + d;
  return d;
}

export function prettyPhone(raw) {
  const d = normPhone(raw);
  if (d.startsWith("27") && d.length === 11) {
    return `0${d.slice(2, 4)} ${d.slice(4, 7)} ${d.slice(7)}`;
  }
  return raw || "";
}

export function waDigits(raw) {
  return normPhone(raw);
}

export function loadEnv(filePath, fs) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 1) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (k && process.env[k] == null) process.env[k] = v;
  }
}

export function localIps() {
  const found = [];
  const nets = networkInterfaces();
  for (const list of Object.values(nets)) {
    for (const n of list || []) {
      if (n.family !== "IPv4" || n.internal) continue;
      if (!found.includes(n.address)) found.push(n.address);
    }
  }
  return found;
}

export function publicBase(req) {
  if (process.env.BASE_URL) return process.env.BASE_URL.replace(/\/$/, "");
  const proto = (req.headers["x-forwarded-proto"] || req.protocol || "http").split(",")[0].trim();
  const host = (req.headers["x-forwarded-host"] || req.headers.host || "localhost:7744")
    .split(",")[0]
    .trim();
  return `${proto}://${host}`;
}

export function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i < 1) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function cookieHeader(name, value, { maxAge = 60 * 60 * 24 * 30, clear = false } = {}) {
  if (clear) return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

export function monthKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function isExpired(quote) {
  if (!quote || ["paid", "accepted", "declined"].includes(quote.status)) return false;
  const days = Number(quote.validDays) || 14;
  const start = new Date(quote.sentAt || quote.createdAt).getTime();
  return Date.now() > start + days * 86400000;
}

export function publicStatus(quote) {
  if (quote.status === "paid") return "paid";
  if (quote.status === "accepted") return "accepted";
  if (quote.status === "declined") return "declined";
  if (isExpired(quote)) return "expired";
  if (quote.status === "sent") return "sent";
  return quote.status || "draft";
}

export const TRADES = [
  "Heat pumps",
  "Aircon",
  "Electrical",
  "Plumbing",
  "Scaffolding",
  "Building",
  "Roofing",
  "Solar",
  "Landscaping",
  "Other",
];

export const TRADE_TEMPLATES = {
  "Heat pumps": [
    { description: "Supply & install heat pump", qty: 1, unit: "each" },
    { description: "Pipework, fittings & trunking", qty: 1, unit: "set" },
    { description: "Electrical isolator & connection", qty: 1, unit: "each" },
    { description: "Remove & dispose old geyser / unit", qty: 1, unit: "each" },
  ],
  Aircon: [
    { description: "Supply & install split unit", qty: 1, unit: "each" },
    { description: "Copper pair coil & trunking", qty: 1, unit: "set" },
    { description: "Electrical isolator", qty: 1, unit: "each" },
  ],
  Electrical: [
    { description: "Labour", qty: 1, unit: "hour" },
    { description: "Materials", qty: 1, unit: "set" },
    { description: "COC / certificate of compliance", qty: 1, unit: "each" },
  ],
  Plumbing: [
    { description: "Call-out & labour", qty: 1, unit: "each" },
    { description: "Parts & fittings", qty: 1, unit: "set" },
  ],
  Scaffolding: [
    { description: "Supply, deliver & erect scaffold", qty: 1, unit: "set" },
    { description: "Weekly hire", qty: 1, unit: "week" },
    { description: "Dismantle & collect", qty: 1, unit: "set" },
  ],
  Building: [
    { description: "Labour", qty: 1, unit: "day" },
    { description: "Materials", qty: 1, unit: "set" },
    { description: "Skip / rubble removal", qty: 1, unit: "each" },
  ],
  Roofing: [
    { description: "Supply & fit sheeting", qty: 1, unit: "m2" },
    { description: "Labour", qty: 1, unit: "day" },
    { description: "Waterproofing / flashings", qty: 1, unit: "set" },
  ],
  Solar: [
    { description: "Supply & install solar system", qty: 1, unit: "set" },
    { description: "Mounting & rail", qty: 1, unit: "set" },
    { description: "Electrical connection & COC", qty: 1, unit: "each" },
  ],
  Landscaping: [
    { description: "Labour", qty: 1, unit: "day" },
    { description: "Plants / materials", qty: 1, unit: "set" },
  ],
  Other: [{ description: "Labour & materials", qty: 1, unit: "each" }],
};

export const UNITS = ["each", "set", "m", "m2", "l", "kg", "hour", "day", "week"];
