import { chooseShots, makeMarks, scorePhoto } from "./markImages.js";
import { STARTER_FILES } from "./starterFiles.js";
import { effectiveType, formatLook, formatMarkdown, formatPlaybook } from "./siteFormats.js";
import {
  bankFromEnv,
  packageAmount,
  quoteHtml,
  quoteCoverHtml,
  quotePdf,
  quoteFileName,
  quoteScope,
  quoteSubject,
  quoteText,
  loadLogoBytes,
} from "./invoice.js";
import { gmailStatus, saveGmailAppPassword, saveGmailRefresh, sendViaGmail } from "./gmailSend.js";

const COOKIE = "vibeit_admin";
const WEEK = 60 * 60 * 24 * 7;
const encoder = new TextEncoder();

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith("/api") || url.pathname.startsWith("/auth")) {
        const response = await handle(request, env, url);
        return withSecurity(response);
      }
      const page = await env.ASSETS.fetch(request);
      const headers = new Headers(page.headers);
      headers.set("X-Robots-Tag", "noindex, nofollow");
      headers.set("Referrer-Policy", "same-origin");
      return new Response(page.body, { status: page.status, headers });
    } catch (err) {
      return json({ error: "Server error" }, 500);
    }
  },
};

async function handle(request, env, url) {
  const path = url.pathname;
  const method = request.method;

  if (method === "OPTIONS") return cors(request, env, new Response(null, { status: 204 }));

  if (path === "/auth/login" && method === "GET") return startGoogle(request, env, url);
  if (path === "/auth/callback" && method === "GET") return finishGoogle(request, env, url);
  if (path === "/auth/gmail" && method === "GET") return gmailConnectPage(request, env, url);
  if (path === "/auth/gmail/google" && method === "GET") return startGmailGoogle(request, env, url);
  if (path === "/auth/gmail/callback" && method === "GET") return finishGmailGoogle(request, env, url);
  if (path === "/api/gmail" && method === "POST") return saveGmail(request, env);
  if (path === "/auth/password" && method === "POST") return passwordLogin(request, env);
  if (path === "/auth/logout" && method === "POST") return logout(request);
  if (path === "/api/me" && method === "GET") return me(request, env);
  if (path === "/api/briefs" && method === "POST") return createBrief(request, env, url);
  if (path === "/api/briefs" && method === "GET") return listBriefs(request, env);
  if (path === "/api/auth-options" && method === "GET") return authOptions(env);

  const briefMatch = path.match(/^\/api\/briefs\/([^/]+)$/);
  if (briefMatch && method === "GET") return getBrief(request, env, briefMatch[1]);
  if (briefMatch && method === "PATCH") return patchBrief(request, env, briefMatch[1]);
  if (briefMatch && method === "DELETE") return deleteBrief(request, env, briefMatch[1]);

  const filesAdd = path.match(/^\/api\/briefs\/([^/]+)\/files$/);
  if (filesAdd && method === "POST") return addBriefFiles(request, env, filesAdd[1]);

  const fileMatch = path.match(/^\/api\/briefs\/([^/]+)\/file\/(\d+)$/);
  if (fileMatch && method === "GET") return getFile(request, env, fileMatch[1], Number(fileMatch[2]));
  if (fileMatch && method === "PATCH") return patchBriefFile(request, env, fileMatch[1], Number(fileMatch[2]));
  if (fileMatch && method === "DELETE") return deleteBriefFile(request, env, fileMatch[1], Number(fileMatch[2]));

  const buildMatch = path.match(/^\/api\/briefs\/([^/]+)\/build$/);
  if (buildMatch && method === "POST") return startBuild(request, env, buildMatch[1]);
  if (buildMatch && method === "GET") return getBuild(request, env, buildMatch[1]);

  const quotePdfPage = path.match(/^\/api\/briefs\/([^/]+)\/quote\/([^/]+)\.pdf$/);
  if (quotePdfPage && method === "GET") return getQuotePdf(request, env, quotePdfPage[1], quotePdfPage[2]);

  const quotePage = path.match(/^\/api\/briefs\/([^/]+)\/quote\/([^/]+)$/);
  if (quotePage && method === "GET") return getQuotePage(request, env, quotePage[1], quotePage[2]);

  const quoteMatch = path.match(/^\/api\/briefs\/([^/]+)\/quote$/);
  if (quoteMatch && method === "POST") return sendQuote(request, env, quoteMatch[1]);

  return json({ error: "Not found" }, 404);
}

function authOptions(env) {
  return json({
    google: Boolean(env.GOOGLE_CLIENT_ID),
    password: Boolean(env.ADMIN_PASSWORD),
  });
}

async function me(request, env) {
  const email = await currentUser(request, env);
  if (!email) return json({ email: null }, 200);
  const gmail = await gmailStatus(env);
  return json({
    email,
    build: {
      cursor: Boolean(env.CURSOR_API_KEY),
      github: Boolean(env.GITHUB_TOKEN),
    },
    billing: {
      bank: bankFromEnv(env).ready,
      email: Boolean(gmail.connected || env.RESEND_API_KEY),
      gmail: gmail.connected,
    },
  });
}

async function startGoogle(request, env, url) {
  if (!env.GOOGLE_CLIENT_ID || !env.SESSION_SECRET) {
    return json({ error: "Google login is not set up yet" }, 501);
  }
  const state = await signToken({ n: crypto.randomUUID(), t: Date.now() }, env.SESSION_SECRET, 600);
  const redirect = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  redirect.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
  redirect.searchParams.set("redirect_uri", url.origin + "/auth/callback");
  redirect.searchParams.set("response_type", "code");
  redirect.searchParams.set("scope", "openid email profile");
  redirect.searchParams.set("prompt", "select_account");
  redirect.searchParams.set("state", state);
  return new Response(null, {
    status: 302,
    headers: { Location: redirect.toString() },
  });
}

async function finishGoogle(request, env, url) {
  const err = url.searchParams.get("error");
  if (err) return redirectHome("#login-error");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const parsed = await readToken(state, env.SESSION_SECRET);
  if (!code || !parsed) return redirectHome("#login-error");

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: url.origin + "/auth/callback",
      grant_type: "authorization_code",
    }),
  });
  const tokenBody = await tokenRes.json();
  if (!tokenRes.ok || !tokenBody.access_token) return redirectHome("#login-error");

  const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: "Bearer " + tokenBody.access_token },
  });
  const profile = await userRes.json();
  const email = String(profile.email || "").trim().toLowerCase();
  if (!profile.verified_email || !isAllowed(email, env)) return redirectHome("#login-denied");
  return setSession(request, email, env);
}

async function startGmailGoogle(request, env, url) {
  const email = await currentUser(request, env);
  if (!email) return json({ error: "Login required" }, 401);
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.SESSION_SECRET) {
    return redirectHome("#gmail-setup");
  }
  const state = await signToken({ n: crypto.randomUUID(), t: Date.now(), gmail: true }, env.SESSION_SECRET, 600);
  const redirect = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  redirect.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
  redirect.searchParams.set("redirect_uri", url.origin + "/auth/gmail/callback");
  redirect.searchParams.set("response_type", "code");
  redirect.searchParams.set("scope", "openid email https://www.googleapis.com/auth/gmail.send");
  redirect.searchParams.set("access_type", "offline");
  redirect.searchParams.set("prompt", "consent");
  redirect.searchParams.set("login_hint", email);
  redirect.searchParams.set("state", state);
  return new Response(null, { status: 302, headers: { Location: redirect.toString() } });
}

async function finishGmailGoogle(request, env, url) {
  const user = await currentUser(request, env);
  if (!user) return redirectHome("#login-error");
  if (url.searchParams.get("error")) return redirectHome("#gmail-error");
  const code = url.searchParams.get("code");
  const parsed = await readToken(url.searchParams.get("state"), env.SESSION_SECRET);
  if (!code || !parsed || !parsed.gmail) return redirectHome("#gmail-error");
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: url.origin + "/auth/gmail/callback",
      grant_type: "authorization_code",
    }),
  });
  const tokenBody = await tokenRes.json();
  if (!tokenRes.ok || !tokenBody.refresh_token) return redirectHome("#gmail-error");
  const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: "Bearer " + tokenBody.access_token },
  });
  const profile = await userRes.json();
  const email = String(profile.email || "").trim().toLowerCase();
  if (!isAllowed(email, env)) return redirectHome("#gmail-denied");
  await saveGmailRefresh(env, email, tokenBody.refresh_token);
  return redirectHome("#gmail-ok");
}

async function saveGmail(request, env) {
  const email = await currentUser(request, env);
  if (!email) return json({ error: "Login required" }, 401);
  const body = await request.json().catch(function () {
    return {};
  });
  const saved = await saveGmailAppPassword(env, email, body.appPassword);
  if (saved.error) return json({ error: saved.error }, 400);
  return json({ ok: true });
}

function gmailConnectPage(request, env, url) {
  return currentUser(request, env).then(async function (email) {
    if (!email) {
      return new Response(null, { status: 302, headers: { Location: "/" } });
    }
    const status = await gmailStatus(env);
    const html = [
      "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"UTF-8\" />",
      "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />",
      "<title>Connect Gmail</title>",
      "<link rel=\"stylesheet\" href=\"/admin.css?v=12\" />",
      "</head><body>",
      "<div class=\"vibe\" aria-hidden=\"true\"><span class=\"blob teal\"></span><span class=\"blob orange\"></span><span class=\"blob purple\"></span></div>",
      "<div class=\"screen\"><header class=\"top\">",
      "<img src=\"https://vibeit-intel.net/assets/v-it-mark.png\" alt=\"\" width=\"72\" height=\"68\" />",
      "<p>VibeIt-Intel</p></header>",
      "<main class=\"card\">",
      "<p class=\"kicker\">Gmail</p>",
      "<h1>Send quotes from Gmail</h1>",
      status.connected
        ? "<p class=\"lead\">Connected as " +
          String(status.email || email).replace(/</g, "") +
          ". Send quote will email the branded PDF from this inbox.</p>"
        : "<p class=\"lead\">Connect once. After that, Send quote emails the client from support@vibeit-intel.net with the invoice PDF attached. Bank details stay on the PDF.</p>",
      status.canOauth
        ? "<p><a class=\"btn btn-hot\" href=\"/auth/gmail/google\">Continue with Google</a></p>"
        : "",
      "<form id=\"gmail-form\">",
      "<label>Gmail app password for " +
        String(email).replace(/</g, "") +
        "<input name=\"appPassword\" type=\"password\" autocomplete=\"off\" required /></label>",
      "<p class=\"note\">Google account → Security → 2-Step Verification → App passwords. Create one named VibeIt and paste it here. Not your normal Gmail password.</p>",
      "<p id=\"gmail-msg\" class=\"note hidden\"></p>",
      "<button class=\"btn btn-hot\" type=\"submit\">Connect Gmail</button>",
      "</form>",
      "<p style=\"margin-top:16px\"><a class=\"btn btn-ghost\" href=\"/\">Back to requests</a></p>",
      "</main></div>",
      "<script>",
      "document.getElementById('gmail-form').addEventListener('submit', function (event) {",
      "event.preventDefault();",
      "var pass = new FormData(event.target).get('appPassword');",
      "var msg = document.getElementById('gmail-msg');",
      "fetch('/api/gmail', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ appPassword: pass }) })",
      ".then(function (res) { return res.json().then(function (body) { if (!res.ok) throw new Error(body.error || 'Could not connect'); return body; }); })",
      ".then(function () { location.href = '/#gmail-ok'; })",
      ".catch(function (err) { msg.textContent = err.message; msg.classList.remove('hidden'); });",
      "});",
      "</script></body></html>",
    ].join("");
    return new Response(html, {
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" },
    });
  });
}

