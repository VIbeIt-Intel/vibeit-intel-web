import { connect } from "cloudflare:sockets";

const GMAIL_KEY = "vibeit:gmail";
const FROM_EMAIL = "support@vibeit-intel.net";
const FROM_NAME = "VibeIt-Intel";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export async function gmailStatus(env) {
  const creds = await loadCreds(env);
  return {
    connected: Boolean(creds),
    email: creds ? creds.email : "",
    canOauth: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
  };
}

export async function saveGmailAppPassword(env, email, appPassword) {
  const pass = String(appPassword || "").replace(/\s+/g, "");
  if (pass.length < 8) return { error: "That Gmail app password looks too short." };
  await env.FILES.put(
    GMAIL_KEY,
    JSON.stringify({
      email: String(email || FROM_EMAIL).trim().toLowerCase() || FROM_EMAIL,
      appPassword: pass,
    })
  );
  return { ok: true };
}

export async function saveGmailRefresh(env, email, refreshToken) {
  if (!refreshToken) return { error: "Google did not return a refresh token. Try Connect Gmail again." };
  await env.FILES.put(
    GMAIL_KEY,
    JSON.stringify({
      email: String(email || FROM_EMAIL).trim().toLowerCase() || FROM_EMAIL,
      refreshToken: refreshToken,
    })
  );
  return { ok: true };
}

async function loadCreds(env) {
  if (env.GMAIL_APP_PASSWORD) {
    return {
      email: String(env.GMAIL_USER || FROM_EMAIL).trim() || FROM_EMAIL,
      appPassword: String(env.GMAIL_APP_PASSWORD).replace(/\s+/g, ""),
    };
  }
  if (env.GMAIL_REFRESH_TOKEN) {
    return {
      email: String(env.GMAIL_USER || FROM_EMAIL).trim() || FROM_EMAIL,
      refreshToken: String(env.GMAIL_REFRESH_TOKEN),
    };
  }
  try {
    const raw = await env.FILES.get(GMAIL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && (parsed.appPassword || parsed.refreshToken)) return parsed;
  } catch (err) {}
  return null;
}

export async function sendViaGmail(env, message) {
  const creds = await loadCreds(env);
  if (!creds) return { sent: false };
  if (creds.refreshToken) {
    const api = await sendGmailApi(env, creds, buildMime(creds.email, message, true));
    if (api.sent) return api;
    if (!creds.appPassword) return api;
  }
  if (creds.appPassword) return sendGmailSmtp(creds, buildMime(creds.email, message, false), message);
  return { sent: false };
}

function headerValue(text) {
  const value = String(text || "").replace(/[\r\n]+/g, " ");
  if (/^[\x20-\x7E]*$/.test(value)) return value;
  const bytes = encoder.encode(value);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return "=?UTF-8?B?" + btoa(binary) + "?=";
}

