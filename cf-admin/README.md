# VibeIt request admin (Cloudflare)

Private board at `admin.vibeit-intel.net`. New briefs still email `support@vibeit-intel.net`.

## 1. One-time Cloudflare setup

From this folder:

```bash
cd cf-admin
npm install
npx wrangler login
npx wrangler d1 create vibeit-briefs
npx wrangler r2 bucket create vibeit-brief-files
```

Paste the D1 `database_id` into `wrangler.toml`. Then:

```bash
npx wrangler d1 execute vibeit-briefs --remote --file=schema.sql
npx wrangler secret put SESSION_SECRET
npx wrangler secret put ADMIN_PASSWORD
```

Use a long random `SESSION_SECRET`. `ADMIN_PASSWORD` is the door for `support@vibeit-intel.net` until Google login is added.

```bash
npx wrangler deploy
```

That gives you a `*.workers.dev` URL. Open it, sign in, confirm the empty board loads.

## 2. Point admin.vibeit-intel.net

Add `vibeit-intel.net` to Cloudflare (free). Keep GitHub Pages for the public site. Then in Workers → vibeit-admin → Settings → Domains, add `admin.vibeit-intel.net`.

Uncomment the `[[routes]]` block in `wrangler.toml` if you prefer a route, then deploy again.

## 3. Optional Google sign-in

Google Cloud → APIs → OAuth client (Web):

- Authorized origin: `https://admin.vibeit-intel.net`
- Redirect: `https://admin.vibeit-intel.net/auth/callback`

```bash
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
```

Allowed inboxes are `ALLOWED_EMAILS` in `wrangler.toml`.

## 4. Local

```bash
copy .dev.vars.example .dev.vars
npx wrangler d1 execute vibeit-briefs --local --file=schema.sql
npx wrangler dev
```

Open http://127.0.0.1:8787

## 5. Start website (Cursor)

The request page creates a GitHub repo and launches a Cursor cloud agent with the brief and logos already attached.

Create a Cursor API key. Create a GitHub token that can make repos in `VIbeIt-Intel`, and install the Cursor GitHub app on that org (all repositories).

```bash
npx wrangler secret put CURSOR_API_KEY
npx wrangler secret put GITHUB_TOKEN
```