async function passwordLogin(request, env) {
  if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET) {
    return json({ error: "Password login is not set up" }, 501);
  }
  const body = await request.json().catch(function () {
    return {};
  });
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  if (!isAllowed(email, env) || password !== env.ADMIN_PASSWORD) {
    return json({ error: "Wrong email or password" }, 401);
  }
  const token = await signToken({ email }, env.SESSION_SECRET, WEEK);
  return json(
    { email },
    200,
    { "Set-Cookie": cookie(request, token) }
  );
}

function logout(request) {
  return json({ ok: true }, 200, { "Set-Cookie": cookie(request, "", 0) });
}

async function createBrief(request, env, url) {
  function reply(body, status) {
    return cors(request, env, json(body, status));
  }
  if (!isAllowedOrigin(request, env, url)) return reply({ error: "Forbidden" }, 403);
  if (request.method === "POST" && !isForm(request)) return reply({ error: "Use the brief form" }, 400);

  const form = await request.formData();
  if (String(form.get("_honey") || "").trim()) return reply({ ok: true });

  const briefText = String(form.get("Brief") || form.get("Readable brief") || "").trim();
  const email = String(form.get("email") || "").trim();
  if (!briefText && !email) return reply({ error: "Empty brief" }, 400);

  const lines = briefText.split(/\r?\n/).map(function (line) {
    return line.trim();
  }).filter(Boolean);
  const businessName = String(form.get("Business name") || lines[0] || "").trim();
  const packageName = String(form.get("Package") || lines[1] || "").trim();
  const phone = pickPhone(briefText, form);
  const subject = String(form.get("_subject") || "").trim();
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const savedFiles = [];
  const listedNames = originalsFromBrief(briefText);

  for (const [label, value] of form.entries()) {
    if (!(value instanceof Blob) || !value.size) continue;
    if (value.size > 8 * 1024 * 1024) continue;
    const safe = sanitizeName(value.name || label || "file");
    const key = "briefs/" + id + "/" + String(savedFiles.length + 1).padStart(2, "0") + "-" + safe;
    await env.FILES.put(key, await value.arrayBuffer());
    const listed = listedNames[savedFiles.length];
    savedFiles.push({
      key: key,
      name: value.name || safe,
      type: value.type || "application/octet-stream",
      size: value.size,
      label: label,
      originalName: pickOriginalName(value.name, label, listed),
    });
  }

  await env.DB.prepare(
    "INSERT INTO briefs (id, created_at, status, package, business_name, email, phone, subject, brief_text, files) VALUES (?, ?, 'new', ?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(
      id,
      createdAt,
      packageName || null,
      businessName || null,
      email || null,
      phone || null,
      subject || null,
      briefText || null,
      JSON.stringify(savedFiles)
    )
    .run();

  return reply({ ok: true, id });
}

async function listBriefs(request, env) {
  const email = await currentUser(request, env);
  if (!email) return json({ error: "Login required" }, 401);
  await ensureBriefColumns(env);
  const status = new URL(request.url).searchParams.get("status") || "";
  const sql =
    status && /^(new|in_progress|done|declined)$/.test(status)
      ? "SELECT id, created_at, status, package, business_name, email, phone, subject, brief_text, files, extra_note, extra_amount FROM briefs WHERE status = ? ORDER BY created_at DESC LIMIT 200"
      : "SELECT id, created_at, status, package, business_name, email, phone, subject, brief_text, files, extra_note, extra_amount FROM briefs ORDER BY created_at DESC LIMIT 200";
  const result = status && /^(new|in_progress|done|declined)$/.test(status)
    ? await env.DB.prepare(sql).bind(status).all()
    : await env.DB.prepare(sql).all();
  const rows = (result.results || []).map(shapeBrief);
  return json({ briefs: rows });
}

async function getBrief(request, env, id) {
  const email = await currentUser(request, env);
  if (!email) return json({ error: "Login required" }, 401);
  await ensureBriefColumns(env);
  let row = await env.DB.prepare("SELECT * FROM briefs WHERE id = ?").bind(id).first();
  if (!row) return json({ error: "Not found" }, 404);
  row = (await refreshPreview(env, row)) || row;
  const quotes = await listQuotes(env, id);
  const bank = bankFromEnv(env);
  const gmail = await gmailStatus(env);
  return json({
    brief: Object.assign(shapeBrief(row), {
      suggestedAmount: packageAmount(row),
      quotes: quotes,
    }),
    billing: {
      bank: bank.ready,
      email: Boolean(gmail.connected || env.RESEND_API_KEY),
      gmail: gmail.connected,
    },
  });
}

async function getBuild(request, env, id) {
  const email = await currentUser(request, env);
  if (!email) return json({ error: "Login required" }, 401);
  await ensureBriefColumns(env);
  let row = await env.DB.prepare("SELECT * FROM briefs WHERE id = ?").bind(id).first();
  if (!row) return json({ error: "Not found" }, 404);
  row = (await refreshPreview(env, row)) || row;
  const brief = shapeBrief(row);
  return json({
    ok: true,
    repoUrl: brief.githubRepo,
    cursorUrl: brief.cursorUrl,
    agentId: brief.cursorAgentId,
    previewUrl: brief.previewUrl,
    previewStatus: brief.previewStatus,
    buildError: brief.buildError,
  });
}

async function patchBrief(request, env, id) {
  const email = await currentUser(request, env);
  if (!email) return json({ error: "Login required" }, 401);
  const body = await request.json().catch(function () {
    return {};
  });
  const hasExtra = Object.prototype.hasOwnProperty.call(body, "extraNote") || Object.prototype.hasOwnProperty.call(body, "extraAmount");
  const status = String(body.status || "");
  const statusOk = /^(new|in_progress|done|declined)$/.test(status);
  if (!hasExtra && !statusOk) return json({ error: "Bad status" }, 400);
  if (hasExtra) {
    await ensureBriefColumns(env);
    const extraNote = String(body.extraNote || "").trim().slice(0, 2000);
    const extraAmount = Math.max(0, Math.round(Number(body.extraAmount) || 0));
    const saved = await env.DB.prepare("UPDATE briefs SET extra_note = ?, extra_amount = ? WHERE id = ?")
      .bind(extraNote, extraAmount, id)
      .run();
    if (!saved.meta || !saved.meta.changes) return json({ error: "Not found" }, 404);
  }
  if (statusOk) {
    const result = await env.DB.prepare("UPDATE briefs SET status = ? WHERE id = ?").bind(status, id).run();
    if (!result.meta || !result.meta.changes) return json({ error: "Not found" }, 404);
  }
  return json({ ok: true, status: statusOk ? status : undefined });
}

async function deleteBrief(request, env, id) {
  const email = await currentUser(request, env);
  if (!email) return json({ error: "Login required" }, 401);
  const row = await env.DB.prepare("SELECT files FROM briefs WHERE id = ?").bind(id).first();
  if (!row) return json({ error: "Not found" }, 404);
  const files = parseFiles(row.files);
  for (let i = 0; i < files.length; i++) {
    if (files[i] && files[i].key) {
      try {
        await env.FILES.delete(files[i].key);
      } catch (err) {}
    }
  }
  await env.DB.prepare("DELETE FROM briefs WHERE id = ?").bind(id).run();
  return json({ ok: true });
}

async function loadBriefRow(request, env, id) {
  const email = await currentUser(request, env);
  if (!email) return { error: json({ error: "Login required" }, 401) };
  const row = await env.DB.prepare("SELECT * FROM briefs WHERE id = ?").bind(id).first();
  if (!row) return { error: json({ error: "Not found" }, 404) };
  return { row: row };
}

async function saveBriefFiles(env, row, files) {
  const normalized = normalizeFileLabels(files);
  const briefText = replaceFilesBlock(row.brief_text, normalized);
  await env.DB.prepare("UPDATE briefs SET files = ?, brief_text = ? WHERE id = ?")
    .bind(JSON.stringify(normalized), briefText, row.id)
    .run();
  return normalized;
}

async function addBriefFiles(request, env, id) {
  const loaded = await loadBriefRow(request, env, id);
  if (loaded.error) return loaded.error;
  const form = await request.formData();
  const slot = canonicalSlot(form.get("slot") || "Extra photo");
  const blobs = [];
  for (const [label, value] of form.entries()) {
    if (!(value instanceof Blob) || !value.size) continue;
    if (label === "slot") continue;
    if (value.size > 8 * 1024 * 1024) {
      return json({ error: (value.name || "A file") + " is over 8 MB." }, 400);
    }
    const type = value.type || "application/octet-stream";
    if (slot !== "Price list" && type.indexOf("image/") !== 0) {
      return json({ error: "Photos only, unless the slot is Price list." }, 400);
    }
    blobs.push({ blob: value, type: type });
  }
  const incoming = [];
  for (let i = 0; i < blobs.length; i++) {
    const value = blobs[i].blob;
    const safe = sanitizeName(value.name || "photo");
    const key = "briefs/" + id + "/u-" + Date.now() + "-" + i + "-" + safe;
    await env.FILES.put(key, await value.arrayBuffer());
    incoming.push({
      key: key,
      name: value.name || safe,
      type: blobs[i].type,
      size: value.size,
      label: slot,
      originalName: value.name || safe,
      updated: Date.now(),
    });
  }
  if (!incoming.length) return json({ error: "Choose at least one photo." }, 400);
  let existing = parseFiles(loaded.row.files);
  if (slot === "Logo" || slot === "Vibe photo") {
    existing = existing.map(function (file) {
      if (canonicalSlot(file.label) !== slot) return file;
      return Object.assign({}, file, { label: "Extra photo" });
    });
  }
  await saveBriefFiles(env, loaded.row, existing.concat(incoming));
  return json({ ok: true });
}

async function patchBriefFile(request, env, id, index) {
  const loaded = await loadBriefRow(request, env, id);
  if (loaded.error) return loaded.error;
  const files = parseFiles(loaded.row.files);
  const current = files[index];
  if (!current) return json({ error: "Not found" }, 404);
  const typeHeader = request.headers.get("content-type") || "";
  let slot = "";
  let blob = null;
  if (typeHeader.indexOf("application/json") === 0) {
    const body = await request.json().catch(function () {
      return {};
    });
    slot = String(body.slot || body.label || "");
  } else {
    const form = await request.formData();
    slot = String(form.get("slot") || form.get("label") || "");
    const file = form.get("file");
    if (file instanceof Blob && file.size) blob = file;
  }
  if (!slot && !blob) return json({ error: "Nothing to change." }, 400);
  const nextSlot = canonicalSlot(slot || current.label);
  if (blob) {
    if (blob.size > 8 * 1024 * 1024) return json({ error: "That file is over 8 MB." }, 400);
    const type = blob.type || "application/octet-stream";
    if (nextSlot !== "Price list" && type.indexOf("image/") !== 0) {
      return json({ error: "Replace it with a photo, or set the slot to Price list." }, 400);
    }
    const safe = sanitizeName(blob.name || current.name || "photo");
    const key = "briefs/" + id + "/u-" + Date.now() + "-" + safe;
    await env.FILES.put(key, await blob.arrayBuffer());
    if (current.key && current.key !== key) {
      try {
        await env.FILES.delete(current.key);
      } catch (err) {}
    }
    current.key = key;
    current.name = blob.name || safe;
    current.type = type;
    current.size = blob.size;
    current.originalName = blob.name || safe;
    current.updated = Date.now();
  }
  if (nextSlot === "Logo" || nextSlot === "Vibe photo") {
    for (let i = 0; i < files.length; i++) {
      if (i !== index && canonicalSlot(files[i].label) === nextSlot) files[i].label = "Extra photo";
    }
  }
  current.label = nextSlot;
  files[index] = current;
  await saveBriefFiles(env, loaded.row, files);
  return json({ ok: true });
}

