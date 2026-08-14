import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import { createStore } from "./lib/store.js";
import { parseQuoteInput, transcribeAudio, MAX_IMAGES } from "./lib/parse.js";
import { ensureDemo } from "./lib/demo.js";
import {
  nid,
  nowIso,
  totals,
  hashPin,
  checkPin,
  normPhone,
  cookieHeader,
  parseCookies,
  publicBase,
  signSession,
  readSession,
  isSecureReq,
  localIps,
  loadEnv,
  TRADES,
  TRADE_TEMPLATES,
  UNITS,
  publicStatus,
  monthKey,
} from "./lib/util.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, "public");
const PORT = Number(process.env.PORT) || 7744;

loadEnv(path.join(ROOT, ".env"), fs);

const DEMO_ONLY = Boolean(process.env.VERCEL) || process.env.KWOTA_DEMO_ONLY === "1";
const store = createStore(path.join(ROOT, "data", "kwota.json"));
ensureDemo(store);
const loginHits = new Map();

function setSession(req, res, businessId) {
  res.setHeader(
    "Set-Cookie",
    cookieHeader("kwota", signSession(businessId), { secure: isSecureReq(req) })
  );
}

function currentBiz(req) {
  const bid = readSession(parseCookies(req).kwota);
  return bid ? store.businessById(bid) : null;
}

function tooManyLogins(phone) {
  const now = Date.now();
  const row = loginHits.get(phone) || [];
  const recent = row.filter((t) => now - t < 10 * 60 * 1000);
  loginHits.set(phone, recent);
  return recent.length >= 8;
}

function hitLogin(phone) {
  const row = loginHits.get(phone) || [];
  row.push(Date.now());
  loginHits.set(phone, row);
}

function safeBiz(b) {
  if (!b) return null;
  const { pinHash, ...rest } = b;
  return rest;
}

function auth(req, res, next) {
  const biz = currentBiz(req);
  if (!biz) return res.status(401).json({ error: "Sign in first." });
  req.biz = biz;
  next();
}

function clientQuote(quote, biz, base) {
  const status = publicStatus(quote);
  return {
    number: quote.number,
    publicId: quote.publicId,
    url: `${base}/q/${quote.publicId}`,
    payUrl: `${base}/pay/${quote.publicId}`,
    status,
    clientName: quote.clientName,
    clientPhone: quote.clientPhone || "",
    site: quote.site,
    notes: quote.notes,
    items: quote.items,
    vatMode: quote.vatMode,
    depositPct: quote.depositPct,
    validDays: quote.validDays,
    subtotal: quote.subtotal,
    vat: quote.vat,
    total: quote.total,
    depositAmount: quote.depositAmount,
    createdAt: quote.createdAt,
    sentAt: quote.sentAt,
    acceptedAt: quote.acceptedAt,
    acceptedBy: quote.acceptedBy,
    declinedAt: quote.declinedAt,
    paidAt: quote.paidAt,
    validUntil: validUntil(quote),
    business: {
      name: biz.name,
      trade: biz.trade,
      city: biz.city,
      phone: biz.phone,
      logoDataUrl: biz.logoDataUrl || "",
      brandColor: biz.brandColor || "#e8a317",
      terms: biz.terms || "",
      paymentLink: biz.paymentLink || "",
      bankName: biz.bankName || "",
      bankAccountName: biz.bankAccountName || "",
      bankAccount: biz.bankAccount || "",
      bankBranch: biz.bankBranch || "",
    },
  };
}

function validUntil(quote) {
  const days = Number(quote.validDays) || 14;
  const start = new Date(quote.sentAt || quote.createdAt).getTime();
  return new Date(start + days * 86400000).toISOString();
}

function applyTotals(quote, biz) {
  const vatMode = quote.vatMode || biz.vatMode || "incl";
  const depositPct = quote.depositPct == null ? biz.depositPct : quote.depositPct;
  const t = totals(quote.items, vatMode, depositPct);
  quote.vatMode = vatMode;
  quote.depositPct = Number(depositPct) || 0;
  Object.assign(quote, t);
}

function sanitizeItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((i) => ({
      id: i.id || nid(6),
      description: String(i.description || "").trim(),
      qty: Number(i.qty) > 0 ? Number(i.qty) : 1,
      unit: UNITS.includes(i.unit) ? i.unit : "each",
      unitPrice: Math.max(0, Number(i.unitPrice) || 0),
    }))
    .filter((i) => i.description);
}

function waMessage(biz, quote, url) {
  const name = quote.clientName || "there";
  const site = quote.site ? ` for ${quote.site}` : "";
  const total = zar(quote.total);
  const dep = zar(quote.depositAmount);
  return (
    `Hi ${name},\n\n` +
    `Quote ${quote.number}${site} is ready:\n${url}\n\n` +
    `Total ${total}\n` +
    `Deposit to book the job: ${dep}\n\n` +
    `Valid ${quote.validDays || 14} days.\n` +
    `${biz.name}`
  );
}

function zar(n) {
  return (
    "R" +
    Number(n || 0).toLocaleString("en-ZA", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.json({ limit: "12mb" }));
app.use(express.static(PUBLIC, { extensions: ["html"] }));

app.get("/api/status", (req, res) => {
  store.pruneSessions();
  res.json({
    ok: true,
    hasBusiness: store.data.businesses.length > 0,
    ai: Boolean(process.env.XAI_API_KEY),
    url: publicBase(req),
    trades: TRADES,
    templates: TRADE_TEMPLATES,
    units: UNITS,
    signedIn: Boolean(currentBiz(req)),
    demo: true,
    demoOnly: DEMO_ONLY,
  });
});

app.post("/api/demo", (req, res) => {
  const biz = ensureDemo(store);
  setSession(req, res, biz.id);
  res.json({ ok: true, business: safeBiz(biz) });
});

app.post("/api/setup", (req, res) => {
  if (DEMO_ONLY) {
    return res.status(403).json({ error: "This hosted link is the shared demo. Open the demo — don’t create a live company here." });
  }
  const body = req.body || {};
  const name = String(body.name || "").trim();
  const trade = TRADES.includes(body.trade) ? body.trade : "Other";
  const phone = normPhone(body.phone);
  const pin = String(body.pin || "").trim();
  if (!name) return res.status(400).json({ error: "Business name is required." });
  if (!phone || phone.length < 10) {
    return res.status(400).json({ error: "WhatsApp number looks short." });
  }
  if (!/^\d{4,8}$/.test(pin)) {
    return res.status(400).json({ error: "PIN must be 4–8 digits." });
  }
  if (store.businessByPhone(phone)) {
    return res.status(409).json({ error: "That WhatsApp already has an account. Sign in." });
  }

  const biz = {
    id: nid(10),
    name,
    trade,
    phone,
    pinHash: hashPin(pin),
    city: String(body.city || "").trim(),
    depositPct: clampPct(body.depositPct, 50),
    validDays: Math.min(90, Math.max(1, Number(body.validDays) || 14)),
    vatMode: ["incl", "add", "none"].includes(body.vatMode) ? body.vatMode : "incl",
    paymentLink: String(body.paymentLink || "").trim(),
    bankName: String(body.bankName || "").trim(),
    bankAccountName: String(body.bankAccountName || "").trim(),
    bankAccount: String(body.bankAccount || "").trim(),
    bankBranch: String(body.bankBranch || "").trim(),
    terms: String(body.terms || defaultTerms(trade)).trim(),
    logoDataUrl: safeLogo(body.logoDataUrl),
    brandColor: safeColor(body.brandColor),
    nextNo: 1,
    createdAt: nowIso(),
  };
  store.data.businesses.push(biz);
  setSession(req, res, biz.id);
  res.json({ ok: true, business: safeBiz(biz) });
});

app.post("/api/login", (req, res) => {
  const phone = normPhone(req.body?.phone);
  const pin = String(req.body?.pin || "").trim();
  if (tooManyLogins(phone)) {
    return res.status(429).json({ error: "Too many tries. Wait 10 minutes." });
  }
  hitLogin(phone);
  const biz = store.businessByPhone(phone);
  if (!biz || !checkPin(pin, biz.pinHash)) {
    return res.status(401).json({ error: "Wrong number or PIN." });
  }
  setSession(req, res, biz.id);
  res.json({ ok: true, business: safeBiz(biz) });
});

app.post("/api/logout", (req, res) => {
  res.setHeader("Set-Cookie", cookieHeader("kwota", "", { clear: true, secure: isSecureReq(req) }));
  res.json({ ok: true });
});

app.get("/api/me", auth, (req, res) => {
  res.json({ business: safeBiz(req.biz), ai: Boolean(process.env.XAI_API_KEY) });
});

app.patch("/api/me", auth, (req, res) => {
  const body = req.body || {};
  const biz = req.biz;
  if (body.name != null) biz.name = String(body.name).trim() || biz.name;
  if (body.trade && TRADES.includes(body.trade)) biz.trade = body.trade;
  if (body.city != null) biz.city = String(body.city).trim();
  if (body.depositPct != null) biz.depositPct = clampPct(body.depositPct, biz.depositPct);
  if (body.validDays != null) {
    biz.validDays = Math.min(90, Math.max(1, Number(body.validDays) || biz.validDays));
  }
  if (["incl", "add", "none"].includes(body.vatMode)) biz.vatMode = body.vatMode;
  if (body.paymentLink != null) biz.paymentLink = String(body.paymentLink).trim();
  if (body.bankName != null) biz.bankName = String(body.bankName).trim();
  if (body.bankAccountName != null) biz.bankAccountName = String(body.bankAccountName).trim();
  if (body.bankAccount != null) biz.bankAccount = String(body.bankAccount).trim();
  if (body.bankBranch != null) biz.bankBranch = String(body.bankBranch).trim();
  if (body.terms != null) biz.terms = String(body.terms).trim();
  if (body.logoDataUrl != null) biz.logoDataUrl = safeLogo(body.logoDataUrl);
  if (body.brandColor) biz.brandColor = safeColor(body.brandColor);
  if (body.phone) {
    const phone = normPhone(body.phone);
    const clash = store.businessByPhone(phone);
    if (clash && clash.id !== biz.id) {
      return res.status(409).json({ error: "That WhatsApp is on another account." });
    }
    if (phone.length >= 10) biz.phone = phone;
  }
  if (body.pin) {
    const pin = String(body.pin).trim();
    if (!/^\d{4,8}$/.test(pin)) {
      return res.status(400).json({ error: "PIN must be 4–8 digits." });
    }
    biz.pinHash = hashPin(pin);
  }
  store.save();
  res.json({ business: safeBiz(biz) });
});

app.get("/api/quotes", auth, (req, res) => {
  const list = store.quotesFor(req.biz.id).map((q) => ({
    id: q.id,
    publicId: q.publicId,
    number: q.number,
    status: publicStatus(q),
    clientName: q.clientName,
    clientPhone: q.clientPhone,
    site: q.site,
    total: q.total,
    depositAmount: q.depositAmount,
    createdAt: q.createdAt,
    acceptedAt: q.acceptedAt,
    paidAt: q.paidAt,
  }));
  const mk = monthKey();
  const month = store.quotesFor(req.biz.id).filter((q) => (q.createdAt || "").startsWith(mk));
  const stats = {
    quoted: month.reduce((s, q) => s + (q.total || 0), 0),
    quotedCount: month.length,
    accepted: month
      .filter((q) => ["accepted", "paid"].includes(publicStatus(q)))
      .reduce((s, q) => s + (q.total || 0), 0),
    deposits: month
      .filter((q) => q.status === "paid")
      .reduce((s, q) => s + (q.depositAmount || 0), 0),
    waiting: list.filter((q) => q.status === "sent").length,
  };
  res.json({ quotes: list, stats });
});

app.get("/api/quotes/:id", auth, (req, res) => {
  const q = store.quoteById(req.params.id);
  if (!q || q.businessId !== req.biz.id) return res.status(404).json({ error: "Quote not found." });
  const base = publicBase(req);
  res.json({
    quote: { ...q, status: publicStatus(q), url: `${base}/q/${q.publicId}` },
    wa: waHref(req.biz, q, `${base}/q/${q.publicId}`),
  });
});

app.post("/api/quotes", auth, (req, res) => {
  const body = req.body || {};
  const items = sanitizeItems(body.items);
  if (!items.length) return res.status(400).json({ error: "Add at least one line item." });
  const quote = {
    id: nid(10),
    publicId: nid(10),
    businessId: req.biz.id,
    number: store.nextQuoteNo(req.biz.id),
    status: "draft",
    clientName: String(body.clientName || "").trim(),
    clientPhone: normPhone(body.clientPhone),
    site: String(body.site || "").trim(),
    notes: String(body.notes || "").trim(),
    items,
    validDays: Math.min(90, Math.max(1, Number(body.validDays) || req.biz.validDays || 14)),
    vatMode: ["incl", "add", "none"].includes(body.vatMode) ? body.vatMode : req.biz.vatMode,
    depositPct: body.depositPct == null ? req.biz.depositPct : clampPct(body.depositPct, 50),
    createdAt: nowIso(),
    sentAt: null,
    acceptedAt: null,
    acceptedBy: "",
    declinedAt: null,
    declineReason: "",
    paidAt: null,
  };
  applyTotals(quote, req.biz);
  store.data.quotes.push(quote);
  store.save();
  const base = publicBase(req);
  res.json({
    quote: { ...quote, url: `${base}/q/${quote.publicId}` },
    wa: waHref(req.biz, quote, `${base}/q/${quote.publicId}`),
  });
});

app.patch("/api/quotes/:id", auth, (req, res) => {
  const q = store.quoteById(req.params.id);
  if (!q || q.businessId !== req.biz.id) return res.status(404).json({ error: "Quote not found." });
  if (["paid", "declined"].includes(q.status)) {
    return res.status(400).json({ error: "This quote is locked." });
  }
  const body = req.body || {};
  if (body.clientName != null) q.clientName = String(body.clientName).trim();
  if (body.clientPhone != null) q.clientPhone = normPhone(body.clientPhone);
  if (body.site != null) q.site = String(body.site).trim();
  if (body.notes != null) q.notes = String(body.notes).trim();
  if (body.items) q.items = sanitizeItems(body.items);
  if (body.validDays != null) {
    q.validDays = Math.min(90, Math.max(1, Number(body.validDays) || q.validDays));
  }
  if (["incl", "add", "none"].includes(body.vatMode)) q.vatMode = body.vatMode;
  if (body.depositPct != null) q.depositPct = clampPct(body.depositPct, q.depositPct);
  applyTotals(q, req.biz);
  store.save();
  const base = publicBase(req);
  res.json({
    quote: { ...q, status: publicStatus(q), url: `${base}/q/${q.publicId}` },
    wa: waHref(req.biz, q, `${base}/q/${q.publicId}`),
  });
});

app.post("/api/quotes/:id/send", auth, (req, res) => {
  const q = store.quoteById(req.params.id);
  if (!q || q.businessId !== req.biz.id) return res.status(404).json({ error: "Quote not found." });
  if (q.status === "draft") {
    q.status = "sent";
    q.sentAt = nowIso();
    store.save();
  }
  const base = publicBase(req);
  const url = `${base}/q/${q.publicId}`;
  res.json({ ok: true, url, wa: waHref(req.biz, q, url), quote: { ...q, status: publicStatus(q), url } });
});

app.post("/api/quotes/:id/paid", auth, (req, res) => {
  const q = store.quoteById(req.params.id);
  if (!q || q.businessId !== req.biz.id) return res.status(404).json({ error: "Quote not found." });
  q.status = "paid";
  q.paidAt = nowIso();
  if (!q.acceptedAt) {
    q.acceptedAt = q.paidAt;
    q.acceptedBy = q.acceptedBy || q.clientName || "Client";
  }
  store.save();
  res.json({ quote: { ...q, status: "paid" } });
});

app.post("/api/quotes/:id/duplicate", auth, (req, res) => {
  const src = store.quoteById(req.params.id);
  if (!src || src.businessId !== req.biz.id) return res.status(404).json({ error: "Quote not found." });
  const quote = {
    ...src,
    id: nid(10),
    publicId: nid(10),
    number: store.nextQuoteNo(req.biz.id),
    status: "draft",
    createdAt: nowIso(),
    sentAt: null,
    acceptedAt: null,
    acceptedBy: "",
    declinedAt: null,
    declineReason: "",
    paidAt: null,
    items: src.items.map((i) => ({ ...i, id: nid(6) })),
  };
  applyTotals(quote, req.biz);
  store.data.quotes.push(quote);
  store.save();
  res.json({ quote });
});

app.post("/api/parse", auth, async (req, res) => {
  const text = String(req.body?.text || "").trim();
  const images = Array.isArray(req.body?.images) ? req.body.images.slice(0, MAX_IMAGES) : [];
  const sheets = Array.isArray(req.body?.sheets) ? req.body.sheets.slice(0, 3) : [];
  if (!text && !images.length && !sheets.length) {
    return res.status(400).json({ error: "Drop a voice note, text, photos, or an Excel file first." });
  }
  try {
    const parsed = await parseQuoteInput({
      text,
      images,
      sheets,
      trade: req.biz.trade,
      defaultDeposit: req.biz.depositPct,
    });
    res.json(parsed);
  } catch (e) {
    res.status(500).json({ error: e.message || "Parse failed." });
  }
});

app.post("/api/transcribe", auth, async (req, res) => {
  const key = process.env.XAI_API_KEY;
  if (!key) return res.status(400).json({ error: "Voice AI is off." });
  const dataUrl = String(req.body?.audio || "");
  const m = dataUrl.match(/^data:(audio\/[a-z0-9.+-]+);base64,(.+)$/i);
  if (!m) return res.status(400).json({ error: "That recording didn’t come through." });
  try {
    const buf = Buffer.from(m[2], "base64");
    if (buf.length > 8_000_000) return res.status(400).json({ error: "Recording is too long." });
    const ext = m[1].includes("mpeg") || m[1].includes("mp3") ? "mp3" : m[1].includes("wav") ? "wav" : "webm";
    const text = await transcribeAudio(buf, { filename: `note.${ext}`, mime: m[1] }, key);
    res.json({ text });
  } catch (e) {
    res.status(500).json({ error: e.message || "Could not hear that." });
  }
});

app.get("/api/public/:publicId", (req, res) => {
  const q = store.quoteByPublic(req.params.publicId);
  if (!q) return res.status(404).json({ error: "Quote not found." });
  const biz = store.businessById(q.businessId);
  if (!biz) return res.status(404).json({ error: "Quote not found." });
  res.json({ quote: clientQuote(q, biz, publicBase(req)) });
});

app.post("/api/public/:publicId/accept", (req, res) => {
  const q = store.quoteByPublic(req.params.publicId);
  if (!q) return res.status(404).json({ error: "Quote not found." });
  const biz = store.businessById(q.businessId);
  const status = publicStatus(q);
  if (status === "expired") return res.status(400).json({ error: "This quote has expired." });
  if (status === "declined") return res.status(400).json({ error: "This quote was declined." });
  const name = String(req.body?.name || "").trim();
  if (name.length < 2) return res.status(400).json({ error: "Type your name to accept." });
  if (q.status === "draft") {
    q.status = "sent";
    q.sentAt = nowIso();
  }
  if (q.status !== "paid") q.status = "accepted";
  q.acceptedAt = nowIso();
  q.acceptedBy = name;
  store.save();
  res.json({ quote: clientQuote(q, biz, publicBase(req)) });
});

app.post("/api/public/:publicId/decline", (req, res) => {
  const q = store.quoteByPublic(req.params.publicId);
  if (!q) return res.status(404).json({ error: "Quote not found." });
  const status = publicStatus(q);
  if (["paid", "accepted"].includes(status)) {
    return res.status(400).json({ error: "Already accepted." });
  }
  q.status = "declined";
  q.declinedAt = nowIso();
  q.declineReason = String(req.body?.reason || "").trim();
  store.save();
  const biz = store.businessById(q.businessId);
  res.json({ quote: clientQuote(q, biz, publicBase(req)) });
});

app.post("/api/public/:publicId/pay", (req, res) => {
  const q = store.quoteByPublic(req.params.publicId);
  if (!q) return res.status(404).json({ error: "Quote not found." });
  const biz = store.businessById(q.businessId);
  const status = publicStatus(q);
  if (status === "expired") return res.status(400).json({ error: "This quote has expired." });
  if (status === "declined") return res.status(400).json({ error: "This quote was declined." });
  const method = String(req.body?.method || "eft").slice(0, 24);
  if (q.status === "draft") {
    q.status = "sent";
    q.sentAt = nowIso();
  }
  if (!q.acceptedAt) {
    q.acceptedAt = nowIso();
    q.acceptedBy = q.acceptedBy || q.clientName || "Client";
  }
  q.status = "paid";
  q.paidAt = nowIso();
  q.paidMethod = method;
  store.save();
  res.json({ quote: clientQuote(q, biz, publicBase(req)), demo: true });
});

app.get("/q/:publicId", (req, res) => {
  res.sendFile(path.join(PUBLIC, "q.html"));
});

app.get("/pay/:publicId", (req, res) => {
  res.sendFile(path.join(PUBLIC, "pay.html"));
});

app.use((req, res, next) => {
  if (req.method !== "GET" || req.path.startsWith("/api/")) return next();
  res.sendFile(path.join(PUBLIC, "index.html"));
});

function waHref(biz, quote, url) {
  const msg = waMessage(biz, quote, url);
  const phone = quote.clientPhone || "";
  const href = phone
    ? `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`
    : `https://wa.me/?text=${encodeURIComponent(msg)}`;
  return { href, message: msg, phone };
}

function clampPct(v, fallback = 50) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(100, Math.max(0, Math.round(n)));
}

function safeColor(c) {
  return /^#[0-9a-fA-F]{6}$/.test(String(c || "")) ? String(c) : "#e8a317";
}

function safeLogo(raw) {
  const s = String(raw || "");
  if (!s) return "";
  if (!s.startsWith("data:image/")) return "";
  if (s.length > 1_800_000) return "";
  return s;
}

function defaultTerms(trade) {
  return (
    `50% deposit secures the date. Balance due on completion. ` +
    `Quote valid as stated. ${trade} workmanship guaranteed for 12 months. ` +
    `Manufacturer warranty applies to supplied equipment. ` +
    `Unforeseen extras (hidden pipework, extra trunking, council, COC upgrades) quoted before we proceed.`
  );
}

export default app;

if (!process.env.VERCEL) {
  const server = app.listen(PORT, "0.0.0.0", () => {
    const ips = localIps();
    console.log("");
    console.log("  KWOTA  ·  quotes that get you the deposit");
    console.log("  -----------------------------------------");
    console.log(`  This PC     http://localhost:${PORT}`);
    for (const ip of ips) console.log(`  Phone       http://${ip}:${PORT}`);
    console.log("");
    console.log("  Leave this window open. Close it to stop.");
    if (process.env.XAI_API_KEY) console.log("  Voice AI    on");
    else console.log("  Voice AI    off  (add XAI_API_KEY to .env to turn messy notes into line items)");
    console.log("");
  });

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(`Port ${PORT} is already in use. Close the other KWOTA window.`);
    } else {
      console.error(err);
    }
    process.exit(1);
  });
}
