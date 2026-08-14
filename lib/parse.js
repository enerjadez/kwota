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
      result.items.push({ description: desc, qty: 1, unit: "each", unitPrice: price });
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

export async function grokParse(text, key) {
  const prompt = `Turn a South African tradesperson's messy voice note or text into a structured job quote.

Return ONLY JSON with this shape:
{
  "clientName": "",
  "clientPhone": "",
  "site": "",
  "items": [{ "description": "", "qty": 1, "unit": "each", "unitPrice": 0 }],
  "depositPct": null,
  "notes": ""
}

Rules:
- unitPrice is Rand, number only. "48k" = 48000. "R 12 500" = 12500.
- qty defaults to 1. unit is one of: each, set, m, m2, l, kg, hour, day, week.
- Do not invent a client, phone, site, item, or price that was not mentioned.
- depositPct only if they said a percent. Otherwise null.
- notes: timing, exclusions, extras. Empty string if none.
- If only one job and one price, one line item with a clean description.

Voice note:
"""${String(text || "").slice(0, 4000)}"""`;

  const r = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "grok-4.6",
      temperature: 0.1,
      messages: [
        {
          role: "system",
          content: "You extract structured trade quotes. Reply with JSON only.",
        },
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!r.ok) {
    const err = await r.text().catch(() => "");
    throw new Error(`AI parse failed (${r.status}) ${err.slice(0, 180)}`);
  }
  const json = await r.json();
  const content = json.choices?.[0]?.message?.content || "";
  const parsed = extractJson(content);
  if (!parsed) throw new Error("AI returned something that was not a quote.");
  return {
    clientName: String(parsed.clientName || ""),
    clientPhone: String(parsed.clientPhone || ""),
    site: String(parsed.site || ""),
    items: Array.isArray(parsed.items)
      ? parsed.items
          .map((i) => ({
            description: String(i.description || "").trim(),
            qty: Number(i.qty) > 0 ? Number(i.qty) : 1,
            unit: String(i.unit || "each"),
            unitPrice: Number(i.unitPrice) || 0,
          }))
          .filter((i) => i.description)
      : [],
    depositPct:
      parsed.depositPct == null || parsed.depositPct === ""
        ? null
        : Number(parsed.depositPct),
    notes: String(parsed.notes || ""),
  };
}

export async function parseQuoteText(text) {
  const key = process.env.XAI_API_KEY;
  if (key) {
    try {
      const ai = await grokParse(text, key);
      if (!ai.notes) ai.notes = String(text || "").trim();
      return { source: "ai", ...ai };
    } catch (e) {
      const fb = heuristicParse(text);
      return { source: "heuristic", error: e.message, ...fb };
    }
  }
  return { source: "heuristic", ...heuristicParse(text) };
}