async function deleteBriefFile(request, env, id, index) {
  const loaded = await loadBriefRow(request, env, id);
  if (loaded.error) return loaded.error;
  const files = parseFiles(loaded.row.files);
  const current = files[index];
  if (!current) return json({ error: "Not found" }, 404);
  if (current.key) {
    try {
      await env.FILES.delete(current.key);
    } catch (err) {}
  }
  files.splice(index, 1);
  await saveBriefFiles(env, loaded.row, files);
  return json({ ok: true });
}

async function getFile(request, env, id, index) {
  const email = await currentUser(request, env);
  if (!email) return json({ error: "Login required" }, 401);
  const row = await env.DB.prepare("SELECT files, brief_text FROM briefs WHERE id = ?").bind(id).first();
  if (!row) return json({ error: "Not found" }, 404);
  const files = enrichFiles(parseFiles(row.files), row.brief_text);
  const file = files[index];
  if (!file || !file.key) return json({ error: "Not found" }, 404);
  const object = await env.FILES.get(file.key, { type: "arrayBuffer" });
  if (!object) return json({ error: "Missing file" }, 404);
  const headers = new Headers();
  headers.set("Content-Type", file.type || "application/octet-stream");
  headers.set(
    "Content-Disposition",
    "inline; filename=\"" + (file.originalName || file.name || "file").replace(/"/g, "") + "\""
  );
  headers.set("Cache-Control", "private, max-age=3600");
  headers.set("X-Robots-Tag", "noindex");
  return new Response(object, { headers });
}

async function startBuild(request, env, id) {
  const email = await currentUser(request, env);
  if (!email) return json({ error: "Login required" }, 401);
  if (!env.CURSOR_API_KEY) {
    return json(
      {
        error:
          "Add CURSOR_API_KEY in Cloudflare (Workers → vibeit-admin → Settings → Variables) so builds run on your Cursor account.",
      },
      501
    );
  }
  if (!env.GITHUB_TOKEN) {
    return json(
      { error: "Add GITHUB_TOKEN in Cloudflare so we can create the client repo before Cursor builds." },
      501
    );
  }

  await ensureBriefColumns(env);
  let row = await env.DB.prepare("SELECT * FROM briefs WHERE id = ?").bind(id).first();
  if (!row) return json({ error: "Not found" }, 404);

  if (row.cursor_url) {
    row = (await refreshPreview(env, row)) || row;
    const brief = shapeBrief(row);
    return json({
      ok: true,
      alreadyStarted: true,
      repoUrl: brief.githubRepo,
      cursorUrl: brief.cursorUrl,
      agentId: brief.cursorAgentId,
      previewUrl: brief.previewUrl,
      previewStatus: brief.previewStatus,
      buildError: brief.buildError,
    });
  }

  const body = await request.json().catch(function () {
    return {};
  });
  const type = effectiveType(String(body.type || "").trim(), row.brief_text);
  const action = String(body.action || "").trim();
  const instructions = String(body.instructions || "").trim().slice(0, 4000);
  if (!type || !action) return json({ error: "Pick a site format and customer action" }, 400);
  if (packageTier(row) === "Advance") {
    return json({ error: "Advance is a custom enquiry. WhatsApp them or send a quote — do not start a standard website." }, 400);
  }
  if (packageTier(row) === "Entry" && (action === "Book" || action === "Buy")) {
    return json({ error: "Entry is Call, WhatsApp, Email, or Get a quote. Book and Buy are Intermediate." }, 400);
  }
  const siteEmail = String(row.email || fieldFromBrief(String(row.brief_text || ""), "Email") || "").trim();
  if (action === "Email" && siteEmail.indexOf("@") === -1) {
    return json(
      { error: "This brief has no contact email. Pick Call, WhatsApp, or Get a quote, or the site cannot use Email as the main button." },
      400
    );
  }
  const invalid = validateJob(row);
  if (invalid) return json({ error: invalid }, 400);

  const businessName = String(row.business_name || "client").trim();
  let repo;
  try {
    repo = await openOrCreateClientRepo(env, row);
    await saveJobBuild(env, id, {
      repoUrl: repo.repoUrl,
      previewUrl: pagesUrl(repo.owner, repo.repo),
      previewStatus: "pending",
      buildError: "",
      markProgress: true,
    });
  } catch (err) {
    const message = err.message || "Could not create or open the client GitHub repo.";
    await saveJobBuild(env, id, { buildError: message });
    return json({ error: message }, 502);
  }

  try {
    const seeded = await githubFileExists(env, repo.owner, repo.repo, "index.html");
    if (!seeded) {
      const progress = await seedClientRepo(env, repo.repoUrl, row, type, action, instructions);
      if (!progress.done) {
        return json({
          ok: true,
          seeding: true,
          repoUrl: repo.repoUrl,
          previewUrl: pagesUrl(repo.owner, repo.repo),
          previewStatus: "pending",
          progress: progress.label,
        });
      }
    }

    const pages = await enableGithubPages(env, repo.owner, repo.repo);
    await saveJobBuild(env, id, {
      repoUrl: repo.repoUrl,
      previewUrl: pages.url,
      previewStatus: pages.ok ? "live" : "pending",
      buildError: pages.ok ? "" : pages.error,
      markProgress: true,
    });

    const images = await collectPromptImages(env, parseFiles(row.files));
    const promptText = buildSitePrompt(row, type, action, repo.repoUrl, pages.url, instructions);
    let agentRes = await createCursorAgent(env, businessName, promptText, images, repo.repoUrl);
    if (!agentRes.ok) {
      await sleep(2500);
      agentRes = await createCursorAgent(env, businessName, promptText, images, repo.repoUrl);
    }
    const agent = agentRes.body.agent || agentRes.body;
    const cursorUrl = agent.url || "";
    const agentId = agent.id || "";
    if (!agentRes.ok || !cursorUrl) {
      const message =
        (agentRes.body.error && agentRes.body.error.message) ||
        agentRes.body.message ||
        "Cursor did not start the agent. The GitHub repo is pinned. Check the API key and that the GitHub app can see VIbeIt-Intel.";
      await saveJobBuild(env, id, {
        repoUrl: repo.repoUrl,
        previewUrl: pages.url,
        previewStatus: pages.ok ? "live" : "pending",
        buildError: message,
        markProgress: true,
      });
      return json(
        {
          error: message,
          repoUrl: repo.repoUrl,
          previewUrl: pages.url,
          previewStatus: pages.ok ? "live" : "pending",
        },
        502
      );
    }

    await saveJobBuild(env, id, {
      repoUrl: repo.repoUrl,
      agentId: agentId,
      cursorUrl: cursorUrl,
      previewUrl: pages.url,
      previewStatus: pages.ok ? "live" : "pending",
      buildError: pages.ok ? "" : pages.error,
      markProgress: true,
    });
    return json({
      ok: true,
      repoUrl: repo.repoUrl,
      cursorUrl: cursorUrl,
      agentId: agentId,
      previewUrl: pages.url,
      previewStatus: pages.ok ? "live" : "pending",
      buildError: pages.ok ? "" : pages.error,
    });
  } catch (err) {
    const message =
      err && err.message
        ? err.message
        : "Start website timed out while seeding photos. Refresh and try again — the repo may already exist.";
    await saveJobBuild(env, id, { repoUrl: repo.repoUrl, buildError: message, markProgress: true });
    return json({ error: message, repoUrl: repo.repoUrl }, 502);
  }
}

function validateJob(row) {
  const name = String(row.business_name || "").trim();
  const brief = String(row.brief_text || "").trim();
  const pkg = String(row.package || "").trim();
  const email = String(row.email || fieldFromBrief(brief, "Email") || "").trim();
  const phone = String(row.phone || fieldFromBrief(brief, "Phone") || "").trim();
  const whatsapp = String(fieldFromBrief(brief, "WhatsApp") || "").trim();
  if (!name) return "This job has no business name.";
  if (!brief) return "This job has no brief.";
  if (!pkg) return "This job has no package.";
  if (!email && !phone && !whatsapp) return "This job has no contact (email, phone, or WhatsApp).";
  return "";
}

function packageTier(row) {
  const raw = String(row.package || row.brief_text || "Entry");
  if (/advance|custom platform/i.test(raw)) return "Advance";
  if (/intermediate|booking/i.test(raw)) return "Intermediate";
  return "Entry";
}

function buildSitePrompt(row, type, action, repoUrl, previewUrl, instructions) {
  const pkg = packageTier(row);
  const name = String(row.business_name || "this business").trim();
  const extra = String(instructions || "").trim();
  const expectedPreview = previewUrl || "";
  const lines = [
    "You are a VibeIt-Intel cloud agent building one client website.",
    "Work only in this exact GitHub repo. Open it. Do not create another repo. Do not fork. Do not rename.",
    "Repo: " + repoUrl,
    expectedPreview ? "Expected public preview: " + expectedPreview : "Expected public preview: GitHub Pages on main for this repo.",
    "",
    "Business: " + name,
    "Kind of business: " + type,
    "Primary customer action: " + action,
    "Package: " + pkg,
  ];
  const facebook = facebookUrl(briefSocial(String(row.brief_text || ""), ["Facebook", "Facebook page name"]));
  const instagram = instagramUrl(briefSocial(String(row.brief_text || ""), ["Instagram", "Instagram handle"]));
  const google = mapsUrl(briefSocial(String(row.brief_text || ""), ["Google profile", "Google maps"]));
  if (facebook) lines.push("Facebook: " + facebook);
  if (instagram) lines.push("Instagram: " + instagram);
  if (google) lines.push("Google: " + google);
  if (extra) {
    lines.push("", "SPECIAL INSTRUCTIONS FROM VIBEIT ADMIN (follow these):", extra);
  }
  lines.push(
    "",
    formatPlaybook(type),
    "",
    "Hard rules:",
    "- This repo already has index.html, styles.css, BRIEF.md, FORMAT.md, PREVIEW.md, MOBILE.md, mobile-check.mjs, and assets/. Their name, colours, logo, and photos are already in those files. Keep those facts. Do not delete mobile-check.mjs.",
    "- Redesign the page for THIS business. A fabricator, a cafe, a salon, and a plumber must not share the same page. The look class is only a start.",
    "- If the brief is about making or selling physical work (steel, timber, vehicles, furniture, custom builds) and the format says trades or maintenance, treat them as a maker: full-bleed photos of the work, not a quote-and-service-area brochure.",
    "- Do not copy another client's website, wording, or photo treatment. Do not reuse timber, lodge, or grain language unless this brief is about timber.",
    "- Write a real headline from what they do. Name every job from what is actually in the pictures. Drop screenshots and photos that are not the work.",
    "- PHOTO-PICKS.md lists every uploaded photo. If two files are the same frame, keep the sharper one and leave the repeat off the page. Different angles stay.",
    "- Group the Kept photos into jobs. Open every file listed under Kept in PHOTO-PICKS.md. Those files are in assets/. The images attached to this prompt are only a sample, so do not group from the sample alone.",
    "- One finished piece is one <article class=\"job\">. A front, a side, and a detail of the same vehicle, frame, bar, room, or build go inside that article's .job-photos. Put one short title in the h3 (what was built) and one line in .job-note if it helps. A different piece is a different article.",
    "- Do not merge photos just because they are the same colour, the same kind of work, or shot on the same grass. If you cannot tell they are the same piece, leave them as separate jobs. A single photo of a piece stays a job on its own. Do not leave job titles empty.",
    "- Keep a single index.html and styles.css. Do not add a framework or extra HTML pages.",
    "- The main button and contact path must drive this action: " + action + ".",
    "- If the brief has Facebook, Instagram, or a Google profile link, keep those exact links in the contact section. Facebook and Instagram go in LocalBusiness sameAs. A Google Maps link goes in hasMap. Do not swap a given URL for a guessed page name. Do not invent a star rating."
  );
  if (extra) {
    lines.push(
      "- Follow the special instructions from VibeIt admin above. They override layout defaults where they conflict, but never invent prices, payment details, or VibeIt fees."
    );
  }
  lines.push(
    "- Use the client's colours already in styles.css (--c1 --c2 --c3, --ink, --paper, --accent). Do not replace them with VibeIt teal or orange unless those hex values are theirs.",
    "- Use files in assets/ for the logo and gallery. Do not invent a different logo. Do not ask anyone to paste or drag files.",
    "- Keep the round logo favicon (favicon.svg, assets/favicon-32.png, assets/favicon-192.png, assets/apple-touch-icon.png) and assets/share.jpg. That share image is what WhatsApp and Google show when the link is forwarded. Do not swap in a different mark.",
    "- Keep robots.txt, sitemap.xml, the canonical URL, the Open Graph tags, and the LocalBusiness JSON-LD. When a real domain replaces the GitHub Pages address, update those URLs to it. Do not delete them.",
    "- If assets/ has a Word, Excel, PDF, CSV, or photo price list, use it for services and prices. Do not ignore it.",
    "- Services and products are different. Treatments, repairs, and bookings go under Services. Items they sell (food, nail products, parts, merch) go under Shop. Hide Shop if they do not sell items.",
    "- South African English. WhatsApp-friendly where a number exists. If the customer action is Email, the main button must be mailto: the client's email from the brief.",
    "- Check the phone layout before the PR. Open the page at 360px wide and at 390px wide, scroll the whole page, and fix sideways scrolling, clipped text, overlapping sections, images wider than the screen, and any button shorter than 44px. The WhatsApp button must not cover the last line.",
    "- Run node mobile-check.mjs from the repo root. Fix every line it prints and run it again until it prints PASS. Do not open the PR while it fails. In MOBILE.md, record PASS and what you fixed by looking at those two widths.",
    "- Entry is a marketing site only: hide bookings. Intermediate keeps and fills the bookings section.",
    "- Only show a pay link or bank details if they appear in the brief. Do not invent PayFast, iKhoka, SnapScan, or a checkout. If they pay cash or with a card machine, say that. If payment details are missing, tell customers to WhatsApp, email, or call.",
    "- Never show VibeIt fees, package names, or rand amounts like R1,105 on the client's website. That is what they paid us, not a price for their customers. If the brief lists service prices, those may appear; our studio price must not.",
    "- If the brief copy is placeholder junk (dddd, test, asdf), do not invent a fake brand story. Use honest generic copy for that trade and leave a short TODO comment.",
    "- Publish a public preview. GitHub Pages may already be enabled on main. Do not loop on the Pages API. Maximum 2 attempts to enable or rebuild Pages. If Pages fails, still ship the site files and write the expected URL into PREVIEW.md.",
    "- Return the public preview URL in your final message.",
    "- Open a PR when the first draft is ready.",
    "",
    "CLIENT BRIEF:",
    String(row.brief_text || "").trim()
  );
  return lines
    .filter(function (line, i, all) {
      return line !== "" || all[i - 1] !== "";
    })
    .join("\n");
}

async function collectPromptImages(env, files) {
  const images = [];
  const ordered = files.slice().sort(function (a, b) {
    const aLogo = /logo/i.test(String(a.label || a.name || ""));
    const bLogo = /logo/i.test(String(b.label || b.name || ""));
    if (aLogo === bLogo) return 0;
    return aLogo ? 1 : -1;
  });
  for (let i = 0; i < ordered.length && images.length < 5; i++) {
    const file = ordered[i];
    const type = String(file.type || "");
    if (type.indexOf("image/") !== 0 || type === "image/svg+xml") continue;
    if (!file.key) continue;
    const object = await env.FILES.get(file.key, { type: "arrayBuffer" });
    if (!object || object.byteLength > 2 * 1024 * 1024) continue;
    images.push({
      data: bytesToBase64(object),
      mimeType: type,
    });
  }
  return images;
}

async function createCursorAgent(env, businessName, promptText, images, repoUrl) {
  const res = await fetch("https://api.cursor.com/v1/agents", {
    method: "POST",
    headers: {
      Authorization: "Basic " + btoa(String(env.CURSOR_API_KEY) + ":"),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: ("VibeIt — " + businessName).slice(0, 100),
      prompt: { text: promptText, images: images },
      model: { id: "composer-2.5" },
      repos: [{ url: repoUrl, startingRef: "main" }],
      autoCreatePR: true,
      skipReviewerRequest: true,
    }),
  });
  const body = await res.json().catch(function () {
    return {};
  });
  return { ok: res.ok, body: body };
}

