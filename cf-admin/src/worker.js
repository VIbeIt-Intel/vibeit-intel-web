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
  if (path === "/auth/password" && method === "POST") return passwordLogin(request, env);
  if (path === "/auth/logout" && method === "POST") return logout(request);
  if (path === "/api/me" && method === "GET") return me(request, env);
  if (path === "/api/briefs" && method === "POST") return createBrief(request, env, url);
  if (path === "/api/briefs" && method === "GET") return listBriefs(request, env);
  if (path === "/api/auth-options" && method === "GET") return authOptions(env);

  const briefMatch = path.match(/^\/api\/briefs\/([^/]+)$/);
  if (briefMatch && method === "GET") return getBrief(request, env, briefMatch[1]);
  if (briefMatch && method === "PATCH") return patchBrief(request, env, briefMatch[1]);

  const fileMatch = path.match(/^\/api\/briefs\/([^/]+)\/file\/(\d+)$/);
  if (fileMatch && method === "GET") return getFile(request, env, fileMatch[1], Number(fileMatch[2]));

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
  return json({ email });
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

  for (const [label, value] of form.entries()) {
    if (!(value instanceof Blob) || !value.size) continue;
    if (value.size > 8 * 1024 * 1024) continue;
    const safe = sanitizeName(value.name || label || "file");
    const key = "briefs/" + id + "/" + String(savedFiles.length + 1).padStart(2, "0") + "-" + safe;
    await env.FILES.put(key, await value.arrayBuffer());
    savedFiles.push({
      key: key,
      name: value.name || safe,
      type: value.type || "application/octet-stream",
      size: value.size,
      label: label,
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
    status && /^(new|in_progress|done)$/.test(status)
      ? "SELECT id, created_at, status, package, business_name, email, phone, subject, files FROM briefs WHERE status = ? ORDER BY created_at DESC LIMIT 200"
      : "SELECT id, created_at, status, package, business_name, email, phone, subject, files FROM briefs ORDER BY created_at DESC LIMIT 200";
  const result = status && /^(new|in_progress|done)$/.test(status)
    ? await env.DB.prepare(sql).bind(status).all()
    : await env.DB.prepare(sql).all();
  const rows = (result.results || []).map(shapeBrief);
  return json({ briefs: rows });
}

async function getBrief(request, env, id) {
  const email = await currentUser(request, env);
  if (!email) return json({ error: "Login required" }, 401);
  const row = await env.DB.prepare("SELECT * FROM briefs WHERE id = ?").bind(id).first();
  if (!row) return json({ error: "Not found" }, 404);
  return json({ brief: shapeBrief(row) });
}

async function patchBrief(request, env, id) {
  const email = await currentUser(request, env);
  if (!email) return json({ error: "Login required" }, 401);
  const body = await request.json().catch(function () {
    return {};
  });
  const status = String(body.status || "");
  if (!/^(new|in_progress|done)$/.test(status)) return json({ error: "Bad status" }, 400);
  const result = await env.DB.prepare("UPDATE briefs SET status = ? WHERE id = ?").bind(status, id).run();
  if (!result.meta || !result.meta.changes) return json({ error: "Not found" }, 404);
  return json({ ok: true, status });
}

async function getFile(request, env, id, index) {
  const email = await currentUser(request, env);
  if (!email) return json({ error: "Login required" }, 401);
  const row = await env.DB.prepare("SELECT files FROM briefs WHERE id = ?").bind(id).first();
  if (!row) return json({ error: "Not found" }, 404);
  const files = parseFiles(row.files);
  const file = files[index];
  if (!file || !file.key) return json({ error: "Not found" }, 404);
  const object = await env.FILES.get(file.key, { type: "arrayBuffer" });
  if (!object) return json({ error: "Missing file" }, 404);
  const headers = new Headers();
  headers.set("Content-Type", file.type || "application/octet-stream");
  headers.set("Content-Disposition", "inline; filename=\"" + (file.name || "file").replace(/"/g, "") + "\"");
  headers.set("Cache-Control", "private, max-age=3600");
  headers.set("X-Robots-Tag", "noindex");
  return new Response(object, { headers });
}

function shapeBrief(row) {
  return {
    id: row.id,
    createdAt: row.created_at,
    status: row.status,
    package: row.package,
    businessName: row.business_name,
    email: row.email,
    phone: row.phone,
    subject: row.subject,
    briefText: row.brief_text || "",
    files: parseFiles(row.files),
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
