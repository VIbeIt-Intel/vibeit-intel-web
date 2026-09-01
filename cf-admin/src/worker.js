import { STARTER_FILES } from "./starterFiles.js";
import { formatMarkdown, formatPlaybook } from "./siteFormats.js";
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

  const fileMatch = path.match(/^\/api\/briefs\/([^/]+)\/file\/(\d+)$/);
  if (fileMatch && method === "GET") return getFile(request, env, fileMatch[1], Number(fileMatch[2]));

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
  const status = new URL(request.url).searchParams.get("status") || "";
  const sql =
    status && /^(new|in_progress|done|declined)$/.test(status)
      ? "SELECT id, created_at, status, package, business_name, email, phone, subject, brief_text, files FROM briefs WHERE status = ? ORDER BY created_at DESC LIMIT 200"
      : "SELECT id, created_at, status, package, business_name, email, phone, subject, brief_text, files FROM briefs ORDER BY created_at DESC LIMIT 200";
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
  const status = String(body.status || "");
  if (!/^(new|in_progress|done|declined)$/.test(status)) return json({ error: "Bad status" }, 400);
  const result = await env.DB.prepare("UPDATE briefs SET status = ? WHERE id = ?").bind(status, id).run();
  if (!result.meta || !result.meta.changes) return json({ error: "Not found" }, 404);
  return json({ ok: true, status });
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
  const type = String(body.type || "").trim();
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
      await seedClientRepo(env, repo.repoUrl, row, type, action, instructions);
    }
  } catch (err) {
    const message = "Repo is pinned, but seeding failed: " + (err.message || "could not write starter files.");
    await saveJobBuild(env, id, { repoUrl: repo.repoUrl, buildError: message, markProgress: true });
    return json({ error: message, repoUrl: repo.repoUrl }, 502);
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
  if (extra) {
    lines.push("", "SPECIAL INSTRUCTIONS FROM VIBEIT ADMIN (follow these):", extra);
  }
  lines.push(
    "",
    formatPlaybook(type),
    "",
    "Hard rules:",
    "- This repo already has the VibeIt starter (index.html, styles.css) plus BRIEF.md, FORMAT.md, PREVIEW.md, and assets/. Customise that starter. Do not start from a blank page.",
    "- Keep a single index.html. Do not add a framework or extra HTML pages.",
    "- Follow FORMAT.md. A hairdresser, a maintenance trade, and a food seller must not share the same page structure.",
    "- The main button and contact path must drive this action: " + action + "."
  );
  if (extra) {
    lines.push(
      "- Follow the special instructions from VibeIt admin above. They override layout defaults where they conflict, but never invent prices, payment details, or VibeIt fees."
    );
  }
  lines.push(
    "- Use the client's brand colours in styles.css (:root --c1 --c2 --c3). Do not replace them with VibeIt teal/orange.",
    "- Use files in assets/ for the logo and gallery. Do not invent a different logo. Do not ask anyone to paste or drag files.",
    "- If assets/ has a Word, Excel, PDF, CSV, or photo price list, use it for services and prices. Do not ignore it.",
    "- Services and products are different. Treatments, repairs, and bookings go under Services. Items they sell (food, nail products, parts, merch) go under Shop. Hide Shop if they do not sell items.",
    "- South African English. Mobile-first. WhatsApp-friendly where a number exists. If the customer action is Email, the main button must be mailto: the client's email from the brief.",
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
  for (let i = 0; i < files.length && images.length < 5; i++) {
    const file = files[i];
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

  const created = await githubRequest(env, "POST", "/orgs/" + encodeURIComponent(org) + "/repos", {
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
      "GitHub token cannot create repos in " + org + ". Grant org repo access, then try Start website again. (" + detail + ")"
    );
  }
  throw new Error(detail);
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
  const about = blockFromBrief(briefText, "WHAT THEY DO") || "Tell people who you serve and what you want them to do.";
  const hours = blockFromBrief(briefText, "HOURS") || "Hours to be confirmed.";
  const colours = coloursFromBrief(briefText);
  const items = blockFromBrief(briefText, "ITEMS FOR SALE");
  const sellsItems = /^Sells products:\s*Yes/im.test(briefText) || Boolean(items);
  const pack = /intermediate|booking/i.test(String(row.package || "")) ? "pack-intermediate" : "pack-entry";
  const cta = ctaFromAction(action, phone, email, whatsapp);
  const waHref = whatsappHref(whatsapp);
  const files = parseFiles(row.files);
  const uploaded = [];
  let extraCount = 0;
  let listCount = 0;
  let logoSrc = "";
  const gallery = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (!file.key) continue;
    const object = await env.FILES.get(file.key, { type: "arrayBuffer" });
    if (!object || !object.byteLength) continue;
    const label = String(file.label || file.name || "file").toLowerCase();
    const ext = extFromFile(file);
    const image = isImageExt(ext);
    let dest = "assets/file-" + (i + 1) + (ext || ".bin");
    if (label.indexOf("logo") !== -1 && !logoSrc) {
      dest = "assets/logo" + (ext || ".bin");
      if (image) logoSrc = dest;
    } else if (label.indexOf("vibe") !== -1 && image) {
      dest = "assets/vibe" + ext;
      gallery.push(dest);
    } else if (label.indexOf("price list") !== -1 || !image) {
      listCount += 1;
      dest = "assets/price-list-" + listCount + (ext || ".bin");
    } else {
      extraCount += 1;
      dest = "assets/extra-" + extraCount + ext;
      gallery.push(dest);
    }
    uploaded.push({ path: dest, bytes: object, message: "Add " + dest });
  }

  const values = {
    PACKAGE_CLASS: pack,
    NAME: name,
    TYPE: type,
    TAGLINE: about.split(/\n/)[0].slice(0, 140) || name,
    ABOUT: about,
    ADDRESS: address || "South Africa",
    PHONE: phone || "Phone on request",
    PHONE_HREF: phone.replace(/\s+/g, "") || "",
    EMAIL: email || "",
    CTA_HREF: cta.href,
    CTA_LABEL: cta.label,
    HOURS: hours,
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
        return '<img src="' + src + '" alt="" />';
      })
      .join("\n          ") || "<p>Photos to come.</p>",
    C1: colours[0] || "#c70000",
    C2: colours[1] || "#161018",
    C3: colours[2] || "#f6f1ea",
  };

  const preview = pagesUrl(owner, repo);
  const briefMd = [
    "# " + name,
    "",
    "Type: " + type,
    "Site format: " + type,
    "Customer action: " + action,
    "Package: " + String(row.package || ""),
  ];
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
  };

  const names = Object.keys(textFiles);
  for (let i = 0; i < names.length; i++) {
    await putGithubFile(env, owner, repo, names[i], utf8ToBase64(textFiles[names[i]]), "Seed " + names[i]);
  }
  for (let i = 0; i < uploaded.length; i++) {
    await putGithubFile(
      env,
      owner,
      repo,
      uploaded[i].path,
      bytesToBase64(uploaded[i].bytes),
      uploaded[i].message
    );
  }
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
      "SELECT id, created_at, kind, number, amount, sent_at, sent_via FROM invoices WHERE brief_id = ? ORDER BY created_at DESC LIMIT 20"
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
  return {
    kind: invoice.kind,
    number: invoice.number,
    amount: Number(invoice.amount) || 0,
    description: invoice.description,
    note: invoice.note || "",
    businessName: String(row.business_name || "").trim() || "Client",
    toEmail: toEmail,
    createdAt: displayDate(invoice.created_at),
    bank: bank,
    scope: quoteScope(row),
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
  const clientPhotos = await loadClientImages(env, row);
  return quotePdf(doc, { brandBytes: brandBytes, clientPhotos: clientPhotos });
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
  const note = String(body.note || "").trim().slice(0, 400);
  await ensureInvoicesTable(env);
  const invoice = {
    id: crypto.randomUUID(),
    kind: kind,
    number: await nextQuoteNumber(env),
    amount: amount,
    description: quoteDescription(row, kind),
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
  };
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