function githubOrg(env) {
  return String(env.GITHUB_ORG || "VIbeIt-Intel").trim();
}

function parseRepo(repoUrl) {
  const match = String(repoUrl || "").match(/github\.com\/([^/]+)\/([^/#?]+)/i);
  if (!match) return null;
  return { owner: match[1], repo: String(match[2] || "").replace(/\.git$/i, "") };
}

function pagesUrl(owner, repo) {
  return "https://" + String(owner || "").toLowerCase() + ".github.io/" + repo + "/";
}

function profileUrl(value, host) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  const handle = raw
    .replace(/^@/, "")
    .replace(new RegExp("^(https?:\\/\\/)?(www\\.)?" + host.replace(/\./g, "\\.") + "\\/", "i"), "")
    .replace(/^\//, "")
    .replace(/\/+$/, "")
    .trim();
  if (!handle || /\s/.test(handle)) return "";
  return "https://www." + host + "/" + handle;
}

function facebookUrl(value) {
  return profileUrl(value, "facebook.com");
}

function instagramUrl(value) {
  return profileUrl(value, "instagram.com");
}

function briefSocial(text, labels) {
  for (let i = 0; i < labels.length; i++) {
    const value = fieldFromBrief(text, labels[i]);
    if (value) return value;
  }
  return "";
}

function mapsUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^(www\.)?(google\.[a-z.]+|maps\.app\.goo\.gl|goo\.gl)\//i.test(raw)) return "https://" + raw.replace(/^\/+/, "");
  return "";
}

function businessSchema(fields) {
  const data = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: fields.name,
    url: fields.origin,
    image: fields.shareUrl,
    description: fields.tagline,
    address: {
      "@type": "PostalAddress",
      streetAddress: fields.address,
      addressCountry: "ZA",
    },
    areaServed: "ZA",
  };
  if (fields.phone) data.telephone = fields.phone;
  if (fields.email) data.email = fields.email;
  const sameAs = [fields.facebook, fields.instagram].filter(Boolean);
  if (sameAs.length) data.sameAs = sameAs;
  if (fields.google) data.hasMap = fields.google;
  return JSON.stringify(data, null, 2).replace(/</g, "\\u003c");
}

async function githubRequest(env, method, path, payload) {
  const res = await fetch("https://api.github.com" + path, {
    method: method,
    headers: Object.assign({}, githubHeaders(env), payload ? { "Content-Type": "application/json" } : {}),
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const data = await res.json().catch(function () {
    return {};
  });
  return { ok: res.ok, status: res.status, data: data };
}

async function getGithubRepo(env, owner, repo) {
  const res = await githubRequest(env, "GET", "/repos/" + owner + "/" + repo);
  if (!res.ok) return null;
  return {
    owner: res.data.owner && res.data.owner.login ? res.data.owner.login : owner,
    repo: res.data.name || repo,
    htmlUrl: res.data.html_url || "https://github.com/" + owner + "/" + repo,
    repoUrl: res.data.html_url || "https://github.com/" + owner + "/" + repo,
    defaultBranch: res.data.default_branch || "main",
  };
}

async function waitForRepo(env, owner, repo) {
  for (let i = 0; i < 6; i++) {
    const found = await getGithubRepo(env, owner, repo);
    if (found) return found;
    await sleep(800);
  }
  return null;
}

async function openOrCreateClientRepo(env, row) {
  const org = githubOrg(env);
  if (!org) throw new Error("GITHUB_ORG is not set. Client repos must live under VIbeIt-Intel.");
  const pinned = parseRepo(row.github_repo);
  const owner = pinned ? pinned.owner : org;
  const repo = pinned ? pinned.repo : slugify(row.business_name);
  if (!repo) throw new Error("Could not make a GitHub repo name from this business.");

  let info = await getGithubRepo(env, owner, repo);
  if (info) return info;

  if (pinned) {
    throw new Error("Pinned repo " + owner + "/" + repo + " was not found. The GitHub token may not see VIbeIt-Intel.");
  }

  const created = await createGithubRepo(env, org, {
    name: repo,
    description: ("VibeIt site for " + String(row.business_name || repo)).slice(0, 350),
    private: true,
    auto_init: true,
  });
  if (created.ok) {
    const ready = await waitForRepo(env, org, created.data.name || repo);
    if (ready) return ready;
    return {
      owner: org,
      repo: created.data.name || repo,
      htmlUrl: created.data.html_url || "https://github.com/" + org + "/" + repo,
      repoUrl: created.data.html_url || "https://github.com/" + org + "/" + repo,
      defaultBranch: "main",
    };
  }
  if (created.status === 422) {
    const existing = await getGithubRepo(env, org, repo);
    if (existing) return existing;
  }
  const detail = created.data.message || "GitHub could not create the repo";
  if (created.status === 404 || created.status === 403) {
    throw new Error(
      "GitHub token cannot create repos for " + org + ". The token must be created while logged in as " + org + ", with the repo scope. (" + detail + ")"
    );
  }
  throw new Error(detail);
}

async function createGithubRepo(env, owner, payload) {
  const account = await githubRequest(env, "GET", "/users/" + encodeURIComponent(owner));
  if (account.ok && account.data && account.data.type === "User") {
    const me = await githubRequest(env, "GET", "/user");
    const login = me.ok && me.data && me.data.login ? me.data.login : "";
    if (login.toLowerCase() !== String(owner).toLowerCase()) {
      return {
        ok: false,
        status: 403,
        data: {
          message: login
            ? "Token belongs to " + login + ", not " + owner
            : "Token could not be read",
        },
      };
    }
    return githubRequest(env, "POST", "/user/repos", payload);
  }
  return githubRequest(env, "POST", "/orgs/" + encodeURIComponent(owner) + "/repos", payload);
}

async function githubFileExists(env, owner, repo, path) {
  const res = await fetch(
    "https://api.github.com/repos/" + owner + "/" + repo + "/contents/" + path,
    { headers: githubHeaders(env) }
  );
  return res.ok;
}

async function githubFileSha(env, owner, repo, path) {
  const res = await fetch(
    "https://api.github.com/repos/" + owner + "/" + repo + "/contents/" + path,
    { headers: githubHeaders(env) }
  );
  if (!res.ok) return "";
  const body = await res.json().catch(function () {
    return {};
  });
  return body.sha || "";
}

async function enableGithubPages(env, owner, repo) {
  const expected = pagesUrl(owner, repo);
  let lastError = "GitHub Pages is not live yet.";
  for (let attempt = 0; attempt < 2; attempt++) {
    const created = await githubRequest(env, "POST", "/repos/" + owner + "/" + repo + "/pages", {
      source: { branch: "main", path: "/" },
    });
    if (created.ok || created.status === 409) {
      const site = await githubRequest(env, "GET", "/repos/" + owner + "/" + repo + "/pages");
      const url = (site.data && (site.data.html_url || site.data.url)) || expected;
      if (site.ok) {
        const status = String(site.data.status || "");
        return {
          ok: status === "built",
          url: url,
          error:
            status === "errored"
              ? "GitHub Pages reported an error building this site."
              : status === "built"
                ? ""
                : "Preview pending. GitHub Pages is enabled on main and still building.",
        };
      }
    }
    lastError = (created.data && created.data.message) || lastError;
    await sleep(800);
  }
  return {
    ok: false,
    url: expected,
    error: "Preview pending: " + lastError + " Repo is ready. Pages can be enabled on main.",
  };
}

function previewUrlFromText(text) {
  const match = String(text || "").match(/https?:\/\/[a-z0-9-]+\.github\.io\/[^\s)\]'"]+/i);
  return match ? match[0].replace(/[.,;]+$/, "") : "";
}

async function refreshPreview(env, row) {
  if (!row || !row.github_repo) return row;
  try {
    const parsed = parseRepo(row.github_repo);
    if (!parsed) return row;
    let previewUrl = String(row.preview_url || pagesUrl(parsed.owner, parsed.repo));
    let previewStatus = String(row.preview_status || "pending");
    let buildError = String(row.build_error || "");

    const site = await githubRequest(env, "GET", "/repos/" + parsed.owner + "/" + parsed.repo + "/pages");
    if (site.ok) {
      previewUrl = site.data.html_url || site.data.url || previewUrl;
      const status = String(site.data.status || "");
      if (status === "built") previewStatus = "live";
      else if (status === "errored") {
        previewStatus = "error";
        buildError = buildError || "GitHub Pages failed to build.";
      } else previewStatus = previewStatus === "live" ? "live" : "pending";
    }

    const agentId = String(row.cursor_agent_id || "").trim();
    if (agentId && env.CURSOR_API_KEY && previewStatus !== "live") {
      const agentRes = await fetch("https://api.cursor.com/v1/agents/" + encodeURIComponent(agentId), {
        headers: { Authorization: "Basic " + btoa(String(env.CURSOR_API_KEY) + ":") },
      });
      const agent = await agentRes.json().catch(function () {
        return {};
      });
      const runId = agent.latestRunId || "";
      if (runId) {
        const runRes = await fetch(
          "https://api.cursor.com/v1/agents/" + encodeURIComponent(agentId) + "/runs/" + encodeURIComponent(runId),
          { headers: { Authorization: "Basic " + btoa(String(env.CURSOR_API_KEY) + ":") } }
        );
        const run = await runRes.json().catch(function () {
          return {};
        });
        const found = previewUrlFromText(run.result || "");
        if (found) {
          previewUrl = found;
          previewStatus = "live";
        }
      }
    }

    if (
      previewUrl !== String(row.preview_url || "") ||
      previewStatus !== String(row.preview_status || "") ||
      buildError !== String(row.build_error || "")
    ) {
      await saveJobBuild(env, row.id, {
        repoUrl: row.github_repo,
        agentId: row.cursor_agent_id,
        cursorUrl: row.cursor_url,
        previewUrl: previewUrl,
        previewStatus: previewStatus,
        buildError: buildError,
      });
      row.preview_url = previewUrl;
      row.preview_status = previewStatus;
      row.build_error = buildError;
    }
  } catch (err) {}
  return row;
}

async function seedClientRepo(env, repoUrl, row, type, action, instructions) {
  const parts = String(repoUrl).replace(/\.git$/, "").split("/");
  const repo = parts.pop();
  const owner = parts.pop();
  if (!owner || !repo) throw new Error("Bad repo URL");

  const briefText = String(row.brief_text || "").trim();
  const name = String(row.business_name || fieldFromBrief(briefText, "Name") || "Our business").trim();
  const phone = String(row.phone || fieldFromBrief(briefText, "Phone") || "").trim();
  const email = String(row.email || fieldFromBrief(briefText, "Email") || "").trim();
  const address = fieldFromBrief(briefText, "Address");
  const whatsapp = fieldFromBrief(briefText, "WhatsApp") || phone;
  const facebook = facebookUrl(briefSocial(briefText, ["Facebook", "Facebook page name"]));
  const instagram = instagramUrl(briefSocial(briefText, ["Instagram", "Instagram handle"]));
  const google = mapsUrl(briefSocial(briefText, ["Google profile", "Google maps"]));
  const about = blockFromBrief(briefText, "WHAT THEY DO") || "Tell people who you serve and what you want them to do.";
  const hours = blockFromBrief(briefText, "HOURS") || "Hours to be confirmed.";
  const colours = coloursFromBrief(briefText);
  const palette = paletteFromColours(colours);
  const look = formatLook(type);
  const items = blockFromBrief(briefText, "ITEMS FOR SALE");
  const servicesText = blockFromBrief(briefText, "PRODUCTS OR SERVICES");
  const sellsItems = /^Sells products:\s*Yes/im.test(briefText) || Boolean(items);
  const pack = /intermediate|booking/i.test(String(row.package || "")) ? "pack-intermediate" : "pack-entry";
  const cta = ctaFromAction(action, phone, email, whatsapp);
  const waHref = whatsappHref(whatsapp);
  const files = parseFiles(row.files);
  const assets = [];
  let logoKey = "";
  let logoMime = "";
  let extraCount = 0;
  let listCount = 0;
  let logoSrc = "";
  const gallery = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (!file.key) continue;
    const label = String(file.label || file.name || "file").toLowerCase();
    const ext = extFromFile(file);
    const image = isImageExt(ext);
    let dest = "assets/file-" + (i + 1) + (ext || ".bin");
    if (label.indexOf("logo") !== -1 && !logoSrc) {
      dest = "assets/logo" + (ext || ".bin");
      logoSrc = dest;
      if (image) {
        logoKey = file.key;
        logoMime = String(file.type || "");
      }
    } else if (label.indexOf("vibe") !== -1 && image) {
      dest = "assets/vibe" + ext;
      gallery.push(dest);
    } else if (label.indexOf("price list") !== -1 || !image) {
      listCount += 1;
      dest = "assets/price-list-" + listCount + (ext || ".bin");
    } else {
      extraCount += 1;
      dest = "assets/extra-" + extraCount + ext;
      if (image) gallery.push(dest);
    }
    assets.push({ path: dest, key: file.key });
  }

  const pickNotes = [
    "# Photo pick",
    "",
    "Every uploaded photo is in the repo. Two files that are the same frame should keep the sharper one. Different angles of one piece belong in one job.",
    "",
    "Photos:",
  ];
  if (!gallery.length) pickNotes.push("- None");
  gallery.forEach(function (dest) {
    pickNotes.push("- " + dest);
  });
  pickNotes.push(
    "",
    "Jobs:",
    "The page starts with one photo per job. Open each photo and merge angles of the same finished piece into one job.",
    "The same vehicle, frame, bar, or build seen from the front, the side, and a detail is one job.",
    "A different piece is a different job. A similar colour or the same kind of work is not enough to merge them.",
    "Name the job from what is in the pictures. Leave every photo on the page, inside its job, unless it is the same frame as another.",
    ""
  );

  const preview = pagesUrl(owner, repo);

  const values = {
    PACKAGE_CLASS: pack,
    NAME: escapeHtml(name),
    TYPE: escapeHtml(type),
    TAGLINE: escapeHtml(headlineFrom(about, name)),
    ABOUT: escapeHtml(about).replace(/\n/g, "<br>"),
    ADDRESS: escapeHtml(address || "South Africa"),
    PHONE: escapeHtml(phone || "Phone on request"),
    PHONE_HREF: phone.replace(/\s+/g, "") || "",
    EMAIL: escapeHtml(email || ""),
    EMAIL_HIDDEN: email ? "" : "hidden",
    FACEBOOK_HREF: facebook || "#contact",
    FB_HIDDEN: facebook ? "" : "hidden",
    INSTAGRAM_HREF: instagram || "#contact",
    IG_HIDDEN: instagram ? "" : "hidden",
    GOOGLE_HREF: google || "#contact",
    GOOGLE_HIDDEN: google ? "" : "hidden",
    CTA_HREF: cta.href,
    CTA_LABEL: escapeHtml(cta.label),
    HOURS: escapeHtml(hours).replace(/\n/g, "<br>"),
    WHATSAPP_HREF: waHref || "#contact",
    WA_HIDDEN: waHref ? "" : "hidden",
    LOGO_SRC: logoSrc || "assets/logo.jpg",
    SHOP_CLASS: sellsItems ? "has-shop" : "no-shop",
    PRODUCTS_INTRO: sellsItems
      ? "Items you can buy. WhatsApp or visit to order."
      : "",
    PRODUCTS: productCards(items),
    GALLERY: gallery
      .map(function (src) {
        return (
          '<article class="job"><h3></h3><div class="job-photos"><figure><img src="' +
          src +
          '" alt="" /></figure></div><p class="job-note"></p></article>'
        );
      })
      .join("\n          ") || "<p>Photos to come.</p>",
    C1: palette.c1,
    C2: palette.c2,
    C3: palette.c3,
    INK: palette.ink,
    PAPER: palette.paper,
    ACCENT: palette.accent,
    ON_ACCENT: palette.onAccent,
    LOOK: look.look,
    DISPLAY: look.display,
    TEXT: look.text,
    FONT_HREF: look.fontHref,
    ORIGIN: preview,
    SHARE_URL: preview + "assets/share.jpg",
    SCHEMA: businessSchema({
      name: name,
      origin: preview,
      shareUrl: preview + "assets/share.jpg",
      phone: phone,
      email: email,
      address: address || "South Africa",
      tagline: headlineFrom(about, name),
      facebook: facebook,
      instagram: instagram,
      google: google,
    }),
    HERO_STYLE: gallery[0] ? "--hero:url('" + gallery[0] + "')" : "--hero:none",
    SERVICES_CLASS: servicesText ? "has-services" : "no-services",
    SERVICES: serviceCards(servicesText),
  };

  const briefMd = [
    "# " + name,
    "",
    "Type: " + type,
    "Site format: " + type,
    "Customer action: " + action,
    "Package: " + String(row.package || ""),
  ];
  if (facebook) briefMd.push("Facebook: " + facebook);
  if (instagram) briefMd.push("Instagram: " + instagram);
  if (google) briefMd.push("Google: " + google);
  const extraNotes = String(instructions || "").trim();
  if (extraNotes) {
    briefMd.push("", "Special instructions from VibeIt admin:", extraNotes);
  }
  briefMd.push("", briefText);

  const textFiles = {
    "index.html": fillTokens(STARTER_FILES["index.html"], values),
    "styles.css": fillTokens(STARTER_FILES["styles.css"], values),
    "README.md": fillTokens(STARTER_FILES["README.md"], values),
    "FORMAT.md": formatMarkdown(type),
    "BRIEF.md": briefMd.join("\n"),
    "PREVIEW.md": [
      "# Client preview",
      "",
      "Public preview (no GitHub login):",
      preview,
      "",
      "GitHub Pages is served from `main`. If this URL 404s, Pages is still building or not enabled yet. The site files are in index.html.",
      "",
    ].join("\n"),
    "PHOTO-PICKS.md": pickNotes.join("\n"),
    "mobile-check.mjs": STARTER_FILES["mobile-check.mjs"],
    "MOBILE.md": [
      "# Mobile check",
      "",
      "Before the pull request:",
      "",
      "1. Open the page at 360px wide and at 390px wide. Scroll from top to bottom.",
      "2. Fix sideways scrolling, clipped text, overlapping sections, images wider than the screen, and buttons shorter than 44px.",
      "3. Run `node mobile-check.mjs` until it prints PASS.",
      "",
      "Result:",
      "- Script: not run yet",
      "- Look at 360px and 390px: not done",
      "",
    ].join("\n"),
    "robots.txt": ["User-agent: *", "Allow: /", "", "Sitemap: " + preview + "sitemap.xml", ""].join("\n"),
    "sitemap.xml": [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      "  <url>",
      "    <loc>" + preview + "</loc>",
      "    <changefreq>monthly</changefreq>",
      "    <priority>1.0</priority>",
      "  </url>",
      "</urlset>",
      "",
    ].join("\n"),
  };

  const plan = assets.map(function (asset) {
    return { path: asset.path, key: asset.key };
  });
  plan.push(
    { path: "assets/favicon-32.png", mark: "png32" },
    { path: "assets/favicon-192.png", mark: "png192" },
    { path: "assets/apple-touch-icon.png", mark: "apple" },
    { path: "assets/share.jpg", mark: "share" },
    { path: "favicon.svg", mark: "svg" }
  );
  Object.keys(textFiles).forEach(function (fileName) {
    if (fileName === "index.html") return;
    plan.push({ path: fileName, text: textFiles[fileName] });
  });
  plan.push({ path: "index.html", text: textFiles["index.html"] });

  const existing = await githubTreePaths(env, owner, repo);
  const pending = plan.filter(function (item) {
    return existing.indexOf(item.path) === -1;
  });
  if (!pending.length) return { done: true, label: "Site files are in the repo." };
  const waiting = pending.filter(function (item) {
    return item.path !== "index.html";
  });
  const batch = (waiting.length ? waiting : pending).slice(0, 3);
  let marks = null;
  async function seedMarks() {
    if (marks) return marks;
    let logoBytes = null;
    if (logoKey) logoBytes = await env.FILES.get(logoKey, { type: "arrayBuffer" });
    try {
      marks = makeMarks(logoBytes, logoMime, palette.paper, palette.accent, name);
    } catch (err) {
      marks = makeMarks(null, "", palette.paper, palette.accent, name);
    }
    return marks;
  }
  const commitFiles = [];
  for (let i = 0; i < batch.length; i++) {
    const item = batch[i];
    if (item.key) {
      const object = await env.FILES.get(item.key, { type: "arrayBuffer" });
      if (!object || !object.byteLength) throw new Error("Could not read " + item.path + " from the brief.");
      commitFiles.push({ path: item.path, bytes: object });
    } else if (item.mark) {
      const made = await seedMarks();
      if (item.mark === "svg") commitFiles.push({ path: item.path, text: made.svg });
      else commitFiles.push({ path: item.path, bytes: made[item.mark] });
    } else {
      commitFiles.push({ path: item.path, text: item.text });
    }
  }
  await commitGithubFiles(env, owner, repo, commitFiles, "Seed VibeIt starter for " + name);
  const left = pending.length - batch.length;
  return {
    done: left === 0,
    label: "Uploading site files (" + (plan.length - left) + " of " + plan.length + ").",
  };
}

async function githubTreePaths(env, owner, repo) {
  const ref = await githubRequest(env, "GET", "/repos/" + owner + "/" + repo + "/git/ref/heads/main");
  if (!ref.ok) return [];
  const commit = await githubRequest(
    env,
    "GET",
    "/repos/" + owner + "/" + repo + "/git/commits/" + ref.data.object.sha
  );
  if (!commit.ok) return [];
  const tree = await githubRequest(
    env,
    "GET",
    "/repos/" + owner + "/" + repo + "/git/trees/" + commit.data.tree.sha + "?recursive=1"
  );
  if (!tree.ok || !tree.data.tree) return [];
  return tree.data.tree
    .filter(function (item) {
      return item.type === "blob";
    })
    .map(function (item) {
      return item.path;
    });
}

async function commitGithubFiles(env, owner, repo, files, message) {
  const repoInfo = await githubRequest(env, "GET", "/repos/" + owner + "/" + repo);
  if (!repoInfo.ok) throw new Error(repoInfo.data.message || "Could not read the GitHub repo.");
  const branch = repoInfo.data.default_branch || "main";
  const ref = await githubRequest(env, "GET", "/repos/" + owner + "/" + repo + "/git/ref/heads/" + branch);
  if (!ref.ok) throw new Error(ref.data.message || "Could not read the repo branch.");
  const parentSha = ref.data.object.sha;
  const parent = await githubRequest(env, "GET", "/repos/" + owner + "/" + repo + "/git/commits/" + parentSha);
  if (!parent.ok) throw new Error(parent.data.message || "Could not read the latest commit.");
  const baseTreeSha = parent.data.tree.sha;

  const treeEntries = [];
  const batchSize = 5;
  for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, i + batchSize);
    const created = await Promise.all(
      batch.map(async function (file) {
        const content = file.bytes ? bytesToBase64(file.bytes) : utf8ToBase64(file.text);
        const blob = await githubRequest(env, "POST", "/repos/" + owner + "/" + repo + "/git/blobs", {
          content: content,
          encoding: "base64",
        });
        if (!blob.ok) {
          throw new Error((blob.data.message || "Could not upload " + file.path) + " (" + file.path + ")");
        }
        return { path: file.path, sha: blob.data.sha };
      })
    );
    treeEntries.push.apply(treeEntries, created);
  }

  const tree = await githubRequest(env, "POST", "/repos/" + owner + "/" + repo + "/git/trees", {
    base_tree: baseTreeSha,
    tree: treeEntries.map(function (entry) {
      return { path: entry.path, mode: "100644", type: "blob", sha: entry.sha };
    }),
  });
  if (!tree.ok) throw new Error(tree.data.message || "Could not build the GitHub commit.");

  const commit = await githubRequest(env, "POST", "/repos/" + owner + "/" + repo + "/git/commits", {
    message: message,
    tree: tree.data.sha,
    parents: [parentSha],
  });
  if (!commit.ok) throw new Error(commit.data.message || "Could not commit the starter files.");

  const updated = await githubRequest(
    env,
    "PATCH",
    "/repos/" + owner + "/" + repo + "/git/refs/heads/" + branch,
    { sha: commit.data.sha }
  );
  if (!updated.ok) throw new Error(updated.data.message || "Could not update the repo branch.");
}

