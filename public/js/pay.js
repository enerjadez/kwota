const app = document.querySelector("#app");
const publicId = location.pathname.split("/").filter(Boolean)[1] || "";

const BANKS = ["FNB", "Capitec", "Standard Bank", "Absa", "Nedbank", "TymeBank"];

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
let method = "eft";
let view = "choose"; // choose | wait | done

function render() {
  if (!quote) {
    app.innerHTML = `<div class="sheet pay-wrap"><p>${esc(error || "Quote not found.")}</p></div>`;
    return;
  }
  const q = quote;
  const b = q.business;
  if (q.status === "paid" || view === "done") return renderDone();
  if (q.status === "declined" || q.status === "expired") {
    app.innerHTML = `<div class="sheet pay-wrap"><p>This quote can’t be paid (${esc(q.status)}).</p><a class="btn btn-ghost" href="/q/${esc(publicId)}">Back to quote</a></div>`;
    return;
  }
  if (view === "wait") {
    app.innerHTML = `
      <div class="sheet pay-wrap">
        <div class="wait">
          <div class="spin"></div>
          <b>${method === "card" ? "Charging the card…" : method === "payshap" ? "Sending PayShap request…" : "Opening your bank…"}</b>
          <p class="pay-sub">Demo only. No real money moves.</p>
        </div>
      </div>`;
    return;
  }

  const pane =
    method === "eft"
      ? `<p class="pay-sub">Pick a bank. In production this is Ozow / Paystack Instant EFT — money lands in minutes.</p>
         <div class="banks mt">${BANKS.map((n) => `<button type="button" data-bank="${esc(n)}">${esc(n)}</button>`).join("")}</div>`
      : method === "card"
        ? `<div class="card-fields">
             <input id="cc-num" type="text" inputmode="numeric" placeholder="Card number  ·  any 16 digits" maxlength="19">
             <div class="row">
               <input id="cc-exp" type="text" placeholder="MM / YY" maxlength="7">
               <input id="cc-cvc" type="text" inputmode="numeric" placeholder="CVC" maxlength="4">
             </div>
             <input id="cc-name" type="text" placeholder="Name on card">
             <button class="btn btn-pay" id="do-card">Pay ${zar(q.depositAmount)}</button>
           </div>`
        : method === "payshap"
          ? `<p class="pay-sub">PayShap request to the client’s bank app. Instant, cheap. Demo just completes it.</p>
             <button class="btn btn-pay" id="do-shap">Send PayShap request</button>`
          : `<div class="bank">
               <div><span>Bank</span><b>${esc(b.bankName || "FNB")}</b></div>
               <div><span>Name</span><b>${esc(b.bankAccountName || b.name)}</b></div>
               <div><span>Account</span><b>${esc(b.bankAccount || "62812345678")}</b></div>
               ${b.bankBranch ? `<div><span>Branch</span><b>${esc(b.bankBranch)}</b></div>` : ""}
               <div><span>Reference</span><b>${esc(q.number)}</b></div>
               <div><span>Amount</span><b>${zar(q.depositAmount)}</b></div>
             </div>
             <button class="btn btn-pay mt" id="do-bank">I’ve paid</button>
             <p class="pay-sub">Real EFT is free for you, slower (hours / next day). Demo marks it paid now.</p>`;

  app.innerHTML = `
    <div class="sheet pay-wrap">
      <a class="pay-sub" href="/q/${esc(publicId)}">← Back to ${esc(q.number)}</a>
      <p class="pay-sub" style="margin-top:16px">${esc(b.name)}</p>
      <p class="pay-amt">${zar(q.depositAmount)}</p>
      <p class="pay-sub">Deposit on ${esc(q.number)} · ${esc(q.clientName || "client")}</p>
      <div class="note mt">Demo checkout. No real money. Live jobs would go through Ozow, Yoco, Paystack or PayShap.</div>
      ${error ? `<p class="err">${esc(error)}</p>` : ""}
      <div class="methods">
        ${methodBtn("eft", "Instant EFT  ·  Ozow / pay by bank", "Fastest for SA. ~1.5% · money in minutes", "Best for deposits")}
        ${methodBtn("card", "Card  ·  Yoco / Paystack", "Visa / Mastercard. ~2.9% · same day / T+1", "")}
        ${methodBtn("payshap", "PayShap", "Instant to the business account. Low fee.", "")}
        ${methodBtn("bank", "Bank transfer", "Free. Client pays from their app. Slower.", "")}
      </div>
      <div class="pane">${pane}</div>
    </div>
    <p class="foot">KWOTA</p>`;

  document.querySelectorAll("[data-method]").forEach((el) => {
    el.addEventListener("click", () => {
      method = el.dataset.method;
      render();
    });
  });
  document.querySelectorAll("[data-bank]").forEach((el) => {
    el.addEventListener("click", () => pay("eft"));
  });
  document.getElementById("do-card")?.addEventListener("click", () => pay("card"));
  document.getElementById("do-shap")?.addEventListener("click", () => pay("payshap"));
  document.getElementById("do-bank")?.addEventListener("click", () => pay("bank"));
}

function methodBtn(id, title, sub, tag) {
  return `<button class="method ${method === id ? "on" : ""}" type="button" data-method="${id}">
    <strong>${esc(title)}</strong>
    <span>${esc(sub)}</span>
    ${tag ? `<em>${esc(tag)}</em>` : ""}
  </button>`;
}

function renderDone() {
  const q = quote;
  app.innerHTML = `
    <div class="sheet pay-wrap">
      <div class="done">
        <p class="pay-sub">Deposit received</p>
        <h2>${zar(q.depositAmount)}</h2>
        <p class="pay-sub">${esc(q.number)} is booked. ${esc(q.business.name)} will see it as paid.</p>
        <a class="btn btn-accept mt" href="/q/${esc(publicId)}?paid=1">Back to the quote</a>
      </div>
    </div>
    <p class="foot">KWOTA</p>`;
}

async function pay(kind) {
  error = "";
  method = kind;
  view = "wait";
  render();
  await new Promise((r) => setTimeout(r, kind === "bank" ? 400 : 1400));
  try {
    const data = await api(`/api/public/${publicId}/pay`, { method: "POST", body: { method: kind } });
    quote = data.quote;
    try {
      sessionStorage.setItem("kwota-paid-" + publicId, "1");
    } catch {
      /* ignore */
    }
    view = "done";
  } catch (e) {
    error = e.message;
    view = "choose";
  }
  render();
}

async function load() {
  try {
    const data = await api(`/api/public/${publicId}`);
    quote = data.quote;
    if (quote.status === "paid") view = "done";
    render();
  } catch (e) {
    error = e.message;
    render();
  }
}

load();
