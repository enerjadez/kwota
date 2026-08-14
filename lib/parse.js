const MAX_IMAGES = 8;

function parseMoneyToken(raw) {
  let s = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/\s/g, "")
    .replace(/,/g, "");
  if (!s) return null;
  const k = s.endsWith("k");
  if (k) s = s.slice(0, -1);
  const n = parseFloat(s.replace(/[^\d.]/g, ""));
  if (!Number.isFinite(n)) return null;
  return k ? n * 1000 : n;
}

export function heuristicParse(text) {
  const original = String(text || "").trim();
  const result = {
    clientName: "",
    clientPhone: "",
    site: "",
    items: [],
    depositPct: null,
    notes: original,
    warnings: [],
    confidence: "low",
  };
  if (!original) return result;

  const phone = original.match(/(?:\+?27|0)\s*\d(?:[\d\s-]{7,12})\d/);
  if (phone) result.clientPhone = phone[0].replace(/\s+/g, " ").trim();

  const dep =
    original.match(/(\d{1,2})\s*%\s*(?:deposit|dep|down\s*payment)?/i) ||
    original.match(/(?:deposit|dep|down)\s*(?:of\s*)?(\d{1,2})\s*%/i);
  if (dep) {
    const n = Number(dep[1]);
    if (n >= 0 && n <= 100) result.depositPct = n;
  }

  const site =
    original.match(/\b(?:at|@)\s+([^,\n]+?)(?=,|\s+(?:for|supply|install|quote)|$)/i) ||
    original.match(/\bsite\s*[:\-]?\s*([^,\n]+)/i);
  if (site) result.site = site[1].replace(/\s+/g, " ").trim();

  const name =
    original.match(/(?:quote(?:\s+for)?|for)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)/) ||
    original.match(/^([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)\s+(?:at|in|@|,)/);
  if (name) result.clientName = name[1].trim();

  const money = String.raw`(\d{1,3}(?:[ ,]\d{3})+(?:[.,]\d{1,2})?|\d+[.,]\d{1,2}|\d+k|\d+)`;
  const itemRe = new RegExp(String.raw`([^,\n;]+?)\s+(?:r\s*)${money}(?!\s*%)`, "gi");
  let m;
  while ((m = itemRe.exec(original))) {
    const price = parseMoneyToken(m[2]);
    const desc = m[1]
      .replace(/^(?:and|plus|also)\s+/i, "")
      .replace(/\s+/g, " ")
      .trim();
    if (price && price >= 10 && desc.length > 1) {
      result.items.push({
        description: desc,
        qty: 1,
        unit: "each",
        unitPrice: price,
        source: "spoken",
      });
    }
  }

  if (!result.items.length) {
    const loose = [...original.matchAll(new RegExp(String.raw`(?:r\s*)${money}(?!\s*%)`, "gi"))];
    for (const hit of loose) {
      const price = parseMoneyToken(hit[1]);
      if (price && price >= 50) {
        result.items.push({
          description: result.items.length ? "Additional item" : "Job as discussed",
          qty: 1,
          unit: "each",
          unitPrice: price,
          source: "spoken",
        });
      }
    }
  }

  return result;
}

function extractJson(text) {
  const raw = String(text || "").trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1] : raw;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

function grokOutputText(json) {
  if (typeof json.output_text === "string" && json.output_text.trim()) return json.output_text;
  if (json.choices?.[0]?.message?.content) return String(json.choices[0].message.content);
  const parts = [];
  for (const item of json.output || []) {
    if (typeof item === "string") parts.push(item);
    for (const c of item.content || []) {
      if (typeof c === "string") parts.push(c);
      if (c.text) parts.push(c.text);
    }
  }
  return parts.join("\n");
}

function normalizeParsed(parsed, fallbackNotes) {
  const items = Array.isArray(parsed.items)
    ? parsed.items
        .map((i) => ({
          description: String(i.description || "").trim(),
          qty: Number(i.qty) > 0 ? Number(i.qty) : 1,
          unit: String(i.unit || "each"),
          unitPrice: Math.max(0, Number(i.unitPrice) || 0),
          source: String(i.source || ""),
        }))
        .filter((i) => i.description)
    : [];

  const warnings = Array.isArray(parsed.warnings)
    ? parsed.warnings
        .map((w) => ({
          message: String(w.message || w || "").trim(),
          severity: ["error", "warn", "info"].includes(w.severity) ? w.severity : "warn",
        }))
        .filter((w) => w.message)
    : [];

  return {
    clientName: String(parsed.clientName || ""),
    clientPhone: String(parsed.clientPhone || ""),
    site: String(parsed.site || ""),
    items,
    depositPct:
      parsed.depositPct == null || parsed.depositPct === "" ? null : Number(parsed.depositPct),
    notes: String(parsed.notes || fallbackNotes || ""),
    warnings,
    confidence: ["high", "medium", "low"].includes(parsed.confidence)
      ? parsed.confidence
      : "medium",
  };
}