async function putGithubFile(env, owner, repo, path, content, message) {
  const sha = await githubFileSha(env, owner, repo, path);
  const payload = {
    message: message,
    content: content,
  };
  if (sha) payload.sha = sha;
  const headers = Object.assign({}, githubHeaders(env), { "Content-Type": "application/json" });
  let res = await fetch(
    "https://api.github.com/repos/" + owner + "/" + repo + "/contents/" + path,
    {
      method: "PUT",
      headers: headers,
      body: JSON.stringify(payload),
    }
  );
  if (!res.ok && (res.status === 409 || res.status === 422) && !sha) {
    payload.sha = await githubFileSha(env, owner, repo, path);
    if (payload.sha) {
      res = await fetch("https://api.github.com/repos/" + owner + "/" + repo + "/contents/" + path, {
        method: "PUT",
        headers: headers,
        body: JSON.stringify(payload),
      });
    }
  }
  if (!res.ok) {
    const body = await res.json().catch(function () {
      return {};
    });
    throw new Error(body.message || "Could not write " + path);
  }
}

function githubHeaders(env) {
  return {
    Authorization: "Bearer " + env.GITHUB_TOKEN,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "vibeit-admin",
  };
}

function fillTokens(text, values) {
  return String(text || "").replace(/__([A-Z0-9_]+)__/g, function (_, key) {
    return values[key] != null ? String(values[key]) : "";
  });
}

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function productCards(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map(function (line) {
      return line.replace(/^[-•*]\s*/, "").trim();
    })
    .filter(function (line) {
      return line && !/^Price list file:/i.test(line);
    })
    .slice(0, 9);
  if (!lines.length) {
    return [
      "<li><h3>Item one</h3><p>Fill from the brief or uploaded catalogue.</p></li>",
      "<li><h3>Item two</h3><p>Fill from the brief or uploaded catalogue.</p></li>",
      "<li><h3>Item three</h3><p>Fill from the brief or uploaded catalogue.</p></li>",
    ].join("\n          ");
  }
  return lines
    .map(function (line) {
      const parts = line.split(/\s[–—-]\s|\s:\s/);
      const title = escapeHtml(parts[0].slice(0, 80));
      const detail = parts.length > 1 ? escapeHtml(parts.slice(1).join(" — ").slice(0, 160)) : "";
      return "<li><h3>" + title + "</h3><p>" + detail + "</p></li>";
    })
    .join("\n          ");
}

