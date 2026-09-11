# Putting this on a link you can send

Two audiences for this file: you, now, getting a preview URL in front of
a client; and whoever deploys it for real later. Both use the same build.

The shape is one service. The API process also serves the built site, so
there is a single URL, a single certificate, no CORS, and nothing to
configure per environment. `SITE_PASSWORD` puts a password page in front
of the whole thing, so a link can be sent to one client and to nobody
else.

---

## The quickest route: Render (about ten minutes)

Free tier, managed Postgres, and the repository already carries the
blueprint (`render.yaml`) that describes both.

**1. Get the code onto GitHub.** Any private repository will do.

```bash
cd ~/Downloads/tls-mern
git init                      # skip if it is already a repo
git add -A
git commit -m "Top Local Specialists"
git branch -M main
git remote add origin git@github.com:YOURNAME/tls.git
git push -u origin main
```

`.gitignore` already excludes `node_modules`, builds, uploads and
`.env` — check with `git status` before the first push that no `.env`
is listed. **Nothing in this repository should ever contain a real
secret.**

**2. In Render: New → Blueprint**, point it at the repository, apply.
It reads `render.yaml` and creates a web service plus a Postgres
database, wired together.

**3. Set the four values it asks for**, in the service's Environment tab:

| Variable | What to put |
|---|---|
| `SITE_PASSWORD` | the password you will send the client with the link |
| `SEED_ADMIN_EMAIL` | your own email — this becomes the admin login |
| `SEED_ADMIN_PASSWORD` | a password you choose (12+ characters) |
| `SITE_USER` | already `client`; only used for command-line access |

Everything else the blueprint fills in: `DATABASE_URL` from the database,
`AUTH_SECRET` generated once, `STAGING=1`, `SEED_ON_BOOT=1`,
`MAIL_PROVIDER=console`.

**4. Wait for the first deploy.** The build runs `npm run build` (installs
both halves, builds the site) and the start command runs migrations, seeds
the demo directory into the empty database, and boots. Watch the log for:

```
[prepare] schema is up to date
[seed] created admin account you@yourdomain.com
[server] listening on http://localhost:10000
```

**5. Open the URL Render gives you** (`https://tls-preview.onrender.com`).
You get the password page; enter `SITE_PASSWORD` and the site is there.

**6. Send the client two lines:**

> The preview is at https://tls-preview.onrender.com
> Password: whatever-you-set

One thing to warn them about on the free tier: the service sleeps after
15 minutes idle, so the first load after a quiet period takes 30–50
seconds. The paid tier ($7/month) removes that, and is worth it the day
you send the link to somebody who matters.

---

## The same thing on other hosts

The `Dockerfile` builds one image that serves both halves, so anything
that takes a container works the same way.

**Railway** — New Project → Deploy from GitHub. It detects the
Dockerfile. Add a Postgres from its marketplace; it sets `DATABASE_URL`
itself. Then add `AUTH_SECRET`, `SITE_PASSWORD`, `STAGING=1`,
`SEED_ON_BOOT=1`, `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`.

**Fly.io** — `fly launch` (accept the Dockerfile), `fly postgres create`,
`fly postgres attach`, then `fly secrets set AUTH_SECRET=… SITE_PASSWORD=…
STAGING=1 SEED_ON_BOOT=1`.

**A VPS you already have** — `docker build -t tls . && docker run -d -p
80:4000 --env-file .env.production tls`, with a real Postgres in
`DATABASE_URL`. Put Caddy or nginx in front for HTTPS.

**Vercel and Netlify are the wrong shape for this.** They host the
frontend beautifully and cannot host a long-running Express process with
a filesystem for uploads. Splitting the two across hosts is possible —
build the frontend with `VITE_API_URL=https://api.yourdomain.com/api` and
allow that origin in CORS — but it is more moving parts than a preview
needs.

---

## Every environment variable that matters

Required:

| Variable | Why |
|---|---|
| `DATABASE_URL` | Postgres. Without it the server runs on in-memory demo data and every change is lost on restart. |
| `AUTH_SECRET` | Signs session tokens. Generate with `openssl rand -base64 48`. Changing it signs everybody out. |

For a preview specifically:

| Variable | Why |
|---|---|
| `SITE_PASSWORD` | The password page. Also switches on `noindex` and a `robots.txt` that disallows everything. |
| `SITE_USER` | Username for command-line/basic access. Default `client`. |
| `STAGING=1` | `noindex` without a password, if you want an open preview. |
| `SEED_ON_BOOT=1` | Seeds the demo directory **only when the database is completely empty**. Safe to leave on. |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | The admin login the seed creates. Without them it falls back to `admin@tls.test` / `demo1234`, which must not be left on anything public. |
| `SITE_URL`, `PUBLIC_API_URL` | The site's own address. Used in email links and uploaded-photo URLs. Set both to the deployed URL. |

Everything else — email providers, Stripe, Google Maps, push — is
documented in `backend/.env.example`. On a preview leave
`MAIL_PROVIDER=console` so nothing can be emailed to a real clinician by
accident.

---

## Before you send the link

```bash
cd backend  && npm run smoke          # 584 API checks
cd ../frontend && npm run build       # the build the server will serve
```

And against the deployed URL itself:

```bash
cd frontend
node scripts/preview.mjs https://your-preview-url.onrender.com client:your-password
```

That last one is the one that matters. It checks the things that are only
ever wrong on a deployed copy: that the password page actually gates the
site *and* the API, that every API call goes to the deployed origin
rather than to `localhost:4000` baked in at build time, that a deep route
like `/admin/members` survives a refresh, that an admin can sign in, and
that no image or bundle 404s.

---

## What has actually been tested, and what has not

Verified, on this build, in production mode: the API serving the built
site from one origin; the password gate over both the pages and the API;
migrations and the empty-database seed running on boot; deep routes
surviving a refresh; every API call resolving to the deployed origin;
admin sign-in; no failed requests or console errors. That is the
`node scripts/preview.mjs` run above — 23 checks.

Not yet exercised: Render's own build of it, and the `Dockerfile`. Both
run exactly the two commands that were tested (`npm run build`, then
`npm start`), and neither can be proved without the host. If the first
deploy fails it will be in the build log, and it will be one of:
a Node version older than 20, a missing `DATABASE_URL`, or a free-tier
build timeout on the frontend install.

---

## What to tell the client

Worth saying explicitly, because a preview always invites the wrong
question:

- **It is a build in progress**, on free hosting. Slow first loads are
  the host waking up, not the site.
- **The directory is demo data.** Names, ratings and reviews are seeded
  examples, not real clinicians — with the exception of any listings
  imported from a real source, which are marked unclaimed.
- **No email leaves the system** and **no payment is real**: checkout
  completes without charging anything, which is deliberate.
- **Nothing is indexed by Google**, so nothing here can be found by a
  patient or a competitor.

---

## Going properly live, later

The same build, with four things changed:

1. A paid database with backups, and a paid service so it does not sleep.
2. `SITE_PASSWORD` removed, `STAGING` removed — and only then does the
   site become indexable.
3. A mail provider configured and proved with `npm run mail:test`, plus
   SPF and DKIM on the sending domain.
4. `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`, with the webhook
   endpoint pointed at `https://yourdomain.com/api/billing/webhook`.

Two things to fix before real members upload anything: uploads currently
go to the container's local disk, which most hosts wipe on every deploy
(point `setStorageProvider()` at S3 or R2 — the seam is in
`backend/src/lib/storage.js`), and the seeded `admin@tls.test` account
should not exist at all.