export function addChecks(parsed, { defaultDeposit, imageCount = 0 } = {}) {
  const warnings = [...(parsed.warnings || [])];
  if (!parsed.clientName) {
    warnings.push({ severity: "error", message: "No client name — add it before you send this." });
  }
  if (!parsed.items.length) {
    warnings.push({ severity: "error", message: "No line items. I couldn’t build a quote from that." });
  }
  parsed.items.forEach((i, n) => {
    if (!i.unitPrice) {
      warnings.push({
        severity: "error",
        message: `Line ${n + 1} “${i.description}” has no price.`,
      });
    }
    if (i.source === "guessed") {
      warnings.push({
        severity: "warn",
        message: `Price on “${i.description}” looks guessed — check it.`,
      });
    }
  });
  if (parsed.depositPct == null) {
    parsed.depositPct = defaultDeposit ?? 50;
    warnings.push({
      severity: "info",
      message: `Deposit wasn’t said. I used ${parsed.depositPct}% — change it if that’s wrong.`,
    });
  }
  if (imageCount && !parsed.items.length) {
    warnings.push({
      severity: "warn",
      message: "Photos came through but I still couldn’t read a job off them.",
    });
  }
  const errors = warnings.filter((w) => w.severity === "error").length;
  parsed.warnings = warnings;
  parsed.okToCreate = errors === 0 && parsed.items.length > 0;
  return parsed;
}

function buildPrompt({ text, trade, imageCount }) {
  return `You are quoting for a South African ${trade || "trades"} business.
Read the voice/text AND every photo (nameplates, site pics, WhatsApp screenshots, handwritten notes, old geysers, meter boxes).
Build a DRAFT quote. It will be checked by a human before anything is created.

Return ONLY JSON:
{
  "clientName": "",
  "clientPhone": "",
  "site": "",
  "items": [{ "description": "", "qty": 1, "unit": "each", "unitPrice": 0, "source": "spoken|photo|guessed" }],
  "depositPct": null,
  "notes": "",
  "warnings": [{ "message": "", "severity": "error|warn|info" }],
  "confidence": "high|medium|low"
}

Rules:
- unitPrice is Rand, number only. "48k" = 48000. "R 12 500" = 12500.
- qty defaults to 1. unit is one of: each, set, m, m2, l, kg, hour, day, week.
- Do NOT invent a client, phone, site, or price. If a nameplate shows a model, put the model in the description.
- If you had to estimate a price, source="guessed" and add a warning.
- If a photo is unreadable, say so in warnings. Do not fake what you cannot see.
- depositPct only if they said a percent. Otherwise null.
- notes: timing, exclusions, extras, what you saw in photos.
- ${imageCount} photo(s) attached.

Voice / notes:
"""${String(text || "").slice(0, 6000)}"""`;
}

export async function grokParse({ text, images = [], trade = "trades" }, key) {
  const safeImages = (images || [])
    .map((img) => String(img || "").trim())
    .filter((img) => /^data:image\/(jpeg|jpg|png)/i.test(img))
    .slice(0, MAX_IMAGES);

  const prompt = buildPrompt({ text, trade, imageCount: safeImages.length });
  const content = [
    ...safeImages.map((url) => ({
      type: "input_image",
      image_url: url,
      detail: "high",
    })),
    { type: "input_text", text: prompt },
  ];

  const r = await fetch("https://api.x.ai/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "grok-4.6",
      input: [{ role: "user", content }],
    }),
    signal: AbortSignal.timeout(120000),
  });

  if (!r.ok) {
    const err = await r.text().catch(() => "");
    // Fallback: chat completions, OpenAI image shape
    const c = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "grok-4.6",
        temperature: 0.1,
        messages: [
          { role: "system", content: "You extract structured trade quotes. Reply with JSON only." },
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              ...safeImages.map((url) => ({
                type: "image_url",
                image_url: { url, detail: "high" },
              })),
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(120000),
    });
    if (!c.ok) {
      const err2 = await c.text().catch(() => "");
      throw new Error(`AI parse failed (${r.status}/${c.status}) ${(err || err2).slice(0, 200)}`);
    }
    const json = await c.json();
    const parsed = extractJson(grokOutputText(json));
    if (!parsed) throw new Error("AI returned something that was not a quote.");
    return normalizeParsed(parsed, text);
  }

  const json = await r.json();
  const parsed = extractJson(grokOutputText(json));
  if (!parsed) throw new Error("AI returned something that was not a quote.");
  return normalizeParsed(parsed, text);
}

export async function transcribeAudio(buf, { filename = "note.webm", mime = "audio/webm" }, key) {
  const form = new FormData();
  form.append("file", new Blob([buf], { type: mime }), filename);
  const r = await fetch("https://api.x.ai/v1/stt", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
    signal: AbortSignal.timeout(90000),
  });
  if (!r.ok) {
    const err = await r.text().catch(() => "");
    throw new Error(`Voice transcript failed (${r.status}) ${err.slice(0, 160)}`);
  }
  const json = await r.json();
  const text = json.text || json.transcript || json.result?.text || "";
  if (!String(text).trim()) throw new Error("Voice came back empty.");
  return String(text).trim();
}

export async function parseQuoteInput({ text, images, trade, defaultDeposit } = {}) {
  const key = process.env.XAI_API_KEY;
  const imageCount = (images || []).length;
  if (key && (String(text || "").trim() || imageCount)) {
    try {
      const ai = await grokParse({ text, images, trade }, key);
      return { source: "ai", ...addChecks(ai, { defaultDeposit, imageCount }) };
    } catch (e) {
      const fb = heuristicParse(text);
      return {
        source: "heuristic",
        error: e.message,
        ...addChecks(fb, { defaultDeposit, imageCount }),
      };
    }
  }
  return {
    source: "heuristic",
    ...addChecks(heuristicParse(text), { defaultDeposit, imageCount }),
  };
}

export { MAX_IMAGES };