function fieldFromBrief(text, label) {
  const match = String(text || "").match(new RegExp("^" + label + ":\\s*(.+)$", "im"));
  return match ? match[1].trim() : "";
}

function blockFromBrief(text, heading) {
  const lines = String(text || "").split(/\r?\n/);
  const start = lines.findIndex(function (line) {
    return line.trim() === heading;
  });
  if (start < 0) return "";
  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) {
      if (out.length) break;
      continue;
    }
    if (/^[A-Z][A-Z0-9 ]+$/.test(line)) break;
    out.push(line);
  }
  return out.join("\n").trim();
}

function coloursFromBrief(text) {
  const found = [];
  String(text || "").replace(/#[0-9a-fA-F]{6}/g, function (hex) {
    const value = hex.toLowerCase();
    if (found.indexOf(value) === -1) found.push(value);
  });
  return found.slice(0, 3);
}

function hexLum(hex) {
  const h = String(hex || "").replace("#", "");
  if (h.length !== 6) return 0;
  const channel = function (i) {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

function paletteFromColours(colours) {
  const list = colours.length ? colours : ["#c45a12", "#f7f3ee", "#16130f"];
  const ranked = list.slice().sort(function (a, b) {
    return hexLum(a) - hexLum(b);
  });
  const ink = ranked[0];
  const paper = ranked[ranked.length - 1];
  const accent = list.filter(function (c) {
    return c !== ink && c !== paper;
  })[0] || list[0];
  return {
    c1: list[0],
    c2: list[1] || ink,
    c3: list[2] || paper,
    ink: ink,
    paper: paper,
    accent: accent,
    onAccent: hexLum(accent) > 0.45 ? ink : paper,
  };
}

function headlineFrom(about, name) {
  const line = String(about || "").split(/\n/)[0].trim();
  const sentence = line.split(/(?<=[.!?])\s/)[0] || line || name;
  if (sentence.length <= 90) return sentence;
  return sentence.slice(0, 87).replace(/\s+\S*$/, "");
}

function serviceCards(text) {
  return productCards(text);
}

function ctaFromAction(action, phone, email, whatsapp) {
  const label = action || "Contact";
  if (action === "Call" && phone) return { label: label, href: "tel:" + phone.replace(/\s+/g, "") };
  if (action === "WhatsApp" && whatsapp) return { label: label, href: whatsappHref(whatsapp) };
  if (action === "Email" && email) return { label: label, href: "mailto:" + email };
  if (action === "Book") return { label: label, href: "#bookings" };
  if (action === "Buy") return { label: label, href: "#services" };
  if (email) return { label: label, href: "mailto:" + email };
  return { label: label, href: "#contact" };
}

function whatsappHref(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.indexOf("0") === 0) digits = "27" + digits.slice(1);
  return "https://wa.me/" + digits;
}

function extFromFile(file) {
  const name = String(file.name || file.label || "");
  const match = name.match(/(\.[a-z0-9]{1,8})$/i);
  if (match) {
    const ext = match[1].toLowerCase();
    return ext === ".jpeg" ? ".jpg" : ext;
  }
  const type = String(file.type || "");
  if (type.indexOf("png") !== -1) return ".png";
  if (type.indexOf("webp") !== -1) return ".webp";
  if (type.indexOf("gif") !== -1) return ".gif";
  if (type.indexOf("jpeg") !== -1) return ".jpg";
  if (type.indexOf("pdf") !== -1) return ".pdf";
  if (type.indexOf("spreadsheet") !== -1 || type.indexOf("excel") !== -1) return ".xlsx";
  if (type.indexOf("wordprocessing") !== -1 || type.indexOf("msword") !== -1) return ".docx";
  if (type.indexOf("csv") !== -1) return ".csv";
  return ".bin";
}

function isImageExt(ext) {
  return /\.(jpe?g|png|gif|webp)$/i.test(String(ext || ""));
}

function utf8ToBase64(text) {
  return bytesToBase64(encoder.encode(String(text || "")));
}

async function ensureInvoicesTable(env) {
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS invoices (id TEXT PRIMARY KEY, brief_id TEXT NOT NULL, created_at TEXT NOT NULL, kind TEXT NOT NULL, number TEXT NOT NULL, amount INTEGER NOT NULL, description TEXT, note TEXT, to_email TEXT, sent_at TEXT, sent_via TEXT)"
  ).run();
}

