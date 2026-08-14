const $ = (sel, el = document) => el.querySelector(sel);
const app = $("#app");

const state = {
  ready: false,
  status: null,
  me: null,
  quotes: [],
  stats: null,
  view: "boot",
  filter: "all",
  error: "",
  flash: "",
  detail: null,
  wa: null,
  draft: emptyDraft(),
  listening: false,
  parseSource: "",
};

const DEMO_VOICE =
  "Thandi at 22 Compensation Beach, 16kW heat pump supply and install R56000, extra trunking R3200, 50% deposit";

function emptyDraft(biz) {
  return {
    clientName: "",
    clientPhone: "",
    site: "",
    notes: "",
    voiceText: biz?.demo ? DEMO_VOICE : "",
    items: [{ id: uid(), description: "", qty: 1, unit: "each", unitPrice: "" }],
    depositPct: biz?.depositPct ?? 50,
    validDays: biz?.validDays ?? 14,
    vatMode: biz?.vatMode || "incl",
  };
}

function uid() {
  return Math.random().toString(36).slice(2, 8);
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function zar(n) {
  return (
    "R" +
    Number(n || 0).toLocaleString("en-ZA", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

function prettyPhone(d) {
  const x = String(d || "").replace(/\D/g, "");
  if (x.startsWith("27") && x.length === 11) return `0${x.slice(2, 4)} ${x.slice(4, 7)} ${x.slice(7)}`;
  return d || "";
}

async function api(path, opts = {}) {
  const r = await fetch(path, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    ...opts,
    body: opts.body != null ? JSON.stringify(opts.body) : undefined,
  });
  const text = await r.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text || "Bad response" };
  }
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
  return data;
}

function totals(draft) {
  const subtotal = draft.items.reduce(
    (s, i) => s + (Number(i.qty) || 0) * (Number(i.unitPrice) || 0),
    0
  );
  let vat = 0;
  let total = subtotal;
  if (draft.vatMode === "add") {
    vat = subtotal * 0.15;
    total = subtotal + vat;
  } else if (draft.vatMode === "none") {
    vat = 0;
  } else {
    vat = subtotal - subtotal / 1.15;
  }
  const depositAmount = total * (Number(draft.depositPct) || 0) / 100;
  return { subtotal, vat, total, depositAmount };
}

function route() {
  const h = (location.hash || "#/").replace(/^#/, "") || "/";
  if (h.startsWith("/q/")) return { name: "detail", id: h.slice(3) };
  if (h.startsWith("/new")) return { name: "new" };
  if (h.startsWith("/settings")) return { name: "settings" };
  if (h.startsWith("/login")) return { name: "login" };
  if (h.startsWith("/setup")) return { name: "setup" };
  return { name: "home" };
}

function go(hash) {
  if (location.hash === hash) onRoute();
  else location.hash = hash;
}

function wantsDemo() {
  const q = new URLSearchParams(location.search);
  return q.has("demo") || location.hash === "#/demo";
}

async function enterDemo() {
  const data = await api("/api/demo", { method: "POST" });
  state.me = data.business;
  state.status = state.status || {};
  state.status.signedIn = true;
  state.status.hasBusiness = true;
  state.draft = emptyDraft(state.me);
}

async function boot() {
  try {
    state.status = await api("/api/status");
    if ((wantsDemo() || state.status.demoOnly) && !state.status.signedIn) {
      await enterDemo();
      history.replaceState({}, "", "/#/");
    } else if (state.status.signedIn) {
      const me = await api("/api/me");
      state.me = me.business;
      state.status.ai = me.ai;
    }
  } catch {
    state.status = { hasBusiness: false, signedIn: false, trades: [], templates: {}, units: [] };
  }
  state.ready = true;
  await onRoute();
}

async function onRoute() {
  if (!state.ready) return;
  const r = route();
  state.error = "";
  if (!state.me && r.name !== "login" && r.name !== "setup") {
    render(welcomeView());
    return;
  }
  if (r.name === "setup") {
    if (state.status?.demoOnly) return render(welcomeView());
    return render(setupView());
  }
  if (r.name === "login") return render(loginView());
  if (r.name === "new") {
    if (!state.draft || state.view !== "new") state.draft = emptyDraft(state.me);
    state.view = "new";
    return render(newView());
  }
  if (r.name === "settings") {
    state.view = "settings";
    return render(settingsView());
  }
  if (r.name === "detail") {
    state.view = "detail";
    render(shell("Loading quote…", nav("quotes")));
    try {
      const data = await api(`/api/quotes/${r.id}`);
      state.detail = data.quote;
      state.wa = data.wa;
      render(detailView());
    } catch (e) {
      render(shell(`<div class="err">${esc(e.message)}</div>`, nav("quotes")));
    }
    return;
  }
  state.view = "home";
  render(shell("Loading…", nav("quotes")));
  try {
    const data = await api("/api/quotes");
    state.quotes = data.quotes;
    state.stats = data.stats;
    render(homeView());
  } catch (e) {
    render(shell(`<div class="err">${esc(e.message)}</div>`, nav("quotes")));
  }
}

function nav(on) {
  return `
    <nav class="nav">
      <a href="#/" class="${on === "quotes" ? "on" : ""}">Quotes</a>
      <a href="#/new" class="new">New quote</a>
      <a href="#/settings" class="${on === "settings" ? "on" : ""}">Settings</a>
    </nav>`;
}

function shell(inner, extra = "") {
  return `<div class="wrap">${inner}</div>${extra}`;
}

function brand() {
  return `
    <div class="brand">
      <div class="brand-mark" role="img" aria-label="KWOTA"></div>
      <div>
        <h1>KWOTA</h1>
        <p>Voice it. Send it. Get paid.</p>
      </div>
    </div>`;
}

function welcomeView() {
  return `
    <div class="gate"><div class="wrap wrap-tight">
      ${brand()}
      <div class="hero">
        <h2>See it first.<br><em>No details.</em></h2>
        <p>Fake Ballito company. Real quotes already in there — paid, waiting, accepted, draft. Click around.</p>
      </div>
      ${state.error ? `<div class="err">${esc(state.error)}</div>` : ""}
      <button class="btn btn-amber" id="demo-btn" type="button">Open the demo</button>
      <p class="tiny">${state.status?.demoOnly ? "Shared demo. The four sample jobs are ready — tap around." : "The desktop KWOTA icon just starts this. The app is the page in your browser."}</p>
      ${
        state.status?.demoOnly
          ? ""
          : `<div class="btn-row mt">
        <a class="btn btn-ghost" href="#/login">I have an account</a>
        <a class="btn btn-ghost" href="#/setup">Set up mine</a>
      </div>`
      }
    </div></div>`;
}

function demoBanner() {
  if (!state.me?.demo) return "";
  const sent = (state.quotes || []).find((q) => q.status === "sent");
  const client = sent ? `/q/${sent.publicId}` : "/q/demo-priya";
  return `
    <div class="demo-banner">
      <b>Shared demo.</b> Fake Ballito jobs — click around. Nothing here is a real client.
      <div class="demo-links">
        <a href="${esc(client)}" target="_blank" rel="noopener">See what the client sees →</a>
        <a href="#/new">Make a quote from a ready-made voice note →</a>
      </div>
    </div>`;
}

function setupView() {
  const trades = (state.status?.trades || []).map((t) => `<option>${esc(t)}</option>`).join("");
  return `
    <div class="gate"><div class="wrap wrap-tight">
      ${brand()}
      <div class="hero">
        <h2>Send the quote.<br><em>Get the deposit.</em></h2>
        <p>Built for heat pumps, scaffold, sparks, plumbers. One page. WhatsApp. Done.</p>
      </div>
      <button class="btn btn-amber mb" id="demo-btn" type="button">Skip — open the demo</button>
      <form id="setup-form" class="card">
        <h3>Your business</h3>
        ${state.error ? `<div class="err">${esc(state.error)}</div>` : ""}
        <div class="field"><label>Business name</label><input name="name" required placeholder="Ballito Heat Pumps"></div>
        <div class="row">
          <div class="field"><label>Trade</label><select name="trade">${trades}</select></div>
          <div class="field"><label>City</label><input name="city" placeholder="Ballito"></div>
        </div>
        <div class="field"><label>WhatsApp</label><input name="phone" required inputmode="tel" placeholder="082 000 0000"></div>
        <div class="field"><label>4–8 digit PIN</label><input name="pin" required inputmode="numeric" minlength="4" maxlength="8" placeholder="••••"></div>
        <div class="field"><label>Default deposit %</label><input name="depositPct" type="number" min="0" max="100" value="50"></div>
        <div class="field"><label>Yoco / PayFast / Ozow link (optional)</label><input name="paymentLink" type="url" placeholder="https://pay.yoco.com/…"></div>
        <div class="field"><label>Bank name · account (optional)</label>
          <div class="row">
            <input name="bankName" placeholder="FNB">
            <input name="bankAccount" placeholder="Account number">
          </div>
        </div>
        <button class="btn btn-amber" type="submit">Create KWOTA</button>
      </form>
      <p class="tiny">${state.status?.hasBusiness ? `<a href="#/login">Already have an account? Sign in</a>` : "On your phone, open the same Wi‑Fi URL and add to home screen."}</p>
    </div></div>`;
}

function loginView() {
  return `
    <div class="gate"><div class="wrap wrap-tight">
      ${brand()}
      <div class="hero"><h2>Sign in.</h2><p>WhatsApp number and your PIN.</p></div>
      <button class="btn btn-amber mb" id="demo-btn" type="button">Skip — open the demo</button>
      <form id="login-form" class="card">
        ${state.error ? `<div class="err">${esc(state.error)}</div>` : ""}
        <div class="field"><label>WhatsApp</label><input name="phone" required inputmode="tel" placeholder="082 000 0000"></div>
        <div class="field"><label>PIN</label><input name="pin" required inputmode="numeric" minlength="4" maxlength="8"></div>
        <button class="btn btn-ghost" type="submit">Open quotes</button>
      </form>
      <p class="tiny"><a href="#/setup">New business? Set up KWOTA</a></p>
    </div></div>`;
}

function homeView() {
  const s = state.stats || {};
  const filter = state.filter;
  const list = state.quotes.filter((q) => {
    if (filter === "all") return true;
    if (filter === "open") return q.status === "sent" || q.status === "draft";
    return q.status === filter;
  });
  return shell(
    `
    <div class="top">
      ${brand()}
      <div class="muted">${esc(state.me.name)}</div>
    </div>
    ${demoBanner()}
    <div class="stats">
      <div class="stat"><span>Quoted this month</span><b>${zar(s.quoted)}</b></div>
      <div class="stat"><span>Accepted</span><b>${zar(s.accepted)}</b></div>
      <div class="stat"><span>Deposits in</span><b>${zar(s.deposits)}</b></div>
      <div class="stat"><span>Waiting on client</span><b>${s.waiting || 0}</b></div>
    </div>
    <div class="chips">
      ${["all", "open", "accepted", "paid"].map((f) => `<button class="chip ${filter === f ? "on" : ""}" data-filter="${f}">${f}</button>`).join("")}
    </div>
    ${
      list.length
        ? `<div class="q-list">${list.map(quoteRow).join("")}</div>`
        : `<div class="empty card">
            <h3>No quotes yet</h3>
            <p>First one takes a minute. Voice the job or type it.</p>
            <a class="btn btn-amber" href="#/new">New quote</a>
          </div>`
    }
    `,
    nav("quotes")
  );
}

function quoteRow(q) {
  return `
    <a class="q-item" href="#/q/${esc(q.id)}">
      <div>
        <strong>${esc(q.clientName || "No name")}</strong>
        <em>${esc(q.number)} · ${esc(q.site || "No site")}</em>
        <div class="pill pill-${esc(q.status)}">${esc(q.status)}</div>
      </div>
      <div class="amt">${zar(q.total)}<div class="muted" style="font-size:11px">dep ${zar(q.depositAmount)}</div></div>
    </a>`;
}

function newView() {
  const d = state.draft;
  const t = totals(d);
  return shell(
    `
    <div class="top">
      <div class="brand"><div class="brand-mark"></div><div><h1>New quote</h1><p>${esc(state.me.trade)}</p></div></div>
    </div>
    ${state.me?.demo ? `<div class="demo-banner"><b>Demo.</b> Voice note is already filled in. Tap <b>Turn into quote</b>.</div>` : ""}
    ${state.error ? `<div class="err">${esc(state.error)}</div>` : ""}
    ${state.flash ? `<div class="okmsg">${esc(state.flash)}</div>` : ""}
    <div class="card">
      <h3>Speak the job</h3>
      <div class="mic-box">
        <button class="mic ${state.listening ? "on" : ""}" id="mic" type="button" aria-label="Hold to talk">●</button>
        <div>
          <textarea id="voiceText" placeholder="Jake at 12 Marine Drive, 12kW heat pump supply and install 48k, trunking 2500, 50% deposit">${esc(d.voiceText)}</textarea>
          <p class="hint">${
            state.status?.ai
              ? "AI will turn this into line items."
              : "Works without AI — it grabs amounts. Add XAI_API_KEY to .env if you want it to think."
          } ${state.parseSource ? `Last parse: ${esc(state.parseSource)}` : ""}</p>
          <button class="btn btn-ghost mt" id="parse-btn" type="button">Turn into quote</button>
        </div>
      </div>
    </div>
    <div class="card">
      <h3>Client</h3>
      <div class="field"><label>Name</label><input id="clientName" value="${esc(d.clientName)}" placeholder="Jake"></div>
      <div class="row">
        <div class="field"><label>WhatsApp</label><input id="clientPhone" inputmode="tel" value="${esc(d.clientPhone)}" placeholder="082 …"></div>
        <div class="field"><label>Site</label><input id="site" value="${esc(d.site)}" placeholder="12 Marine Drive"></div>
      </div>
    </div>
    <div class="card">
      <div class="top" style="margin:0 0 10px">
        <h3 style="margin:0">Line items</h3>
        <button class="linkish" id="load-tmpl" type="button">Typical ${esc(state.me.trade)} lines</button>
      </div>
      <div id="items">${d.items.map((i) => itemRow(i)).join("")}</div>
      <button class="btn btn-ghost" id="add-item" type="button">Add line</button>
      <div class="field mt">
        <div class="range-lab"><span>Deposit</span><b>${d.depositPct}%</b></div>
        <input class="range" id="depositPct" type="range" min="0" max="100" step="5" value="${d.depositPct}">
      </div>
      <div class="row">
        <div class="field"><label>VAT</label>
          <select id="vatMode">
            <option value="incl" ${d.vatMode === "incl" ? "selected" : ""}>Prices include VAT</option>
            <option value="add" ${d.vatMode === "add" ? "selected" : ""}>Add 15% VAT</option>
            <option value="none" ${d.vatMode === "none" ? "selected" : ""}>No VAT</option>
          </select>
        </div>
        <div class="field"><label>Valid (days)</label><input id="validDays" type="number" min="1" max="90" value="${d.validDays}"></div>
      </div>
      <div class="field"><label>Notes on the quote</label><textarea id="notes">${esc(d.notes)}</textarea></div>
      <div class="totals">
        <div><span>Subtotal</span><span>${zar(t.subtotal)}</span></div>
        <div><span>VAT</span><span>${zar(t.vat)}</span></div>
        <div class="grand"><span>Total</span><span>${zar(t.total)}</span></div>
        <div><span>Deposit due</span><span>${zar(t.depositAmount)}</span></div>
      </div>
    </div>
    <div class="btn-row mt">
      <button class="btn btn-ghost" id="save-draft" type="button">Save draft</button>
      <button class="btn btn-wa" id="save-send" type="button">Save & WhatsApp</button>
    </div>
    `,
    nav("new")
  );
}

function itemRow(i) {
  const unitOpts = (state.status?.units || ["each"])
    .map((u) => `<option value="${u}" ${i.unit === u ? "selected" : ""}>${u}</option>`)
    .join("");
  return `
    <div class="item-card" data-id="${esc(i.id)}">
      <div class="item-top">
        <input data-k="description" value="${esc(i.description)}" placeholder="Supply & install heat pump">
        <button class="x" data-del="${esc(i.id)}" type="button">Remove</button>
      </div>
      <div class="row-3">
        <input data-k="qty" inputmode="decimal" value="${esc(i.qty)}" placeholder="Qty">
        <select data-k="unit">${unitOpts}</select>
        <input data-k="unitPrice" inputmode="decimal" value="${esc(i.unitPrice)}" placeholder="Price (R)">
      </div>
    </div>`;
}

function detailView() {
  const q = state.detail;
  if (!q) return shell("Missing quote", nav("quotes"));
  const locked = q.status === "paid" || q.status === "declined";
  return shell(
    `
    <div class="top">
      <a class="linkish" href="#/">← Quotes</a>
      <div class="pill pill-${esc(q.status)}">${esc(q.status)}</div>
    </div>
    <div class="hero" style="margin-top:8px">
      <h2 style="font-size:34px">${esc(q.clientName || "No name")}</h2>
      <p>${esc(q.number)} · ${esc(q.site || "No site")} · ${prettyPhone(q.clientPhone)}</p>
    </div>
    ${state.error ? `<div class="err">${esc(state.error)}</div>` : ""}
    ${state.flash ? `<div class="okmsg">${esc(state.flash)}</div>` : ""}
    <div class="card">
      <div class="totals">
        <div class="grand"><span>Total</span><span>${zar(q.total)}</span></div>
        <div><span>Deposit ${q.depositPct}%</span><span>${zar(q.depositAmount)}</span></div>
      </div>
      <p class="muted mt">${(q.items || []).map((i) => `${esc(i.qty)} ${esc(i.unit)} · ${esc(i.description)} — ${zar(i.qty * i.unitPrice)}`).join("<br>")}</p>
    </div>
    <div class="card">
      <h3>Share</h3>
      <p class="mono muted" style="word-break:break-all">${esc(q.url)}</p>
      <div class="btn-row mt">
        <a class="btn btn-ghost" href="${esc(q.url)}" target="_blank" rel="noopener">Open as the client</a>
        <button class="btn btn-ghost" id="copy-link" type="button">Copy link</button>
      </div>
      <a class="btn btn-wa mt" href="${esc(state.wa?.href || "#")}" target="_blank" rel="noopener" id="wa-send">WhatsApp client</a>
    </div>
    <div class="btn-row mt">
      ${q.status !== "paid" && q.status !== "declined" ? `<button class="btn btn-ok" id="mark-paid" type="button">Deposit received</button>` : ""}
      <button class="btn btn-ghost" id="dup" type="button">Duplicate</button>
    </div>
    ${q.acceptedBy ? `<p class="muted mt">Accepted by ${esc(q.acceptedBy)} ${q.acceptedAt ? "· " + new Date(q.acceptedAt).toLocaleString() : ""}</p>` : ""}
    ${locked ? "" : `<p class="tiny"><button class="linkish" id="edit-into-new" type="button">Edit as new draft</button></p>`}
    `,
    nav("quotes")
  );
}

function settingsView() {
  const b = state.me;
  const trades = (state.status?.trades || [])
    .map((t) => `<option ${t === b.trade ? "selected" : ""}>${esc(t)}</option>`)
    .join("");
  return shell(
    `
    <div class="top">${brand()}</div>
    ${state.me?.demo ? `<div class="demo-banner"><b>Demo company.</b> Play with it. When you want the real thing, sign out and tap Set up mine.</div>` : ""}
    ${state.error ? `<div class="err">${esc(state.error)}</div>` : ""}
    ${state.flash ? `<div class="okmsg">${esc(state.flash)}</div>` : ""}
    <form id="settings-form" class="card">
      <h3>Business</h3>
      <div class="field"><label>Name</label><input name="name" value="${esc(b.name)}" required></div>
      <div class="row">
        <div class="field"><label>Trade</label><select name="trade">${trades}</select></div>
        <div class="field"><label>City</label><input name="city" value="${esc(b.city || "")}"></div>
      </div>
      <div class="field"><label>WhatsApp</label><input name="phone" value="${esc(prettyPhone(b.phone))}"></div>
      <div class="row">
        <div class="field"><label>Default deposit %</label><input name="depositPct" type="number" min="0" max="100" value="${esc(b.depositPct)}"></div>
        <div class="field"><label>Valid days</label><input name="validDays" type="number" min="1" max="90" value="${esc(b.validDays)}"></div>
      </div>
      <div class="field"><label>VAT</label>
        <select name="vatMode">
          <option value="incl" ${b.vatMode === "incl" ? "selected" : ""}>Prices include VAT</option>
          <option value="add" ${b.vatMode === "add" ? "selected" : ""}>Add 15% VAT</option>
          <option value="none" ${b.vatMode === "none" ? "selected" : ""}>No VAT</option>
        </select>
      </div>
      <div class="field"><label>Payment link</label><input name="paymentLink" value="${esc(b.paymentLink || "")}" placeholder="https://"></div>
      <div class="field"><label>Bank</label>
        <div class="row">
          <input name="bankName" value="${esc(b.bankName || "")}" placeholder="Bank">
          <input name="bankAccountName" value="${esc(b.bankAccountName || "")}" placeholder="Account name">
        </div>
        <div class="row mt">
          <input name="bankAccount" value="${esc(b.bankAccount || "")}" placeholder="Account no">
          <input name="bankBranch" value="${esc(b.bankBranch || "")}" placeholder="Branch">
        </div>
      </div>
      <div class="field"><label>Terms on every quote</label><textarea name="terms">${esc(b.terms || "")}</textarea></div>
      <div class="field">
        <label>Logo</label>
        <div class="logo-slot" id="logo-preview" style="${b.logoDataUrl ? `background-image:url('${b.logoDataUrl}')` : ""}"></div>
        <input type="file" id="logo-file" accept="image/*" hidden>
        <button class="btn btn-ghost file-btn" id="logo-pick" type="button">Upload logo</button>
        <input type="hidden" name="logoDataUrl" id="logoDataUrl" value="${esc(b.logoDataUrl || "")}">
      </div>
      <div class="field"><label>New PIN (leave blank to keep)</label><input name="pin" inputmode="numeric" minlength="4" maxlength="8" placeholder="••••"></div>
      <button class="btn btn-amber" type="submit">Save settings</button>
    </form>
    <div class="card">
      <h3>On your phone</h3>
      <p class="muted">Open this on the same Wi‑Fi, then Add to Home Screen.</p>
      <p class="mono">${esc(location.origin)}</p>
      <p class="muted mt">Voice AI: ${state.status?.ai ? "on" : "off"}</p>
    </div>
    <button class="btn btn-bad mt" id="logout" type="button">Sign out</button>
    `,
    nav("settings")
  );
}

function refreshTotals() {
  const box = document.querySelector(".totals");
  if (!box || !state.draft) return;
  const t = totals(state.draft);
  box.innerHTML = `
        <div><span>Subtotal</span><span>${zar(t.subtotal)}</span></div>
        <div><span>VAT</span><span>${zar(t.vat)}</span></div>
        <div class="grand"><span>Total</span><span>${zar(t.total)}</span></div>
        <div><span>Deposit due</span><span>${zar(t.depositAmount)}</span></div>`;
}

function render(html) {
  app.innerHTML = html;
  bind();
}

function readDraftFromDom() {
  const d = state.draft;
  const g = (id) => $(id)?.value ?? "";
  d.voiceText = g("#voiceText");
  d.clientName = g("#clientName");
  d.clientPhone = g("#clientPhone");
  d.site = g("#site");
  d.notes = g("#notes");
  d.depositPct = Number(g("#depositPct") || d.depositPct);
  d.validDays = Number(g("#validDays") || d.validDays);
  d.vatMode = g("#vatMode") || d.vatMode;
  d.items = [...document.querySelectorAll(".item-card")].map((card) => {
    const get = (k) => card.querySelector(`[data-k="${k}"]`)?.value;
    return {
      id: card.dataset.id,
      description: get("description") || "",
      qty: get("qty") || 1,
      unit: get("unit") || "each",
      unitPrice: get("unitPrice") || 0,
    };
  });
}

function bind() {
  $("#demo-btn")?.addEventListener("click", async () => {
    try {
      await enterDemo();
      go("#/");
    } catch (err) {
      state.error = err.message;
      render(welcomeView());
    }
  });

  $("#setup-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = Object.fromEntries(fd.entries());
    body.depositPct = Number(body.depositPct);
    try {
      const data = await api("/api/setup", { method: "POST", body });
      state.me = data.business;
      state.status.hasBusiness = true;
      state.status.signedIn = true;
      go("#/");
    } catch (err) {
      state.error = err.message;
      render(setupView());
    }
  });

  $("#login-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const data = await api("/api/login", { method: "POST", body: Object.fromEntries(fd.entries()) });
      state.me = data.business;
      state.status.signedIn = true;
      go("#/");
    } catch (err) {
      state.error = err.message;
      render(loginView());
    }
  });

  document.querySelectorAll("[data-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.filter = btn.dataset.filter;
      render(homeView());
    });
  });

  $("#mic")?.addEventListener("click", toggleMic);
  $("#parse-btn")?.addEventListener("click", parseVoice);
  $("#add-item")?.addEventListener("click", () => {
    readDraftFromDom();
    state.draft.items.push({ id: uid(), description: "", qty: 1, unit: "each", unitPrice: "" });
    render(newView());
  });
  $("#load-tmpl")?.addEventListener("click", () => {
    readDraftFromDom();
    const tmpl = state.status?.templates?.[state.me.trade] || [];
    state.draft.items = tmpl.map((i) => ({ id: uid(), ...i, unitPrice: "" }));
    if (!state.draft.items.length) state.draft.items = emptyDraft(state.me).items;
    render(newView());
  });
  document.querySelectorAll("[data-del]").forEach((btn) => {
    btn.addEventListener("click", () => {
      readDraftFromDom();
      state.draft.items = state.draft.items.filter((i) => i.id !== btn.dataset.del);
      if (!state.draft.items.length) state.draft.items.push({ id: uid(), description: "", qty: 1, unit: "each", unitPrice: "" });
      render(newView());
    });
  });
  ["#voiceText", "#clientName", "#clientPhone", "#site", "#notes", "#validDays"].forEach((id) => {
    $(id)?.addEventListener("input", () => {
      if (state.view !== "new") return;
      readDraftFromDom();
    });
  });
  $("#depositPct")?.addEventListener("input", () => {
    readDraftFromDom();
    const lab = document.querySelector(".range-lab b");
    if (lab) lab.textContent = `${state.draft.depositPct}%`;
    refreshTotals();
  });
  $("#vatMode")?.addEventListener("change", () => {
    readDraftFromDom();
    render(newView());
  });
  document.querySelectorAll(".item-card input, .item-card select").forEach((el) => {
    el.addEventListener("change", () => {
      readDraftFromDom();
      refreshTotals();
    });
  });
  $("#save-draft")?.addEventListener("click", () => saveQuote(false));
  $("#save-send")?.addEventListener("click", () => saveQuote(true));

  $("#copy-link")?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(state.detail.url);
      state.flash = "Link copied.";
      render(detailView());
    } catch {
      state.error = "Could not copy. Long-press the link.";
      render(detailView());
    }
  });
  $("#wa-send")?.addEventListener("click", async () => {
    try {
      await api(`/api/quotes/${state.detail.id}/send`, { method: "POST" });
    } catch {
      /* still open wa */
    }
  });
  $("#mark-paid")?.addEventListener("click", async () => {
    try {
      const data = await api(`/api/quotes/${state.detail.id}/paid`, { method: "POST" });
      state.detail = { ...state.detail, ...data.quote };
      state.flash = "Deposit marked received. Book the job.";
      render(detailView());
    } catch (e) {
      state.error = e.message;
      render(detailView());
    }
  });
  $("#dup")?.addEventListener("click", async () => {
    try {
      const data = await api(`/api/quotes/${state.detail.id}/duplicate`, { method: "POST" });
      go(`#/q/${data.quote.id}`);
    } catch (e) {
      state.error = e.message;
      render(detailView());
    }
  });
  $("#edit-into-new")?.addEventListener("click", () => {
    const q = state.detail;
    state.draft = {
      clientName: q.clientName,
      clientPhone: q.clientPhone,
      site: q.site,
      notes: q.notes,
      voiceText: "",
      items: (q.items || []).map((i) => ({ ...i, id: uid() })),
      depositPct: q.depositPct,
      validDays: q.validDays,
      vatMode: q.vatMode,
    };
    go("#/new");
  });

  $("#settings-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = Object.fromEntries(fd.entries());
    body.depositPct = Number(body.depositPct);
    body.validDays = Number(body.validDays);
    if (!body.pin) delete body.pin;
    try {
      const data = await api("/api/me", { method: "PATCH", body });
      state.me = data.business;
      state.flash = "Saved.";
      render(settingsView());
    } catch (err) {
      state.error = err.message;
      render(settingsView());
    }
  });
  $("#logo-pick")?.addEventListener("click", () => $("#logo-file").click());
  $("#logo-file")?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const url = await resizeLogo(file);
      $("#logoDataUrl").value = url;
      $("#logo-preview").style.backgroundImage = `url('${url}')`;
    } catch {
      state.error = "Could not read that image.";
      render(settingsView());
    }
  });
  $("#logout")?.addEventListener("click", async () => {
    await api("/api/logout", { method: "POST" });
    state.me = null;
    state.status.signedIn = false;
    go("#/login");
  });
}