function toB64(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : encoder.encode(String(bytes || ""));
  const chunk = 0x8000;
  let binary = "";
  for (let i = 0; i < data.length; i += chunk) {
    binary += String.fromCharCode.apply(null, data.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function wrap76(b64) {
  return String(b64 || "").replace(/.{1,76}/g, "$&\r\n").trim();
}

function toBase64Url(raw) {
  const b64 = toB64(encoder.encode(raw));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function buildMime(fromEmail, message, includeBcc) {
  const boundary = "vibeit_" + crypto.randomUUID().replace(/-/g, "");
  const alt = "alt_" + crypto.randomUUID().replace(/-/g, "");
  const from = FROM_NAME + " <" + (fromEmail || FROM_EMAIL) + ">";
  const lines = [
    "From: " + from,
    "To: " + message.to,
  ];
  if (includeBcc && message.bcc) lines.push("Bcc: " + message.bcc);
  lines.push(
    "Date: " + new Date().toUTCString(),
    "Subject: " + headerValue(message.subject),
    "MIME-Version: 1.0",
    "Content-Type: multipart/mixed; boundary=\"" + boundary + "\"",
    "",
    "--" + boundary,
    "Content-Type: multipart/alternative; boundary=\"" + alt + "\"",
    "",
    "--" + alt,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(toB64(encoder.encode(message.text || ""))),
    "--" + alt,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(toB64(encoder.encode(message.html || ""))),
    "--" + alt + "--"
  );
  if (message.pdfBytes && message.filename) {
    lines.push(
      "--" + boundary,
      "Content-Type: application/pdf; name=\"" + message.filename + "\"",
      "Content-Disposition: attachment; filename=\"" + message.filename + "\"",
      "Content-Transfer-Encoding: base64",
      "",
      wrap76(toB64(message.pdfBytes)),
    );
  }
  lines.push("--" + boundary + "--", "");
  return lines.join("\r\n");
}

async function sendGmailApi(env, creds, raw) {
  const token = await gmailAccessToken(env, creds.refreshToken);
  if (!token.ok) return { sent: false, error: token.error || "Gmail login expired. Connect Gmail again." };
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token.accessToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw: toBase64Url(raw) }),
  });
  if (!res.ok) {
    const body = await res.json().catch(function () {
      return {};
    });
    return { sent: false, error: body.error && body.error.message ? body.error.message : "Gmail did not send." };
  }
  return { sent: true, via: "gmail" };
}

async function gmailAccessToken(env, refreshToken) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const body = await res.json().catch(function () {
    return {};
  });
  if (!res.ok || !body.access_token) {
    return { ok: false, error: body.error_description || "Gmail login expired. Connect Gmail again." };
  }
  return { ok: true, accessToken: body.access_token };
}

async function sendGmailSmtp(creds, raw, message) {
  const socket = connect({
    hostname: "smtp.gmail.com",
    port: 465,
    secureTransport: "on",
  });
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();
  const read = makeReader(reader);
  try {
    await expect(read, writer, null, [220]);
    await expect(read, writer, "EHLO vibeit-intel.net", [250]);
    await expect(read, writer, "AUTH LOGIN", [334]);
    await expect(read, writer, toB64(encoder.encode(creds.email)), [334]);
    await expect(read, writer, toB64(encoder.encode(creds.appPassword)), [235]);
    await expect(read, writer, "MAIL FROM:<" + creds.email + ">", [250]);
    await expect(read, writer, "RCPT TO:<" + message.to + ">", [250]);
    if (message.bcc) await expect(read, writer, "RCPT TO:<" + message.bcc + ">", [250, 251]);
    await expect(read, writer, "DATA", [354]);
    await writer.write(encoder.encode(raw.replace(/^\./gm, "..") + "\r\n.\r\n"));
    await expect(read, writer, null, [250]);
    await expect(read, writer, "QUIT", [221, 250]);
    return { sent: true, via: "gmail" };
  } catch (err) {
    return { sent: false, error: err.message || "Gmail did not send." };
  } finally {
    try {
      writer.releaseLock();
    } catch (err) {}
    try {
      await socket.close();
    } catch (err) {}
  }
}

function makeReader(reader) {
  let buf = "";
  return async function readResponse() {
    while (true) {
      const done = buf.split("\n").some(function (line) {
        return /^\d{3} /.test(line.replace(/\r$/, ""));
      });
      if (done) {
        const lines = [];
        while (buf) {
          const idx = buf.indexOf("\n");
          if (idx === -1) break;
          const line = buf.slice(0, idx).replace(/\r$/, "");
          buf = buf.slice(idx + 1);
          lines.push(line);
          if (/^\d{3} /.test(line)) return lines.join("\n");
        }
      }
      const next = await reader.read();
      if (next.done) throw new Error("Gmail closed the connection.");
      buf += decoder.decode(next.value, { stream: true });
    }
  };
}

async function expect(read, writer, command, ok) {
  if (command !== null) await writer.write(encoder.encode(command + "\r\n"));
  const line = await read();
  const code = Number(line.slice(0, 3));
  if (ok.indexOf(code) === -1) {
    throw new Error(line.replace(/\s+/g, " ").slice(0, 140) || "Gmail SMTP error");
  }
  return line;
}
