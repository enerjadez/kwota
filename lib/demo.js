import { hashPin, nid, nowIso, totals } from "./util.js";

export const DEMO_PHONE = "27825551234";

function ago(hours) {
  return new Date(Date.now() - hours * 3600000).toISOString();
}

function stamp(biz, spec) {
  const items = spec.items.map((i) => ({
    id: i.id || nid(6),
    description: i.description,
    qty: i.qty,
    unit: i.unit,
    unitPrice: i.unitPrice,
  }));
  const t = totals(items, spec.vatMode || biz.vatMode || "incl", spec.depositPct);
  return {
    id: spec.id,
    publicId: spec.publicId,
    businessId: biz.id,
    number: spec.number,
    status: spec.status,
    clientName: spec.clientName,
    clientPhone: spec.clientPhone,
    site: spec.site,
    notes: spec.notes,
    items,
    validDays: spec.validDays || 14,
    vatMode: spec.vatMode || biz.vatMode || "incl",
    depositPct: spec.depositPct,
    createdAt: spec.createdAt,
    sentAt: spec.sentAt || null,
    acceptedAt: spec.acceptedAt || null,
    acceptedBy: spec.acceptedBy || "",
    declinedAt: null,
    declineReason: "",
    paidAt: spec.paidAt || null,
    ...t,
  };
}

function story(biz) {
  return [
    {
      id: "demo-jake-id",
      publicId: "demo-jake",
      number: "KW-0001",
      status: "paid",
      clientName: "Jake Naidoo",
      clientPhone: "27831112233",
      site: "12 Marine Drive, Ballito",
      notes: "Standard 12kW install. Existing isolator stays.",
      depositPct: 50,
      createdAt: ago(120),
      sentAt: ago(118),
      acceptedAt: ago(100),
      acceptedBy: "Jake Naidoo",
      paidAt: ago(96),
      items: [
        { id: "dj1", description: "Supply & install 12kW heat pump", qty: 1, unit: "each", unitPrice: 48000 },
        { id: "dj2", description: "Pipework, fittings & trunking", qty: 1, unit: "set", unitPrice: 2500 },
      ],
    },
    {
      id: "demo-priya-id",
      publicId: "demo-priya",
      number: "KW-0002",
      status: "sent",
      clientName: "Priya Chetty",
      clientPhone: "27842223344",
      site: "8 Compensation Beach Rd",
      notes: "Swap existing 200L geyser. Access via garage.",
      depositPct: 50,
      createdAt: ago(20),
      sentAt: ago(18),
      items: [
        { id: "dp1", description: "Supply & install 200L heat pump geyser", qty: 1, unit: "each", unitPrice: 18500 },
        { id: "dp2", description: "Remove & dispose old geyser", qty: 1, unit: "each", unitPrice: 850 },
      ],
    },
    {
      id: "demo-thabo-id",
      publicId: "demo-thabo",
      number: "KW-0003",
      status: "accepted",
      clientName: "Thabo Mokoena",
      clientPhone: "27825550001",
      site: "4 Ridge Rd, Umhlali",
      notes: "Double storey. Deliver Friday if deposit clears.",
      depositPct: 40,
      createdAt: ago(8),
      sentAt: ago(7),
      acceptedAt: ago(2),
      acceptedBy: "Thabo Mokoena",
      items: [
        { id: "dt1", description: "Supply, deliver & erect scaffold", qty: 1, unit: "set", unitPrice: 18500 },
        { id: "dt2", description: "Weekly hire", qty: 2, unit: "week", unitPrice: 3500 },
        { id: "dt3", description: "Dismantle & collect", qty: 1, unit: "set", unitPrice: 2200 },
      ],
    },
    {
      id: "demo-lerato-id",
      publicId: "demo-lerato",
      number: "KW-0004",
      status: "draft",
      clientName: "Lerato Dlamini",
      clientPhone: "27834445566",
      site: "Simbithi office park",
      notes: "Waiting on roof height before we send this.",
      depositPct: 50,
      createdAt: ago(1),
      items: [
        { id: "dl1", description: "Supply & install 16kW heat pump", qty: 1, unit: "each", unitPrice: 56000 },
        { id: "dl2", description: "Extra trunking & pair coil", qty: 1, unit: "set", unitPrice: 3200 },
      ],
    },
  ].map((spec) => stamp(biz, spec));
}

export function ensureDemo(store) {
  let biz =
    store.data.businesses.find((b) => b.demo) || store.businessByPhone(DEMO_PHONE);

  if (!biz) {
    biz = {
      id: "demo-biz",
      name: "Ballito Heat Pumps",
      trade: "Heat pumps",
      phone: DEMO_PHONE,
      pinHash: hashPin("1234"),
      city: "Ballito",
      depositPct: 50,
      validDays: 14,
      vatMode: "incl",
      paymentLink: "https://pay.yoco.com/demo",
      bankName: "FNB",
      bankAccountName: "Ballito Heat Pumps",
      bankAccount: "62812345678",
      bankBranch: "250655",
      terms:
        "50% deposit secures the date. Balance due on completion. Quote valid as stated. Heat pumps workmanship guaranteed for 12 months. Manufacturer warranty applies to supplied equipment. Unforeseen extras (hidden pipework, extra trunking, council, COC upgrades) quoted before we proceed.",
      logoDataUrl: "",
      brandColor: "#e8a317",
      nextNo: 5,
      demo: true,
      createdAt: nowIso(),
    };
    store.data.businesses.push(biz);
  } else {
    biz.demo = true;
    if (!biz.paymentLink) biz.paymentLink = "https://pay.yoco.com/demo";
    if (!biz.bankName) {
      biz.bankName = "FNB";
      biz.bankAccountName = biz.bankAccountName || biz.name;
      biz.bankAccount = biz.bankAccount || "62812345678";
      biz.bankBranch = biz.bankBranch || "250655";
    }
  }

  const wanted = story(biz);

  // If this is the old test data (random public ids), fold it into the story once.
  const demoIds = new Set(wanted.map((q) => q.publicId));
  store.data.quotes = store.data.quotes.filter((q) => {
    if (q.businessId !== biz.id) return true;
    if (demoIds.has(q.publicId)) return true;
    // drop leftover auto-test quotes on the demo company so the story is clean
    return false;
  });

  for (const q of wanted) {
    const i = store.data.quotes.findIndex((x) => x.publicId === q.publicId);
    if (i >= 0) store.data.quotes[i] = q;
    else store.data.quotes.push(q);
  }

  const maxNo = store.data.quotes
    .filter((q) => q.businessId === biz.id)
    .reduce((n, q) => {
      const m = String(q.number || "").match(/(\d+)$/);
      return Math.max(n, m ? Number(m[1]) : 0);
    }, 0);
  biz.nextNo = Math.max(biz.nextNo || 1, maxNo + 1);
  store.save();
  return biz;
}