let rec = null;
function toggleMic() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    state.error = "This browser has no voice input. Type the job, or use Chrome / Edge.";
    render(newView());
    return;
  }
  if (state.listening && rec) {
    rec.stop();
    return;
  }
  rec = new SR();
  rec.lang = "en-ZA";
  rec.interimResults = true;
  rec.continuous = true;
  rec.onresult = (e) => {
    let text = "";
    for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript + " ";
    const box = $("#voiceText");
    if (box) box.value = text.trim();
    state.draft.voiceText = text.trim();
  };
  rec.onend = () => {
    state.listening = false;
    const btn = $("#mic");
    if (btn) btn.classList.remove("on");
  };
  rec.onerror = () => {
    state.listening = false;
  };
  rec.start();
  state.listening = true;
  $("#mic")?.classList.add("on");
}

async function parseVoice() {
  readDraftFromDom();
  const text = state.draft.voiceText.trim();
  if (!text) {
    state.error = "Speak or type the job first.";
    render(newView());
    return;
  }
  const btn = $("#parse-btn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Reading it…";
  }
  try {
    const parsed = await api("/api/parse", { method: "POST", body: { text } });
    state.parseSource = parsed.source + (parsed.error ? " (AI missed, used backup)" : "");
    if (parsed.clientName) state.draft.clientName = parsed.clientName;
    if (parsed.clientPhone) state.draft.clientPhone = parsed.clientPhone;
    if (parsed.site) state.draft.site = parsed.site;
    if (parsed.depositPct != null) state.draft.depositPct = parsed.depositPct;
    if (parsed.notes) state.draft.notes = parsed.notes;
    if (parsed.items?.length) {
      state.draft.items = parsed.items.map((i) => ({ id: uid(), ...i }));
    }
    state.flash = "Check the lines, then send.";
    state.error = "";
  } catch (e) {
    state.error = e.message;
  }
  render(newView());
}

