function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function bankFromEnv(env) {
  const accountName = String(env.VIBEIT_ACCOUNT_NAME || "").trim();
  const bank = String(env.VIBEIT_BANK || "").trim();
  const accountNumber = String(env.VIBEIT_ACCOUNT_NUMBER || "").trim();
  const branch = String(env.VIBEIT_BRANCH || "").trim();
  return {
    legalName: String(env.VIBEIT_LEGAL_NAME || env.VIBEIT_ACCOUNT_NAME || "VibeIt-Intel").trim() || "VibeIt-Intel",
    registration: String(env.VIBEIT_REGISTRATION || "").trim(),
    vat: String(env.VIBEIT_VAT || "").trim(),
    accountName: accountName,
    bank: bank,
    accountNumber: accountNumber,
    branch: branch,
    swift: String(env.VIBEIT_SWIFT || "").trim(),
    ready: Boolean(accountName && bank && accountNumber),
  };
}

export function packageAmount(row) {
  const raw = String((row && row.package) || "");
  if (/advance|custom platform/i.test(raw)) return 0;
  if (/intermediate|booking/i.test(raw)) return 2500;
  const match = raw.match(/R\s*([\d,]+)/i);
  if (match) return Number(match[1].replace(/,/g, "")) || 0;
  return 1105;
}

export function formatRand(amount) {
  const n = Math.round(Number(amount) || 0);
  return "R" + n.toLocaleString("en-ZA");
}

export function quoteSubject(kind, number, businessName) {
  const label = kind === "invoice" ? "Invoice" : "Quote";
  const who = String(businessName || "your business").trim();
  return label + " " + number + " — " + who + " — VibeIt-Intel";
}

export function quoteText(doc) {
  const kind = doc.kind === "invoice" ? "invoice" : "quote";
  const lines = [
    "Hi " + (doc.businessName || "there") + ",",
    "",
    kind === "invoice"
      ? "Here is your invoice from VibeIt-Intel."
      : "Here is your quote from VibeIt-Intel. Pay this to start, and it stays open for 14 days.",
    "",
    doc.number + "  ·  " + doc.description,
    formatRand(doc.amount) + " once-off",
    "",
    "Pay to:",
    doc.bank.accountName,
    doc.bank.bank,
    "Account " + doc.bank.accountNumber,
  ];
  if (doc.bank.branch) lines.push("Branch " + doc.bank.branch);
  if (doc.bank.swift) lines.push("SWIFT " + doc.bank.swift);
  if (doc.bank.registration) lines.push("Reg. " + doc.bank.registration);
  if (doc.bank.vat) lines.push("VAT " + doc.bank.vat);
  if (doc.note) {
    lines.push("");
    lines.push(doc.note);
  }
  lines.push("");
  lines.push("Use " + doc.number + " as the payment reference.");
  lines.push("");
  lines.push("Questions: support@vibeit-intel.net or WhatsApp 068 943 4124");
  lines.push("vibeit-intel.net");
  return lines.join("\n");
}

export function quoteMailto(doc) {
  const to = String(doc.toEmail || "").trim();
  if (!to) return "";
  return (
    "mailto:" +
    encodeURIComponent(to) +
    "?bcc=" +
    encodeURIComponent("support@vibeit-intel.net") +
    "&subject=" +
    encodeURIComponent(quoteSubject(doc.kind, doc.number, doc.businessName)) +
    "&body=" +
    encodeURIComponent(quoteText(doc))
  );
}

export function quoteHtml(doc, opts) {
  const printable = Boolean(opts && opts.printable);
  const kind = doc.kind === "invoice" ? "Invoice" : "Quote";
  const intro =
    doc.kind === "invoice"
      ? "Please pay this invoice to the account below."
      : "Pay this quote to start. It stays open for 14 days.";
  const vat = doc.bank.vat
    ? "<p class=\"muted\">VAT " + escapeHtml(doc.bank.vat) + "</p>"
    : "";
  const registration = doc.bank.registration
    ? "<p class=\"muted\">Reg. " + escapeHtml(doc.bank.registration) + "</p>"
    : "";
  const branch = doc.bank.branch
    ? "<p>Branch code <strong>" + escapeHtml(doc.bank.branch) + "</strong></p>"
    : "";
  const swift = doc.bank.swift
    ? "<p>SWIFT " + escapeHtml(doc.bank.swift) + "</p>"
    : "";
  const note = doc.note ? "<p class=\"note\">" + escapeHtml(doc.note) + "</p>" : "";
  const printHint = printable
    ? "<p class=\"hint\">Print this page or save it as a PDF if you want a file copy.</p>"
    : "";
  return [
    "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"UTF-8\" />",
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />",
    "<title>" + escapeHtml(kind + " " + doc.number) + "</title>",
    "<style>",
    "body{margin:0;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#160c22;background:#f6f1fb;}",
    ".sheet{max-width:40rem;margin:1.5rem auto;padding:1.6rem 1.4rem 2rem;background:#fff;border-radius:1rem;}",
    "h1{margin:0.2rem 0 0;font-size:1.7rem;letter-spacing:-0.03em;}",
    ".kicker{margin:0;color:#00a3a4;font-size:0.78rem;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;}",
    ".muted,.hint{color:#5c4e6a;}",
    ".hint{font-size:0.85rem;}",
    ".row{display:flex;justify-content:space-between;gap:1rem;margin:1.2rem 0;padding:1rem 0;border-top:1px solid #eee;border-bottom:1px solid #eee;}",
    ".amount{font-size:1.5rem;font-weight:800;}",
    ".pay{background:#f6f1fb;border-radius:0.9rem;padding:1rem 1.1rem;}",
    ".note{white-space:pre-wrap;}",
    "a{color:#4a1f7a;}",
    "@media print{body{background:#fff}.sheet{margin:0;padding:0;border-radius:0}.hint{display:none}}",
    "</style></head><body><div class=\"sheet\">",
    printHint,
    "<p class=\"kicker\">VibeIt-Intel</p>",
    "<h1>" + escapeHtml(kind) + " " + escapeHtml(doc.number) + "</h1>",
    "<p class=\"muted\">" + escapeHtml(doc.createdAt || "") + " · " + escapeHtml(doc.bank.legalName) + "</p>",
    registration,
    vat,
    "<p>To <strong>" + escapeHtml(doc.businessName || "Client") + "</strong></p>",
    "<p>" + escapeHtml(intro) + "</p>",
    "<div class=\"row\"><div><p>" +
      escapeHtml(doc.description) +
      "</p></div><p class=\"amount\">" +
      escapeHtml(formatRand(doc.amount)) +
      "</p></div>",
    note,
    "<div class=\"pay\"><p class=\"kicker\">Pay to</p>",
    "<p><strong>" + escapeHtml(doc.bank.accountName) + "</strong></p>",
    "<p>" + escapeHtml(doc.bank.bank) + "</p>",
    "<p>Account <strong>" + escapeHtml(doc.bank.accountNumber) + "</strong></p>",
    branch,
    swift,
    "<p>Use <strong>" + escapeHtml(doc.number) + "</strong> as the payment reference.</p></div>",
    "<p class=\"muted\">support@vibeit-intel.net · WhatsApp 068 943 4124 · vibeit-intel.net</p>",
    "</div></body></html>",
  ].join("");
}
