import { STARTER_FILES } from "./starterFiles.js";
import { formatMarkdown, formatPlaybook } from "./siteFormats.js";
import {
  bankFromEnv,
  packageAmount,
  quoteHtml,
  quoteMailto,
  quoteSubject,
  quoteText,
} from "./invoice.js";

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
  if (briefMatch && method === "DELETE") return deleteBrief(request, env, briefMatch[1]);

  const fileMatch = path.match(/^\/api\/briefs\/([^/]+)\/file\/(\d+)$/);
  if (fileMatch && method === "GET") return getFile(request, env, fileMatch[1], Number(fileMatch[2]));

  const buildMatch = path.match(/^\/api\/briefs\/([^/]+)\/build$/);
  if (buildMatch && method === "POST") return startBuild(request, env, buildMatch[1]);

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
  return json({
    email,
    build: {
      cursor: Boolean(env.CURSOR_API_KEY),
      github: Boolean(env.GITHUB_TOKEN),
    },
    billing: {
      bank: bankFromEnv(env).ready,
      email: Boolean(env.RESEND_API_KEY),
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
  const row = await env.DB.prepare("SELECT * FROM briefs WHERE id = ?").bind(id).first();
  if (!row) return json({ error: "Not found" }, 404);
  const quotes = await listQuotes(env, id);
  const bank = bankFromEnv(env);
  return json({
    brief: Object.assign(shapeBrief(row), {
      suggestedAmount: packageAmount(row),
      quotes: quotes,
    }),
    billing: {
      bank: bank.ready,
      email: Boolean(env.RESEND_API_KEY),
    },
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

  const row = await env.DB.prepare("SELECT * FROM briefs WHERE id = ?").bind(id).first();
  if (!row) return json({ error: "Not found" }, 404);
  if (row.cursor_url) {
    return json({
      ok: true,
      repoUrl: row.github_repo || "",
      cursorUrl: row.cursor_url,
      agentId: row.cursor_agent_id || "",
    });
  }

  const body = await request.json().catch(function () {
    return {};
  });
  const type = String(body.type || "").trim();
  const action = String(body.action || "").trim();
  if (!type || !action) return json({ error: "Pick a site format and customer action" }, 400);
  if (packageTier(row) === "Advance") {
    return json({ error: "Advance is a custom enquiry. WhatsApp them or send a quote — do not start a standard website." }, 400);
  }
  if (packageTier(row) === "Entry" && (action === "Book" || action === "Buy")) {
    return json({ error: "Entry is Call, WhatsApp, or Get a quote. Book and Buy are Intermediate." }, 400);
  }

  const businessName = String(row.business_name || "client").trim();
  let repoUrl = String(row.github_repo || "").trim();
  if (!repoUrl) {
    try {
      repoUrl = await createGithubRepo(env, slugify(businessName), "VibeIt site for " + businessName);
      await sleep(1200);
      await seedClientRepo(env, repoUrl, row, type, action);
    } catch (err) {
      return json({ error: err.message || "Could not create the client repo" }, 502);
    }
  }

  const images = await collectPromptImages(env, parseFiles(row.files));
  const promptText = buildSitePrompt(row, type, action, repoUrl);
  const agentRes = await fetch("https://api.cursor.com/v1/agents", {
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
  const agentBody = await agentRes.json().catch(function () {
    return {};
  });
  const agent = agentBody.agent || agentBody;
  const cursorUrl = agent.url || "";
  const agentId = agent.id || "";
  if (!agentRes.ok || !cursorUrl) {
    await saveBuild(env, id, repoUrl, "", "");
    return json(
      {
        error:
          (agentBody.error && agentBody.error.message) ||
          agentBody.message ||
          "Cursor did not start the agent. Check the API key and that the GitHub app can see this org.",
        repoUrl: repoUrl,
      },
      502
    );
  }

  await saveBuild(env, id, repoUrl, agentId, cursorUrl);
  return json({ ok: true, repoUrl: repoUrl, cursorUrl: cursorUrl, agentId: agentId });
}

function packageTier(row) {
  const raw = String(row.package || row.brief_text || "Entry");
  if (/advance|custom platform/i.test(raw)) return "Advance";
  if (/intermediate|booking/i.test(raw)) return "Intermediate";
  return "Entry";
}

function buildSitePrompt(row, type, action, repoUrl) {
  const pkg = packageTier(row);
  const name = String(row.business_name || "this business").trim();
  return [
    "You are building a production website for VibeIt-Intel, a South African studio that ships SME sites.",
    "The client brief, logos, and photos are already in this repo. Do not ask anyone to paste or drag files.",
    "",
    "Business: " + name,
    "Kind of business: " + type,
    "Primary customer action: " + action,
    "Package: " + pkg,
    "Repo: " + repoUrl,
    "",
    formatPlaybook(type),
    "",
    "Hard rules:",
    "- This repo already has the VibeIt starter (index.html, styles.css) plus BRIEF.md, FORMAT.md, and assets/. Customize that starter. Do not throw the layout away and start from a blank page.",
    "- Follow FORMAT.md. A hairdresser, a maintenance trade, and a food seller must not share the same page structure.",
    "- The main button and contact path must drive this action: " + action + ".",
    "- Use the client's brand colours in styles.css (:root --c1 --c2 --c3). Do not replace them with VibeIt teal/orange.",
    "- Use files in assets/ for the logo and gallery. Do not invent a different logo.",
    "- If assets/ has a Word, Excel, PDF, CSV, or photo price list, use it for services and prices. Do not ignore it.",
    "- Services and products are different. Treatments, repairs, and bookings go under Services. Items they sell (food, nail products, parts, merch) go under Shop. Hide Shop if they do not sell items.",
    "- South African English. Mobile-first. WhatsApp-friendly where a number exists.",
    "- Entry is a marketing site only: hide bookings. Intermediate keeps and fills the bookings section.",
    "- Only show a pay link or bank details if they appear in the brief. Do not invent PayFast, iKhoka, SnapScan, or a checkout. If they pay cash or with a card machine, say that. If payment details are missing, tell customers to WhatsApp or call.",
    "- Never show VibeIt fees, package names, or rand amounts like R1,105 on the client's website. That is what they paid us, not a price for their customers. If the brief lists service prices, those may appear; our studio price must not.",
    "- If the brief copy is placeholder junk (dddd, test, asdf), do not invent a fake brand story. Use honest generic copy for that trade and leave a short TODO comment.",
    "- Open a PR when the first draft is ready.",
    "",
    "CLIENT BRIEF:",
    String(row.brief_text || "").trim(),
  ].join("\n");
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

async function createGithubRepo(env, name, description) {
  const org = String(env.GITHUB_ORG || "").trim();
  const endpoints = [];
  if (org) endpoints.push("https://api.github.com/orgs/" + encodeURIComponent(org) + "/repos");
  endpoints.push("https://api.github.com/user/repos");
  let lastError = "GitHub could not create the repo";
  const names = [name, name + "-site", name + "-" + new Date().getFullYear()];
  const payload = {
    description: String(description || "").slice(0, 350),
    private: true,
    auto_init: false,
  };
  for (let e = 0; e < endpoints.length; e++) {
    for (let i = 0; i < names.length; i++) {
      const res = await fetch(endpoints[e], {
        method: "POST",
        headers: githubHeaders(env),
        body: JSON.stringify(Object.assign({ name: names[i] }, payload)),
      });
      const body = await res.json().catch(function () {
        return {};
      });
      if (res.ok) return body.html_url || body.clone_url;
      lastError = body.message || lastError;
      if (res.status === 404 || res.status === 403) break;
      if (res.status !== 422) break;
    }
  }
  throw new Error(lastError);
}

async function seedClientRepo(env, repoUrl, row, type, action) {
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

  const textFiles = {
    "index.html": fillTokens(STARTER_FILES["index.html"], values),
    "styles.css": fillTokens(STARTER_FILES["styles.css"], values),
    "README.md": fillTokens(STARTER_FILES["README.md"], values),
    "FORMAT.md": formatMarkdown(type),
    "BRIEF.md": [
      "# " + name,
      "",
      "Type: " + type,
      "Site format: " + type,
      "Customer action: " + action,
      "Package: " + String(row.package || ""),
      "",
      briefText,
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
  const res = await fetch(
    "https://api.github.com/repos/" + owner + "/" + repo + "/contents/" + path,
    {
      method: "PUT",
      headers: githubHeaders(env),
      body: JSON.stringify({
        message: message,
        content: content,
      }),
    }
  );
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
  };
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

  const mailed = await tryResend(env, toEmail, quoteSubject(kind, invoice.number, doc.businessName), quoteHtml(doc), quoteText(doc));
  const sentVia = mailed.sent ? "email" : "gmail";
  const sentAt = new Date().toISOString();
  await env.DB.prepare("UPDATE invoices SET sent_at = ?, sent_via = ? WHERE id = ?")
    .bind(sentAt, sentVia, invoice.id)
    .run();

  return json({
    ok: true,
    sent: mailed.sent,
    sentVia: sentVia,
    mailError: mailed.error || "",
    mailto: quoteMailto(doc),
    printUrl: "/api/briefs/" + id + "/quote/" + invoice.id,
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

async function getQuotePage(request, env, briefId, quoteId) {
  const email = await currentUser(request, env);
  if (!email) return json({ error: "Login required" }, 401);
  await ensureInvoicesTable(env);
  const row = await env.DB.prepare("SELECT * FROM briefs WHERE id = ?").bind(briefId).first();
  const invoice = await env.DB.prepare("SELECT * FROM invoices WHERE id = ? AND brief_id = ?")
    .bind(quoteId, briefId)
    .first();
  if (!row || !invoice) return json({ error: "Not found" }, 404);
  const doc = quoteDoc(row, invoice, bankFromEnv(env), invoice.to_email || row.email || "");
  return new Response(quoteHtml(doc, { printable: true }), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}

async function tryResend(env, to, subject, html, text) {
  if (!env.RESEND_API_KEY) return { sent: false };
  const from = String(env.RESEND_FROM || "VibeIt-Intel <support@vibeit-intel.net>").trim();
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + env.RESEND_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: from,
        to: [to],
        bcc: ["support@vibeit-intel.net"],
        subject: subject,
        html: html,
        text: text,
      }),
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

async function saveBuild(env, id, repo, agentId, cursorUrl) {
  try {
    await env.DB.prepare(
      "UPDATE briefs SET github_repo = ?, cursor_agent_id = ?, cursor_url = ?, status = CASE WHEN status = 'new' THEN 'in_progress' ELSE status END WHERE id = ?"
    )
      .bind(repo || "", agentId || "", cursorUrl || "", id)
      .run();
  } catch (err) {}
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
