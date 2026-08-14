const app = document.querySelector("#app");
const publicId = location.pathname.split("/").filter(Boolean)[1] || "";

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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

function prettyPhone(d) {
  const x = String(d || "").replace(/\D/g, "");
  if (x.startsWith("27") && x.length === 11) return `0${x.slice(2, 4)} ${x.slice(4, 7)} ${x.slice(7)}`;
  return d || "";
}

function fmtDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
}

async function api(path, opts = {}) {
  const r = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
    body: opts.body != null ? JSON.stringify(opts.body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

let quote = null;
let error = "";
let name = "";

function vatLabel(mode) {
  if (mode === "add") return "VAT 15%";
  if (mode === "none") return "VAT";
  return "VAT included";
}

function render() {
  if (!quote) {
    app.innerHTML = `<div class="sheet"><p>${esc(error || "Quote not found.")}</p></div>`;
    return;
  }
  const q = quote;
  const b = q.business;
  const paidHint =
    new URLSearchParams(location.search).get("paid") === "1" ||
    (typeof sessionStorage !== "undefined" && sessionStorage.getItem("kwota-paid-" + publicId) === "1");
  if (paidHint && q.status !== "declined" && q.status !== "expired") q.status = "paid";
  const canAct = q.status === "sent" || q.status === "draft";
  const logo = b.logoDataUrl
    ? `<img class="logo" src="${b.logoDataUrl}" alt="">`
    : "";
  const rows = (q.items || [])
    .map(
      (i) => `
      <tr>
        <td>${esc(i.description)}</td>
        <td class="qty">${esc(i.qty)} ${esc(i.unit)}</td>
        <td class="num">${zar(i.unitPrice)}</td>
        <td class="num">${zar(Number(i.qty) * Number(i.unitPrice))}</td>
      </tr>`
    )
    .join("");

  const banner =
    q.status === "paid"
      ? `<div class="banner ok">Deposit received. You're booked.</div>`
      : q.status === "accepted"
        ? `<div class="banner ok">Accepted by ${esc(q.acceptedBy)}. Pay the deposit to lock the date.</div>`
        : q.status === "declined"
          ? `<div class="banner bad">This quote was declined.</div>`
          : q.status === "expired"
            ? `<div class="banner exp">This quote expired on ${esc(fmtDate(q.validUntil))}.</div>`
            : "";

  const bank =
    b.bankAccount || b.bankName
      ? `<div class="bank">
          <div><span>Bank</span><b>${esc(b.bankName || "—")}</b></div>
          <div><span>Name</span><b>${esc(b.bankAccountName || b.name)}</b></div>
          <div><span>Account</span><b>${esc(b.bankAccount || "—")}</b></div>
          ${b.bankBranch ? `<div><span>Branch</span><b>${esc(b.bankBranch)}</b></div>` : ""}
          <div><span>Reference</span><b>${esc(q.number)}</b></div>
        </div>`
      : "";

  const payHref = q.payUrl || `/pay/${publicId}`;
  const waBiz = `https://wa.me/${String(b.phone || "").replace(/\D/g, "")}?text=${encodeURIComponent(
    `Hi ${b.name}, it's ${q.clientName || "me"} on quote ${q.number}.`
  )}`;

  app.innerHTML = `
    <article class="sheet">
      <header class="hdr">
        <div style="display:flex;gap:12px;align-items:center">
          ${logo}
          <div class="biz">
            <h1>${esc(b.name)}</h1>
            <p>${esc([b.trade, b.city, prettyPhone(b.phone)].filter(Boolean).join(" · "))}</p>
          </div>
        </div>
        <div class="meta">
          <b>${esc(q.number)}</b>
          ${fmtDate(q.createdAt)}<br>
          Valid to ${fmtDate(q.validUntil)}
        </div>
      </header>
      <section class="who">
        <div>
          <h2>Prepared for</h2>
          <p>${esc(q.clientName || "Client")}${q.site ? `<br>${esc(q.site)}` : ""}</p>
        </div>
        <div>
          <h2>Deposit to book</h2>
          <p style="font-family:var(--mono);font-size:20px">${zar(q.depositAmount)} <span style="font-size:13px;color:var(--soft)">${q.depositPct}%</span></p>
        </div>
      </section>
      <table>
        <thead>
          <tr><th>Item</th><th>Qty</th><th class="num">Rate</th><th class="num">Amount</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="sums">
        <div><span>Subtotal</span><span>${zar(q.subtotal)}</span></div>
        <div><span>${vatLabel(q.vatMode)}</span><span>${zar(q.vat)}</span></div>
        <div class="big"><span>Total</span><span>${zar(q.total)}</span></div>
        <div class="dep"><span>Due now</span><span>${zar(q.depositAmount)}</span></div>
      </div>
      ${q.notes ? `<div class="notes"><h3>Notes</h3><p>${esc(q.notes)}</p></div>` : ""}
      ${b.terms ? `<div class="terms"><h3>Terms</h3><p>${esc(b.terms)}</p></div>` : ""}
      ${banner}
      <div class="actions no-print">
        ${error ? `<p class="err">${esc(error)}</p>` : ""}
        ${
          canAct
            ? `<input id="sign" type="text" placeholder="Type your name to accept" value="${esc(name)}">
               <button class="btn btn-accept" id="accept">Accept this quote</button>
               <button class="btn btn-ghost" id="decline">Decline</button>`
            : ""
        }
        ${
          q.status !== "paid" && q.status !== "declined" && q.status !== "expired"
            ? `<a class="btn btn-pay" href="${esc(payHref)}">Pay ${zar(q.depositAmount)} deposit</a>`
            : ""
        }
        ${q.status === "accepted" || q.status === "paid" ? bank : canAct ? "" : bank}
        ${q.status === "accepted" && !payHref ? bank : ""}
        <a class="btn btn-wa" href="${esc(waBiz)}">WhatsApp ${esc(b.name)}</a>
        <button class="btn btn-ghost" id="pdf">Save / print PDF</button>
      </div>
    </article>
    <p class="foot">KWOTA</p>`;

  document.title = `${q.number} · ${b.name}`;
  document.getElementById("sign")?.addEventListener("input", (e) => {
    name = e.target.value;
  });
  document.getElementById("accept")?.addEventListener("click", accept);
  document.getElementById("decline")?.addEventListener("click", decline);
  document.getElementById("pdf")?.addEventListener("click", () => window.print());
}

async function accept() {
  error = "";
  try {
    const data = await api(`/api/public/${publicId}/accept`, { method: "POST", body: { name } });
    quote = data.quote;
  } catch (e) {
    error = e.message;
  }
  render();
}

async function decline() {
  if (!confirm("Decline this quote?")) return;
  error = "";
  try {
    const data = await api(`/api/public/${publicId}/decline`, { method: "POST", body: { reason: "" } });
    quote = data.quote;
  } catch (e) {
    error = e.message;
  }
  render();
}

async function load() {
  try {
    const data = await api(`/api/public/${publicId}`);
    quote = data.quote;
    name = quote.clientName || "";
    render();
  } catch (e) {
    error = e.message;
    render();
  }
}

load();