async function listQuotes(env, briefId) {
  try {
    await ensureInvoicesTable(env);
    const result = await env.DB.prepare(
      "SELECT id, created_at, kind, number, amount, description, sent_at, sent_via FROM invoices WHERE brief_id = ? ORDER BY created_at DESC LIMIT 20"
    )
      .bind(briefId)
      .all();
    return (result.results || []).map(function (row) {
      return {
        id: row.id,
        createdAt: row.created_at,
        kind: row.kind,
        number: row.number,
        amount: row.amount,
        description: row.description || "",
        sentAt: row.sent_at || "",
        sentVia: row.sent_via || "",
      };
    });
  } catch (err) {
    return [];
  }
}

async function nextQuoteNumber(env) {
  const day = new Date().toISOString().slice(2, 10).replace(/-/g, "");
  const prefix = "VI-" + day + "-";
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM invoices WHERE number LIKE ?")
    .bind(prefix + "%")
    .first();
  const n = Number((row && row.n) || 0) + 1;
  return prefix + String(n).padStart(2, "0");
}

function quoteDescription(row, kind) {
  const pkg = String(row.package || "").trim();
  if (pkg) return pkg.replace(/\s+—\s+from\s+/i, " — ");
  return kind === "invoice" ? "VibeIt website — once-off" : "VibeIt website quote — once-off";
}

