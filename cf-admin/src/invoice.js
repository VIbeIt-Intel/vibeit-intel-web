import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const LOGO_URL = "https://vibeit-intel.net/assets/v-it-mark.png";
const SITE = "https://vibeit-intel.net";

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
    legalName: String(env.VIBEIT_LEGAL_NAME || env.VIBEIT_ACCOUNT_NAME || "VIBEIT-INTEL (Pty) Ltd").trim() || "VIBEIT-INTEL (Pty) Ltd",
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
  if (/advance|custom platform|order book/i.test(raw)) return 0;
  if (/intermediate|booking/i.test(raw)) return 2500;
  const match = raw.match(/R\s*([\d,]+)/i);
  if (match) return Number(match[1].replace(/,/g, "")) || 0;
  return 1105;
}

export function formatRand(amount) {
  const n = Math.round(Number(amount) || 0);
  return "R" + String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function quoteLabel(kind) {
  return kind === "invoice" ? "Invoice" : "Quote";
}

export function quoteSubject(kind, number, businessName) {
  const who = String(businessName || "your business").trim();
  return quoteLabel(kind) + " " + number + " — " + who + " — VibeIt-Intel";
}

export function quoteText(doc) {
  const kind = doc.kind === "invoice" ? "invoice" : "quote";
  const lines = [
    "Hi " + (doc.businessName || "there") + ",",
    "",
    kind === "invoice"
      ? "Your VibeIt-Intel invoice is attached."
      : "Your VibeIt-Intel quote is attached. Pay this to start — it stays open for 14 days.",
    "",
    quoteLabel(doc.kind) + " " + doc.number,
    pdfSafeKeep(doc.description),
    "Total due: " + formatRand(doc.amount),
    "",
    "Bank details and the payment reference are on the attached " + kind + ".",
    "Payment starts the work. Terms: " + SITE + "/terms.html",
    "",
    "Questions: support@vibeit-intel.net or WhatsApp 068 943 4124",
    SITE.replace("https://", ""),
  ];
  if (doc.note) {
    lines.splice(8, 0, "", doc.note);
  }
  return lines.join("\n");
}

function pdfSafeKeep(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

export function quoteCoverHtml(doc) {
  const kind = quoteLabel(doc.kind);
  const intro =
    doc.kind === "invoice"
      ? "Your invoice is attached. Pay using the bank details on that document."
      : "Your quote is attached. Pay using the bank details on that document to start — it stays open for 14 days.";
  return [
    '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" /></head>',
    '<body style="margin:0;background:#f3eef8;color:#160c22;font-family:Segoe UI,Helvetica,Arial,sans-serif;">',
    '<div style="max-width:560px;margin:0 auto;padding:24px 12px 32px;">',
    '<table width="100%" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;border:1px solid #ece4f4;">',
    '<tr><td style="background:#12091a;padding:20px 24px;">',
    '<table width="100%" cellpadding="0" cellspacing="0"><tr>',
    '<td style="vertical-align:middle;padding-right:12px;width:72px;">',
    '<img src="' + LOGO_URL + '" alt="VibeIt-Intel" width="64" height="60" style="display:block;border:0;" />',
    "</td>",
    '<td style="vertical-align:middle;color:#fff;">',
    '<div style="font-size:18px;font-weight:800;">VibeIt-Intel</div>',
    '<div style="margin-top:4px;font-size:12px;color:#cbbfd8;">Websites for South African businesses</div>',
    "</td></tr></table></td></tr>",
    '<tr><td style="height:4px;background:linear-gradient(90deg,#00c8c9,#ff8a1a,#4a1f7a);font-size:0;line-height:0;">&nbsp;</td></tr>',
    '<tr><td style="padding:28px 24px 8px;font-size:15px;line-height:1.55;color:#3b2f46;">',
    "<p style=\"margin:0 0 14px;\">Hi " + escapeHtml(doc.businessName || "there") + ",</p>",
    "<p style=\"margin:0 0 14px;\">" + escapeHtml(intro) + "</p>",
    "</td></tr>",
    '<tr><td style="padding:0 24px 8px;">',
    '<table width="100%" cellpadding="0" cellspacing="0" style="background:#f6f1fb;border-radius:12px;">',
    '<tr><td style="padding:16px 18px;">',
    '<div style="font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#00a3a4;">' +
      escapeHtml(kind) +
      " " +
      escapeHtml(doc.number) +
      "</div>",
    '<div style="margin-top:8px;font-size:15px;font-weight:600;color:#160c22;">' +
      escapeHtml(doc.description) +
      "</div>",
    '<div style="margin-top:10px;font-size:22px;font-weight:800;color:#4a1f7a;">' +
      escapeHtml(formatRand(doc.amount)) +
      "</div>",
    "</td></tr></table></td></tr>",
    '<tr><td style="padding:18px 24px 28px;font-size:14px;line-height:1.55;color:#5c4e6a;">',
    "<p style=\"margin:0 0 14px;\">Open the attached PDF for the EFT details. Use <strong style=\"color:#160c22;\">" +
      escapeHtml(doc.number) +
      "</strong> as the payment reference.</p>",
    '<p style="margin:0;">Questions: <a href="mailto:support@vibeit-intel.net" style="color:#00a3a4;">support@vibeit-intel.net</a> or WhatsApp 068 943 4124</p>',
    "</td></tr></table>",
    '<p style="margin:16px 8px 0;font-size:12px;color:#8a7b96;">' +
      escapeHtml(doc.bank.legalName) +
      " · vibeit-intel.net</p>",
    "</div></body></html>",
  ].join("");
}

export function quoteGmail(doc) {
  const to = String(doc.toEmail || "").trim();
  if (!to) return "";
  const params = new URLSearchParams({
    view: "cm",
    fs: "1",
    to: to,
    bcc: "support@vibeit-intel.net",
    su: quoteSubject(doc.kind, doc.number, doc.businessName),
    body: quoteText(doc),
  });
  return "https://mail.google.com/mail/u/0/?" + params.toString();
}

function metaLine(doc) {
  const bits = [];
  if (doc.bank.registration) bits.push("Reg. " + doc.bank.registration);
  if (doc.bank.vat) bits.push("VAT " + doc.bank.vat);
  return bits.join(" · ");
}

export async function loadLogoBytes() {
  try {
    const res = await fetch(LOGO_URL);
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch (err) {
    return null;
  }
}

function pdfSafe(text) {
  return String(text || "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/·/g, "-")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wrapLines(text, font, size, maxWidth) {
  const words = pdfSafe(text).split(" ").filter(Boolean);
  const lines = [];
  let line = "";
  words.forEach(function (word) {
    const next = line ? line + " " + word : word;
    if (line && font.widthOfTextAtSize(next, size) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  });
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

export function quoteHtml(doc, opts) {
  const printable = Boolean(opts && opts.printable);
  const kind = quoteLabel(doc.kind);
  const logoSrc = opts && opts.logoCid ? "cid:" + opts.logoCid : LOGO_URL;
  const intro =
    doc.kind === "invoice"
      ? "Please pay this invoice to the account below."
      : "Pay this quote to start. It stays open for 14 days.";
  const note = doc.note
    ? "<tr><td colspan=\"2\" style=\"padding:12px 0 0;color:#5c4e6a;font-size:14px;white-space:pre-wrap;\">" +
      escapeHtml(doc.note) +
      "</td></tr>"
    : "";
  const branch = doc.bank.branch
    ? "<tr><td style=\"padding:4px 0;color:#cbbfd8;\">Branch</td><td style=\"padding:4px 0;text-align:right;font-weight:700;\">" +
      escapeHtml(doc.bank.branch) +
      "</td></tr>"
    : "";
  const swift = doc.bank.swift
    ? "<tr><td style=\"padding:4px 0;color:#cbbfd8;\">SWIFT</td><td style=\"padding:4px 0;text-align:right;font-weight:700;\">" +
      escapeHtml(doc.bank.swift) +
      "</td></tr>"
    : "";
  const email = doc.toEmail
    ? "<div style=\"color:#5c4e6a;font-size:13px;\">" + escapeHtml(doc.toEmail) + "</div>"
    : "";
  const printHint = printable
    ? "<p class=\"hint\" style=\"margin:0 0 16px;color:#5c4e6a;font-size:13px;\">Use the PDF download on the board to attach this quote. This page is a print copy.</p>"
    : "";
  const meta = metaLine(doc);

  return [
    "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"UTF-8\" />",
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />",
    "<title>" + escapeHtml(kind + " " + doc.number) + "</title>",
    "<style>@media print{body{background:#fff!important} .hint{display:none}}</style>",
    "</head><body style=\"margin:0;background:#f3eef8;color:#160c22;font-family:Segoe UI,Helvetica,Arial,sans-serif;\">",
    "<div style=\"max-width:640px;margin:0 auto;padding:24px 12px 40px;\">",
    printHint,
    "<table width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"background:#fff;border-radius:16px;overflow:hidden;border:1px solid #ece4f4;\">",
    "<tr><td style=\"background:#12091a;padding:22px 28px;\">",
    "<table width=\"100%\" cellpadding=\"0\" cellspacing=\"0\"><tr>",
    "<td style=\"vertical-align:middle;\">",
    "<table cellpadding=\"0\" cellspacing=\"0\"><tr>",
    "<td style=\"vertical-align:middle;padding-right:14px;\">",
    "<img src=\"" +
      logoSrc +
      "\" alt=\"VibeIt-Intel\" width=\"72\" height=\"68\" style=\"display:block;border:0;\" />",
    "</td>",
    "<td style=\"vertical-align:middle;color:#fff;\">",
    "<div style=\"font-size:18px;font-weight:800;letter-spacing:-0.03em;\">VibeIt-Intel</div>",
    "<div style=\"margin-top:4px;font-size:12px;color:#cbbfd8;\">Websites for South African businesses</div>",
    "</td></tr></table>",
    "</td>",
    "<td align=\"right\" style=\"vertical-align:middle;color:#fff;\">",
    "<div style=\"font-size:11px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:#00c8c9;\">" +
      escapeHtml(kind) +
      "</div>",
    "<div style=\"font-size:22px;font-weight:800;letter-spacing:-0.03em;\">" +
      escapeHtml(doc.number) +
      "</div>",
    "<div style=\"margin-top:6px;font-size:12px;color:#cbbfd8;\">" +
      escapeHtml(doc.createdAt || "") +
      "</div>",
    "</td></tr></table></td></tr>",
    "<tr><td style=\"height:4px;background:linear-gradient(90deg,#00c8c9,#ff8a1a,#4a1f7a);font-size:0;line-height:0;\">&nbsp;</td></tr>",
    "<tr><td style=\"padding:28px;\">",
    "<table width=\"100%\" cellpadding=\"0\" cellspacing=\"0\"><tr>",
    "<td style=\"vertical-align:top;padding-right:16px;\">",
    "<div style=\"font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#00a3a4;\">From</div>",
    "<div style=\"margin-top:6px;font-size:16px;font-weight:700;\">" +
      escapeHtml(doc.bank.legalName) +
      "</div>",
    "<div style=\"margin-top:4px;color:#5c4e6a;font-size:13px;line-height:1.5;\">" +
      (meta ? escapeHtml(meta) + "<br/>" : "") +
      "support@vibeit-intel.net<br/>WhatsApp 068 943 4124</div>",
    "</td>",
    "<td style=\"vertical-align:top;text-align:right;\">",
    "<div style=\"font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#00a3a4;\">Bill to</div>",
    "<div style=\"margin-top:6px;font-size:16px;font-weight:700;\">" +
      escapeHtml(doc.businessName || "Client") +
      "</div>",
    email,
    "</td></tr></table>",
    "<p style=\"margin:22px 0 0;color:#3b2f46;font-size:15px;line-height:1.5;\">" +
      escapeHtml(intro) +
      "</p>",
    "<table width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"margin-top:22px;border-collapse:collapse;\">",
    "<tr style=\"background:#f6f1fb;\">",
    "<th align=\"left\" style=\"padding:10px 12px;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#5c4e6a;\">Description</th>",
    "<th align=\"right\" style=\"padding:10px 12px;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#5c4e6a;\">Amount</th>",
    "</tr>",
    "<tr>",
    "<td style=\"padding:14px 12px;border-bottom:1px solid #efe7f5;font-size:15px;\">" +
      escapeHtml(doc.description) +
      "<div style=\"margin-top:4px;color:#5c4e6a;font-size:13px;\">Once-off · South African Rand</div></td>",
    "<td align=\"right\" style=\"padding:14px 12px;border-bottom:1px solid #efe7f5;font-size:18px;font-weight:800;color:#4a1f7a;\">" +
      escapeHtml(formatRand(doc.amount)) +
      "</td></tr>",
    "<tr>",
    "<td style=\"padding:14px 12px;font-size:14px;font-weight:700;\">Total due</td>",
    "<td align=\"right\" style=\"padding:14px 12px;font-size:22px;font-weight:800;color:#160c22;\">" +
      escapeHtml(formatRand(doc.amount)) +
      "</td></tr>",
    note,
    "</table>",
    "<table width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"margin-top:24px;background:#12091a;color:#fff;border-radius:12px;\">",
    "<tr><td style=\"padding:20px 22px;\">",
    "<div style=\"font-size:11px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:#00c8c9;\">Pay by EFT</div>",
    "<table width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"margin-top:10px;color:#fff;font-size:14px;\">",
    "<tr><td style=\"padding:4px 0;color:#cbbfd8;\">Account name</td><td style=\"padding:4px 0;text-align:right;font-weight:700;\">" +
      escapeHtml(doc.bank.accountName) +
      "</td></tr>",
    "<tr><td style=\"padding:4px 0;color:#cbbfd8;\">Bank</td><td style=\"padding:4px 0;text-align:right;font-weight:700;\">" +
      escapeHtml(doc.bank.bank) +
      "</td></tr>",
    "<tr><td style=\"padding:4px 0;color:#cbbfd8;\">Account</td><td style=\"padding:4px 0;text-align:right;font-weight:700;\">" +
      escapeHtml(doc.bank.accountNumber) +
      "</td></tr>",
    branch,
    swift,
    "<tr><td style=\"padding:10px 0 4px;color:#cbbfd8;\">Reference</td><td style=\"padding:10px 0 4px;text-align:right;font-weight:800;color:#00c8c9;\">" +
      escapeHtml(doc.number) +
      "</td></tr>",
    "</table>",
    "<p style=\"margin:14px 0 0;color:#cbbfd8;font-size:13px;\">Payment starts the work. <a href=\"" +
      SITE +
      "/terms.html\" style=\"color:#ff8a1a;\">Terms</a></p>",
    "</td></tr></table>",
    "<p style=\"margin:22px 0 0;color:#5c4e6a;font-size:12px;line-height:1.5;\">" +
      escapeHtml(doc.bank.legalName) +
      " · " +
      SITE.replace("https://", "") +
      "<br/>support@vibeit-intel.net · WhatsApp 068 943 4124</p>",
    "</td></tr></table></div></body></html>",
  ].join("");
}

function drawText(page, text, x, y, size, font, color) {
  const value = pdfSafe(text);
  if (!value) return;
  page.drawText(value, { x: x, y: y, size: size, font: font, color: color });
}

export async function quotePdf(doc, logoBytes) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]);
  const width = page.getWidth();
  const height = page.getHeight();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.09, 0.05, 0.13);
  const muted = rgb(0.36, 0.31, 0.42);
  const white = rgb(1, 1, 1);
  const teal = rgb(0, 0.78, 0.79);
  const orange = rgb(1, 0.54, 0.1);
  const purple = rgb(0.29, 0.12, 0.48);
  const kind = quoteLabel(doc.kind);
  const headerH = 118;

  page.drawRectangle({ x: 0, y: height - headerH, width: width, height: headerH, color: rgb(0.07, 0.04, 0.1) });
  page.drawRectangle({ x: 0, y: height - headerH - 4, width: width * 0.38, height: 4, color: teal });
  page.drawRectangle({ x: width * 0.38, y: height - headerH - 4, width: width * 0.32, height: 4, color: orange });
  page.drawRectangle({ x: width * 0.7, y: height - headerH - 4, width: width * 0.3, height: 4, color: purple });

  let brandX = 36;
  const bytes = logoBytes || (await loadLogoBytes());
  if (bytes && bytes.length) {
    try {
      const img = await pdf.embedPng(bytes);
      let imgH = 56;
      let imgW = (img.width / img.height) * imgH;
      if (imgW > 92) {
        imgW = 92;
        imgH = (img.height / img.width) * imgW;
      }
      page.drawImage(img, { x: 36, y: height - 36 - imgH, width: imgW, height: imgH });
      brandX = 36 + imgW + 12;
    } catch (err) {}
  }
  drawText(page, "VibeIt-Intel", brandX, height - 58, 16, bold, white);
  drawText(page, "Websites for South African businesses", brandX, height - 76, 9, font, rgb(0.8, 0.75, 0.85));

  drawText(page, kind.toUpperCase(), 400, height - 48, 10, bold, teal);
  drawText(page, pdfSafe(doc.number), 400, height - 70, 16, bold, white);
  drawText(page, pdfSafe(doc.createdAt || ""), 400, height - 88, 10, font, rgb(0.8, 0.75, 0.85));

  let y = height - 156;
  drawText(page, "FROM", 36, y, 9, bold, teal);
  drawText(page, "BILL TO", 320, y, 9, bold, teal);
  y -= 18;
  const fromLines = wrapLines(doc.bank.legalName, bold, 12, 260);
  const toLines = wrapLines(doc.businessName || "Client", bold, 12, 230);
  const nameRows = Math.max(fromLines.length, toLines.length);
  for (let i = 0; i < nameRows; i += 1) {
    if (fromLines[i]) drawText(page, fromLines[i], 36, y, 12, bold, ink);
    if (toLines[i]) drawText(page, toLines[i], 320, y, 12, bold, ink);
    y -= 14;
  }
  drawText(page, "support@vibeit-intel.net", 36, y, 10, font, muted);
  if (doc.toEmail) drawText(page, doc.toEmail, 320, y, 10, font, muted);
  y -= 14;
  drawText(page, "WhatsApp 068 943 4124", 36, y, 10, font, muted);
  if (doc.bank.registration) {
    y -= 14;
    drawText(page, "Reg. " + doc.bank.registration, 36, y, 10, font, muted);
  }
  if (doc.bank.vat) {
    y -= 14;
    drawText(page, "VAT " + doc.bank.vat, 36, y, 10, font, muted);
  }

  y -= 26;
  const intro =
    doc.kind === "invoice"
      ? "Please pay this invoice to the account below."
      : "Pay this quote to start. It stays open for 14 days.";
  drawText(page, intro, 36, y, 11, font, ink);

  y -= 28;
  page.drawRectangle({ x: 36, y: y - 8, width: width - 72, height: 26, color: rgb(0.96, 0.94, 0.98) });
  drawText(page, "DESCRIPTION", 48, y, 9, bold, muted);
  drawText(page, "AMOUNT", 490, y, 9, bold, muted);
  y -= 32;
  const descLines = wrapLines(doc.description || "VibeIt website", font, 12, 390);
  descLines.forEach(function (line, i) {
    drawText(page, line, 48, y, 12, font, ink);
    if (i === 0) drawText(page, formatRand(doc.amount), 455, y, 14, bold, purple);
    y -= 15;
  });
  drawText(page, "Once-off - South African Rand", 48, y, 10, font, muted);
  y -= 26;
  page.drawLine({
    start: { x: 36, y: y + 10 },
    end: { x: width - 36, y: y + 10 },
    thickness: 1,
    color: rgb(0.93, 0.9, 0.96),
  });
  drawText(page, "Total due", 48, y, 12, bold, ink);
  drawText(page, formatRand(doc.amount), 430, y, 18, bold, ink);

  if (doc.note) {
    y -= 22;
    wrapLines(doc.note, font, 10, width - 80).slice(0, 3).forEach(function (line) {
      drawText(page, line, 36, y, 10, font, muted);
      y -= 13;
    });
  }

  const pay = [
    ["Account name", doc.bank.accountName],
    ["Bank", doc.bank.bank],
    ["Account", doc.bank.accountNumber],
  ];
  if (doc.bank.branch) pay.push(["Branch", doc.bank.branch]);
  if (doc.bank.swift) pay.push(["SWIFT", doc.bank.swift]);
  pay.push(["Reference", doc.number]);
  const boxH = 36 + pay.length * 16 + 12;
  y -= 28;
  page.drawRectangle({ x: 36, y: y - boxH + 18, width: width - 72, height: boxH, color: rgb(0.07, 0.04, 0.1) });
  drawText(page, "PAY BY EFT", 52, y, 9, bold, teal);
  y -= 22;
  pay.forEach(function (row) {
    drawText(page, row[0], 52, y, 10, font, rgb(0.8, 0.75, 0.85));
    drawText(page, row[1], 250, y, 11, bold, row[0] === "Reference" ? teal : white);
    y -= 16;
  });

  y -= 28;
  drawText(page, "Payment starts the work. Terms: vibeit-intel.net/terms.html", 36, y, 10, font, muted);
  y -= 14;
  drawText(page, "VibeIt-Intel  -  support@vibeit-intel.net  -  WhatsApp 068 943 4124", 36, y, 10, font, muted);

  page.drawRectangle({ x: 0, y: 0, width: width, height: 8, color: rgb(0.07, 0.04, 0.1) });
  page.drawRectangle({ x: 0, y: 8, width: width * 0.38, height: 3, color: teal });
  page.drawRectangle({ x: width * 0.38, y: 8, width: width * 0.32, height: 3, color: orange });
  page.drawRectangle({ x: width * 0.7, y: 8, width: width * 0.3, height: 3, color: purple });

  return pdf.save();
}