async function saveQuote(send) {
  readDraftFromDom();
  const d = state.draft;
  const items = d.items
    .filter((i) => i.description.trim())
    .map((i) => ({
      description: i.description.trim(),
      qty: Number(i.qty) || 1,
      unit: i.unit || "each",
      unitPrice: Number(i.unitPrice) || 0,
    }));
  if (!items.length || items.every((i) => !i.unitPrice)) {
    state.error = "Add at least one line with a price.";
    render(newView());
    return;
  }
  try {
    const data = await api("/api/quotes", {
      method: "POST",
      body: {
        clientName: d.clientName,
        clientPhone: d.clientPhone,
        site: d.site,
        notes: d.notes,
        items,
        depositPct: d.depositPct,
        validDays: d.validDays,
        vatMode: d.vatMode,
      },
    });
    if (send) {
      const sent = await api(`/api/quotes/${data.quote.id}/send`, { method: "POST" });
      state.draft = emptyDraft(state.me);
      window.open(sent.wa.href, "_blank");
      go(`#/q/${data.quote.id}`);
      return;
    }
    state.draft = emptyDraft(state.me);
    go(`#/q/${data.quote.id}`);
  } catch (e) {
    state.error = e.message;
    render(newView());
  }
}

function resizeLogo(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const s = 256;
      const c = document.createElement("canvas");
      c.width = s;
      c.height = s;
      const ctx = c.getContext("2d");
      const r = Math.max(s / img.width, s / img.height);
      const w = img.width * r;
      const h = img.height * r;
      ctx.drawImage(img, (s - w) / 2, (s - h) / 2, w, h);
      resolve(c.toDataURL("image/jpeg", 0.86));
      URL.revokeObjectURL(url);
    };
    img.onerror = reject;
    img.src = url;
  });
}

window.addEventListener("hashchange", onRoute);
boot();