function displayDate(iso) {
  try {
    return new Date(iso).toLocaleDateString("en-ZA", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch (err) {
    return iso;
  }
}

function quoteDoc(row, invoice, bank, toEmail) {
  const images = quoteImageEntries(row);
  const logo = images.find(function (item) {
    return /logo/i.test(item.label);
  });
  const extra = String(invoice.description || "") === "Additional work";
  const scope = quoteScope(row);
  return {
    kind: invoice.kind,
    number: invoice.number,
    amount: Number(invoice.amount) || 0,
    description: invoice.description,
    note: invoice.note || "",
    extra: extra,
    businessName: String(row.business_name || "").trim() || "Client",
    toEmail: toEmail,
    createdAt: displayDate(invoice.created_at),
    bank: bank,
    scope: extra ? { facts: scope.facts, sections: [] } : scope,
    clientImages: images.map(function (item) {
      return { url: item.url, label: item.label };
    }),
    clientLogoUrl: (logo || images[0] || {}).url || "",
  };
}

function isQuoteRaster(file) {
  const type = String((file && file.type) || "").toLowerCase();
  const name = String((file && file.name) || "") + " " + String((file && file.originalName) || "");
  if (type.indexOf("svg") !== -1 || /\.svg(\s|$)/i.test(name)) return false;
  if (type.indexOf("png") !== -1 || type.indexOf("jpeg") !== -1 || type.indexOf("jpg") !== -1) return true;
  if (type.indexOf("image/") === 0 && type.indexOf("gif") === -1 && type.indexOf("webp") === -1) return true;
  return /\.(png|jpe?g)(\s|$)/i.test(name);
}

function quoteFileLabel(file) {
  const label = String((file && file.label) || "").trim();
  if (label && !/^file$/i.test(label)) return label;
  const blob = String((file && file.name) || "") + " " + String((file && file.originalName) || "");
  if (/logo/i.test(blob)) return "Logo";
  if (/storefront/i.test(blob)) return "Storefront";
  if (/product/i.test(blob)) return "Products";
  if (/interior/i.test(blob)) return "Interior";
  if (/vibe/i.test(blob)) return "Vibe photo";
  return "Photo";
}

function quoteImageEntries(row) {
  const files = parseFiles(row.files);
  const entries = [];
  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    if (!isQuoteRaster(file)) continue;
    entries.push({
      file: file,
      label: quoteFileLabel(file),
      url: "/api/briefs/" + row.id + "/file/" + i,
    });
  }
  entries.sort(function (a, b) {
    const aLogo = /logo/i.test(a.label) ? 0 : 1;
    const bLogo = /logo/i.test(b.label) ? 0 : 1;
    return aLogo - bLogo;
  });
  return entries.slice(0, 8);
}

async function loadClientImages(env, row) {
  const entries = quoteImageEntries(row);
  const out = [];
  for (let i = 0; i < entries.length; i += 1) {
    const file = entries[i].file;
    if (!file || !file.key) continue;
    const object = await env.FILES.get(file.key, { type: "arrayBuffer" });
    if (!object || !object.byteLength) continue;
    out.push({
      bytes: new Uint8Array(object),
      type: String(file.type || "image/png"),
      label: entries[i].label,
    });
  }
  return out;
}

async function renderQuotePdf(env, row, doc) {
  const brandBytes = await loadLogoBytes();
  return quotePdf(doc, { brandBytes: brandBytes });
}

async function sendQuote(request, env, id) {
  const email = await currentUser(request, env);
  if (!email) return json({ error: "Login required" }, 401);
  const row = await env.DB.prepare("SELECT * FROM briefs WHERE id = ?").bind(id).first();
  if (!row) return json({ error: "Not found" }, 404);
  const bank = bankFromEnv(env);
  if (!bank.ready) {
    return json(
      {
        error:
          "Add VIBEIT_ACCOUNT_NAME, VIBEIT_BANK, and VIBEIT_ACCOUNT_NUMBER in Cloudflare (Workers → vibeit-admin → Settings → Variables), then send.",
      },
      501
    );
  }
  const toEmail = String(row.email || "").trim();
  if (!toEmail || toEmail.indexOf("@") === -1) {
    return json({ error: "This brief has no client email." }, 400);
  }
  const body = await request.json().catch(function () {
    return {};
  });
  const kind = String(body.kind || "quote") === "invoice" ? "invoice" : "quote";
  const amount = Math.round(Number(body.amount));
  if (!amount || amount < 1) return json({ error: "Enter an amount in rand." }, 400);
  const extra = Boolean(body.extra);
  const note = String(body.note || (extra ? row.extra_note : "") || "")
    .trim()
    .slice(0, extra ? 2000 : 400);
  if (extra && !note) return json({ error: "Write what the additional work is before quoting it." }, 400);
  await ensureInvoicesTable(env);
  const invoice = {
    id: crypto.randomUUID(),
    kind: kind,
    number: await nextQuoteNumber(env),
    amount: amount,
    description: extra ? "Additional work" : quoteDescription(row, kind),
    note: note,
    created_at: new Date().toISOString(),
  };
  const doc = quoteDoc(row, invoice, bank, toEmail);
  await env.DB.prepare(
    "INSERT INTO invoices (id, brief_id, created_at, kind, number, amount, description, note, to_email, sent_at, sent_via) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(
      invoice.id,
      id,
      invoice.created_at,
      invoice.kind,
      invoice.number,
      invoice.amount,
      invoice.description,
      invoice.note,
      toEmail,
      "",
      ""
    )
    .run();

  const fileName = quoteFileName(kind, doc.businessName);
  let pdfBytes = null;
  try {
    pdfBytes = await renderQuotePdf(env, row, doc);
  } catch (err) {}

  const coverHtml = quoteCoverHtml(doc);
  const coverText = quoteText(doc);
  const subject = quoteSubject(kind, invoice.number, doc.businessName);
  let mailed = { sent: false, error: "" };
  if (pdfBytes) {
    mailed = await sendViaGmail(env, {
      to: toEmail,
      bcc: "support@vibeit-intel.net",
      subject: subject,
      html: coverHtml,
      text: coverText,
      filename: fileName,
      pdfBytes: pdfBytes,
    });
  }
  if (!mailed.sent) {
    const attachments = pdfBytes ? [{ filename: fileName, content: bytesToBase64(pdfBytes) }] : [];
    const resend = await tryResend(env, toEmail, subject, coverHtml, coverText, attachments);
    if (resend.sent) mailed = { sent: true, via: "email" };
    else if (resend.error) mailed.error = mailed.error || resend.error;
  }

  const sentVia = mailed.sent ? mailed.via || "email" : "";
  const sentAt = mailed.sent ? new Date().toISOString() : "";
  await env.DB.prepare("UPDATE invoices SET sent_at = ?, sent_via = ? WHERE id = ?")
    .bind(sentAt, sentVia, invoice.id)
    .run();

  const gmail = await gmailStatus(env);
  return json({
    ok: true,
    sent: mailed.sent,
    sentVia: sentVia,
    mailError: mailed.error || "",
    needGmail: !mailed.sent && !gmail.connected,
    gmail: "",
    mailto: "",
    printUrl: "/api/briefs/" + id + "/quote/" + invoice.id,
    pdfUrl: "/api/briefs/" + id + "/quote/" + invoice.id + ".pdf",
    fileName: fileName,
    quote: {
      id: invoice.id,
      kind: invoice.kind,
      number: invoice.number,
      amount: invoice.amount,
      sentAt: sentAt,
      sentVia: sentVia,
    },
  });
}

async function loadQuoteDoc(env, briefId, quoteId) {
  await ensureInvoicesTable(env);
  const row = await env.DB.prepare("SELECT * FROM briefs WHERE id = ?").bind(briefId).first();
  const invoice = await env.DB.prepare("SELECT * FROM invoices WHERE id = ? AND brief_id = ?")
    .bind(quoteId, briefId)
    .first();
  if (!row || !invoice) return null;
  return {
    invoice: invoice,
    row: row,
    doc: quoteDoc(row, invoice, bankFromEnv(env), invoice.to_email || row.email || ""),
  };
}

async function getQuotePage(request, env, briefId, quoteId) {
  const email = await currentUser(request, env);
  if (!email) return json({ error: "Login required" }, 401);
  const loaded = await loadQuoteDoc(env, briefId, quoteId);
  if (!loaded) return json({ error: "Not found" }, 404);
  return new Response(quoteHtml(loaded.doc, { printable: true }), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}

async function getQuotePdf(request, env, briefId, quoteId) {
  const email = await currentUser(request, env);
  if (!email) return json({ error: "Login required" }, 401);
  const loaded = await loadQuoteDoc(env, briefId, quoteId);
  if (!loaded) return json({ error: "Not found" }, 404);
  const bytes = await renderQuotePdf(env, loaded.row, loaded.doc);
  const name = quoteFileName(loaded.invoice.kind, loaded.doc.businessName);
  return new Response(bytes, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": attachmentName(name),
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}

function attachmentName(name) {
  const ascii = String(name || "Quote.pdf")
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/"/g, "");
  const encoded = encodeURIComponent(name || "Quote.pdf");
  return 'attachment; filename="' + ascii + "\"; filename*=UTF-8''" + encoded;
}

async function tryResend(env, to, subject, html, text, attachments) {
  if (!env.RESEND_API_KEY) return { sent: false };
  const from = String(env.RESEND_FROM || "VibeIt-Intel <support@vibeit-intel.net>").trim();
  const payload = {
    from: from,
    to: [to],
    bcc: ["support@vibeit-intel.net"],
    subject: subject,
    html: html,
    text: text,
  };
  if (attachments && attachments.length) payload.attachments = attachments;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + env.RESEND_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.json().catch(function () {
        return {};
      });
      return { sent: false, error: body.message || "Email did not send" };
    }
    return { sent: true };
  } catch (err) {
    return { sent: false, error: err.message || "Email did not send" };
  }
}

async function ensureBriefColumns(env) {
  const alters = [
    "ALTER TABLE briefs ADD COLUMN github_repo TEXT",
    "ALTER TABLE briefs ADD COLUMN cursor_agent_id TEXT",
    "ALTER TABLE briefs ADD COLUMN cursor_url TEXT",
    "ALTER TABLE briefs ADD COLUMN preview_url TEXT",
    "ALTER TABLE briefs ADD COLUMN preview_status TEXT",
    "ALTER TABLE briefs ADD COLUMN build_error TEXT",
    "ALTER TABLE briefs ADD COLUMN extra_note TEXT",
    "ALTER TABLE briefs ADD COLUMN extra_amount INTEGER",
  ];
  for (let i = 0; i < alters.length; i++) {
    try {
      await env.DB.prepare(alters[i]).run();
    } catch (err) {}
  }
}

async function saveJobBuild(env, id, fields) {
  await ensureBriefColumns(env);
  const row = await env.DB.prepare("SELECT * FROM briefs WHERE id = ?").bind(id).first();
  if (!row) return;
  const repo = fields.repoUrl != null ? fields.repoUrl : row.github_repo || "";
  const agentId = fields.agentId != null ? fields.agentId : row.cursor_agent_id || "";
  const cursorUrl = fields.cursorUrl != null ? fields.cursorUrl : row.cursor_url || "";
  const previewUrl = fields.previewUrl != null ? fields.previewUrl : row.preview_url || "";
  const previewStatus = fields.previewStatus != null ? fields.previewStatus : row.preview_status || "";
  const buildError = fields.buildError != null ? fields.buildError : row.build_error || "";
  const sql = fields.markProgress
    ? "UPDATE briefs SET github_repo = ?, cursor_agent_id = ?, cursor_url = ?, preview_url = ?, preview_status = ?, build_error = ?, status = CASE WHEN status = 'new' THEN 'in_progress' ELSE status END WHERE id = ?"
    : "UPDATE briefs SET github_repo = ?, cursor_agent_id = ?, cursor_url = ?, preview_url = ?, preview_status = ?, build_error = ? WHERE id = ?";
  await env.DB.prepare(sql)
    .bind(repo, agentId, cursorUrl, previewUrl, previewStatus, buildError, id)
    .run();
}

async function saveBuild(env, id, repo, agentId, cursorUrl) {
  await saveJobBuild(env, id, {
    repoUrl: repo,
    agentId: agentId,
    cursorUrl: cursorUrl,
    markProgress: true,
  });
}

function slugify(name) {
  const slug = String(name || "client")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "client";
}

function bytesToBase64(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const chunk = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function sleep(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

function shapeBrief(row) {
  const briefText = row.brief_text || "";
  return {
    id: row.id,
    createdAt: row.created_at,
    status: row.status,
    package: row.package,
    businessName: row.business_name,
    email: String(row.email || fieldFromBrief(briefText, "Email") || "").trim(),
    phone: String(row.phone || fieldFromBrief(briefText, "Phone") || "").trim(),
    whatsapp: String(fieldFromBrief(briefText, "WhatsApp") || "").trim(),
    subject: row.subject,
    briefText: briefText,
    files: enrichFiles(parseFiles(row.files), briefText),
    githubRepo: row.github_repo || "",
    cursorAgentId: row.cursor_agent_id || "",
    cursorUrl: row.cursor_url || "",
    previewUrl: row.preview_url || "",
    previewStatus: row.preview_status || "",
    buildError: row.build_error || "",
    extraNote: row.extra_note || "",
    extraAmount: Number(row.extra_amount) || 0,
  };
}

function canonicalSlot(label) {
  const raw = String(label || "").toLowerCase();
  if (/price|catalogue|catalog/.test(raw)) return "Price list";
  if (/vibe/.test(raw)) return "Vibe photo";
  if (/logo/.test(raw)) return "Logo";
  return "Extra photo";
}

function normalizeFileLabels(files) {
  let logo = false;
  let vibe = false;
  const slotted = files.map(function (file) {
    let slot = canonicalSlot(file.label);
    if (slot === "Logo") {
      if (logo) slot = "Extra photo";
      else logo = true;
    } else if (slot === "Vibe photo") {
      if (vibe) slot = "Extra photo";
      else vibe = true;
    }
    return Object.assign({}, file, { label: slot });
  });
  let extra = 0;
  let price = 0;
  return slotted.map(function (file) {
    if (file.label === "Extra photo") {
      extra += 1;
      return Object.assign({}, file, { label: "Extra photo " + extra });
    }
    if (file.label === "Price list") {
      price += 1;
      if (price > 1) return Object.assign({}, file, { label: "Price list " + price });
    }
    return file;
  });
}

function filesBlock(files) {
  const lines = ["FILES (" + files.length + ")"];
  files.forEach(function (file) {
    lines.push("• " + (file.label || "File") + " — " + (file.originalName || file.name || "file"));
  });
  return lines.join("\n");
}

function replaceFilesBlock(briefText, files) {
  const lines = String(briefText || "").split(/\r?\n/);
  const block = filesBlock(files).split("\n");
  const start = lines.findIndex(function (line) {
    return /^FILES\b/.test(line.trim());
  });
  if (start < 0) {
    const base = lines.join("\n").trim();
    return (base ? base + "\n\n" : "") + block.join("\n");
  }
  let end = start + 1;
  while (end < lines.length && /^[•\-]\s/.test(lines[end].trim())) end += 1;
  return lines.slice(0, start).concat(block, lines.slice(end)).join("\n");
}

function parseFiles(raw) {
  try {
    const files = JSON.parse(raw || "[]");
    return Array.isArray(files) ? files : [];
  } catch (err) {
    return [];
  }
}

function originalsFromBrief(text) {
  const out = [];
  let inFiles = false;
  String(text || "")
    .split(/\r?\n/)
    .forEach(function (raw) {
      const line = raw.trim();
      if (/^FILES\b/.test(line)) {
        inFiles = true;
        return;
      }
      if (!inFiles) return;
      if (!line || /^[A-Z][A-Z0-9 ]+$/.test(line)) {
        inFiles = false;
        return;
      }
      const match = line.match(/^[•\-]\s*(.+?)\s+[—–-]\s+(.+)$/);
      if (match) out.push({ label: match[1].trim(), name: match[2].trim() });
    });
  return out;
}

function slotKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function nameLooksLikeSlot(name, label) {
  const base = slotKey(String(name || "").replace(/\.[^.]+$/, "").split(/[/\\]/).pop());
  const slot = slotKey(label);
  return Boolean(base && slot && base === slot);
}

function pickOriginalName(fileName, label, listed) {
  const listedName = listed && listed.name;
  if (listedName && !nameLooksLikeSlot(listedName, label)) return listedName;
  if (fileName && !nameLooksLikeSlot(fileName, label)) return fileName;
  return listedName || fileName || "";
}

function enrichFiles(files, briefText) {
  const listed = originalsFromBrief(briefText);
  return files.map(function (file, i) {
    if (file.originalName && !nameLooksLikeSlot(file.originalName, file.label)) return file;
    const originalName = pickOriginalName(file.originalName || file.name, file.label, listed[i]);
    if (!originalName || originalName === file.originalName) return file;
    return Object.assign({}, file, { originalName: originalName });
  });
}

function pickPhone(briefText, form) {
  const fromForm = String(form.get("Phone") || form.get("WhatsApp") || "").trim();
  if (fromForm) return fromForm;
  const match = String(briefText || "").match(/Phone:\s*(.+)/i);
  return match ? match[1].trim() : "";
}

function sanitizeName(name) {
  return String(name || "file")
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 80) || "file";
}

function isForm(request) {
  const type = request.headers.get("content-type") || "";
  return type.indexOf("multipart/form-data") === 0 || type.indexOf("application/x-www-form-urlencoded") === 0;
}

function allowedList(env, key) {
  return String(env[key] || "")
    .split(",")
    .map(function (item) {
      return item.trim().toLowerCase();
    })
    .filter(Boolean);
}

function isAllowed(email, env) {
  return allowedList(env, "ALLOWED_EMAILS").indexOf(String(email || "").toLowerCase()) !== -1;
}

function isAllowedOrigin(request, env, url) {
  const origin = request.headers.get("Origin") || "";
  if (!origin) {
    const referer = request.headers.get("Referer") || "";
    return allowedList(env, "ALLOWED_ORIGINS").some(function (allowed) {
      return referer.indexOf(allowed) === 0;
    });
  }
  const allowed = allowedList(env, "ALLOWED_ORIGINS");
  if (allowed.indexOf(origin.toLowerCase()) !== -1) return true;
  return origin.toLowerCase() === url.origin.toLowerCase();
}

function cors(request, env, response) {
  const origin = request.headers.get("Origin") || "";
  if (!origin) return response;
  const allowed = allowedList(env, "ALLOWED_ORIGINS");
  if (allowed.indexOf(origin.toLowerCase()) === -1) return response;
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type");
  headers.set("Vary", "Origin");
  return new Response(response.body, { status: response.status, headers });
}

async function currentUser(request, env) {
  const access = String(request.headers.get("Cf-Access-Authenticated-User-Email") || "")
    .trim()
    .toLowerCase();
  if (access && isAllowed(access, env)) return access;
  const token = readCookie(request, COOKIE);
  const payload = await readToken(token, env.SESSION_SECRET);
  if (!payload || !payload.email) return null;
  if (!isAllowed(payload.email, env)) return null;
  return payload.email;
}

async function setSession(request, email, env) {
  const token = await signToken({ email }, env.SESSION_SECRET, WEEK);
  return new Response(null, {
    status: 302,
    headers: {
      Location: "/",
      "Set-Cookie": cookie(request, token),
    },
  });
}

function redirectHome(hash) {
  return new Response(null, { status: 302, headers: { Location: "/" + (hash || "") } });
}

function cookie(request, value, maxAge) {
  const age = maxAge == null ? WEEK : maxAge;
  const secure = request && new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return (
    COOKIE +
    "=" +
    value +
    "; Path=/; HttpOnly; SameSite=Lax" +
    secure +
    "; Max-Age=" +
    age
  );
}

function readCookie(request, name) {
  const raw = request.headers.get("Cookie") || "";
  const parts = raw.split(";");
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i].trim();
    if (part.indexOf(name + "=") === 0) return part.slice(name.length + 1);
  }
  return "";
}

async function hmacKey(secret) {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

async function signToken(payload, secret, seconds) {
  const body = Object.assign({ exp: Math.floor(Date.now() / 1000) + seconds }, payload);
  const data = b64url(encoder.encode(JSON.stringify(body)));
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return data + "." + b64url(new Uint8Array(sig));
}

async function readToken(token, secret) {
  if (!token || !secret || token.indexOf(".") === -1) return null;
  const parts = token.split(".");
  const data = parts[0];
  const sig = parts[1];
  const key = await hmacKey(secret);
  const ok = await crypto.subtle.verify("HMAC", key, b64urlToBytes(sig), encoder.encode(data));
  if (!ok) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(data)));
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch (err) {
    return null;
  }
}

function b64url(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64urlToBytes(str) {
  const pad = str.length % 4 === 0 ? "" : "=".repeat(4 - (str.length % 4));
  const bin = atob(str.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function json(body, status, extra) {
  const headers = new Headers(extra || {});
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(body), { status: status || 200, headers });
}

function withSecurity(response) {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "same-origin");
  headers.set("X-Robots-Tag", "noindex, nofollow");
  return new Response(response.body, { status: response.status, headers });
}
