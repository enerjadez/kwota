import * as XLSX from "xlsx";

const DESC = /^(desc|description|item|particulars|details|job|work|product|service|naam|beskrywing)/i;
const QTY = /^(qty|qty\.|quantity|qnty|hoeveel|aantal|#)$/i;
const UNIT = /^(unit|uom|eenheid|measure)$/i;
const PRICE = /^(price|rate|unit\s*price|unitprice|each|amount|amt|total|zar|r\b|cost|prys)/i;
const CLIENT = /^(client|customer|name|klient|contact)$/i;
const SITE = /^(site|address|location|adres|erf|stand)$/i;
const PHONE = /^(phone|cell|mobile|whatsapp|tel|nommer)$/i;

function normHeader(h) {
  return String(h || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function money(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number" && Number.isFinite(v)) return Math.round(v * 100) / 100;
  const s = String(v).trim().toLowerCase().replace(/\s/g, "").replace(/,/g, "");
  const k = s.endsWith("k");
  const n = parseFloat((k ? s.slice(0, -1) : s).replace(/[^\d.-]/g, ""));
  if (!Number.isFinite(n)) return null;
  return k ? n * 1000 : n;
}

function mapHeaders(row) {
  const map = { desc: -1, qty: -1, unit: -1, price: -1, client: -1, site: -1, phone: -1 };
  row.forEach((cell, i) => {
    const h = normHeader(cell);
    if (!h) return;
    if (map.desc < 0 && DESC.test(h)) map.desc = i;
    else if (map.qty < 0 && QTY.test(h)) map.qty = i;
    else if (map.unit < 0 && UNIT.test(h)) map.unit = i;
    else if (map.price < 0 && PRICE.test(h)) map.price = i;
    else if (map.client < 0 && CLIENT.test(h)) map.client = i;
    else if (map.site < 0 && SITE.test(h)) map.site = i;
    else if (map.phone < 0 && PHONE.test(h)) map.phone = i;
  });
  return map;
}

function looksLikeHeader(row) {
  const hits = row.filter((c) => {
    const h = normHeader(c);
    return DESC.test(h) || QTY.test(h) || PRICE.test(h) || UNIT.test(h);
  }).length;
  return hits >= 2;
}

export function extractSheet(buf, filename = "sheet.xlsx") {
  const wb = XLSX.read(buf, { type: "buffer", raw: false });
  const items = [];
  const lines = [`--- Excel: ${filename} ---`];
  let clientName = "";
  let site = "";
  let clientPhone = "";

  for (const name of wb.SheetNames.slice(0, 4)) {
    const sheet = wb.Sheets[name];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      raw: false,
      defval: "",
      blankrows: false,
    }).slice(0, 80);
    if (!rows.length) continue;
    lines.push(`[${name}]`);
    const headerIdx = rows.findIndex(looksLikeHeader);
    const map = headerIdx >= 0 ? mapHeaders(rows[headerIdx]) : { desc: 0, qty: 1, unit: 2, price: 3, client: -1, site: -1, phone: -1 };
    const start = headerIdx >= 0 ? headerIdx + 1 : 0;

    for (const row of rows) {
      const cells = row.map((c) => String(c ?? "").trim());
      if (cells.some(Boolean)) lines.push(cells.join(" | "));
    }

    for (let r = start; r < rows.length; r++) {
      const row = rows[r] || [];
      const desc = String(row[map.desc] ?? "").trim();
      const price = money(map.price >= 0 ? row[map.price] : row[row.length - 1]);
      if (!desc || desc.length < 2) continue;
      if (looksLikeHeader(row)) continue;
      const qty = Number(row[map.qty]) > 0 ? Number(row[map.qty]) : 1;
      const unit = String(row[map.unit] || "each").trim() || "each";
      if (price == null && !/[a-z]/i.test(desc)) continue;
      items.push({
        description: desc.slice(0, 180),
        qty,
        unit: unit.slice(0, 16).toLowerCase(),
        unitPrice: price || 0,
        source: "sheet",
      });
      if (!clientName && map.client >= 0) clientName = String(row[map.client] || "").trim();
      if (!site && map.site >= 0) site = String(row[map.site] || "").trim();
      if (!clientPhone && map.phone >= 0) clientPhone = String(row[map.phone] || "").trim();
    }
  }

  return {
    filename,
    text: lines.join("\n").slice(0, 12000),
    items: items.slice(0, 60),
    clientName,
    site,
    clientPhone,
  };
}

export function decodeSheetPayload(raw) {
  const name = String(raw?.name || "sheet.xlsx");
  const dataUrl = String(raw?.dataUrl || raw || "");
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/i);
  if (!m) return null;
  const buf = Buffer.from(m[2], "base64");
  if (!buf.length || buf.length > 2_500_000) return null;
  return { name, buf };
}
