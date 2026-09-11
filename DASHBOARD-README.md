# Specialist & Admin Dashboard — what's in this update

Unpack over your existing `tls-mern` folder, then restart both servers.

```bash
cd ~/Downloads
tar -xzf tls-mern-dashboard.tar.gz
```

Then, in **two separate Terminal tabs** (each tab runs one server and stays busy):

```bash
# tab 1
cd ~/Downloads/tls-mern/backend && npm run dev

# tab 2
cd ~/Downloads/tls-mern/frontend && npm run dev
```

## Signing in

The site now has a **"For specialists"** link in the header. Two demo
accounts are seeded, and the sign-in page lists them — click one to fill
the form:

| Account | Password | Lands on |
| --- | --- | --- |
| `admin@tls.test` | `demo1234` | `/admin` — the admin workspace |
| `j.whitfield@example.com` | `demo1234` | `/dashboard` — a specialist workspace |

You can also apply as a new specialist at `/register` and watch the
application appear in the admin queue.

## The manual review gate

This is enforced in the backend, not just in the interface:

- Registration creates a specialist profile with `verificationStatus: "pending"`
  and an entry in the admin queue. **It never creates a live listing.**
- Every public endpoint filters on `verificationStatus === "verified"`.
  An unapproved profile 404s (rather than 403s — a 403 would confirm the
  person applied) and is absent from search and from featured listings.
- The **only** thing that makes a profile public is an admin pressing
  Approve in the verification centre. Each decision writes an append-only
  audit entry naming who took it, and emails the specialist the outcome.
- Approve / Request information / Not approve / Suspend / Reinstate are all
  available, each with the note that gets sent to the applicant.

## What's real, and what isn't yet

Everything on these screens is read from the API and recomputed on write:

- **Profile completion** is a weighted score over the fields the public
  profile actually renders. Clear a field and the percentage drops; the
  missing-item links jump to the right section of the form.
- **Enquiries** — replying records the response, moves the enquiry along
  its workflow, updates the folder counts and attempts the email. The
  banner tells you honestly whether it was delivered or only saved
  (no mail account is configured yet, so today it's the latter).
- **Reviews** — the average, the count, the star breakdown and the
  per-category scores are all derived from the review records.
- **Profile views** are counted for real on each profile load; the KPI and
  its sparkline come from that store.
- **Treatments and locations** are editable from the dashboard and write
  through to the public profile and to city search.

Three sections are deliberately empty rather than faked, and say so on
screen: **Appointments** and the booking calendar (no appointment model
yet), **Analytics**, **Messages**, **Settings** and **Premium**. Each lists
what it needs before it can be switched on.

## New API surface

```
POST   /api/auth/register            create account + pending application
POST   /api/auth/login
GET    /api/auth/me

GET    /api/dashboard/overview       KPIs, completion, verification, enquiries
GET    /api/dashboard/profile
PATCH  /api/dashboard/profile        cannot write verificationStatus or ratings
GET    /api/dashboard/enquiries
POST   /api/dashboard/enquiries/:id/respond
GET    /api/dashboard/reviews

GET    /api/admin/overview
GET    /api/admin/verifications
GET    /api/admin/verifications/:id
POST   /api/admin/verifications/:id/decide
GET    /api/admin/specialists
```

Dashboard routes read the profile id from the session, never from the URL,
so an account can only ever touch its own data. Admin routes are behind a
role check — a specialist token gets 403, no token gets 401.

## Before going live

Set `AUTH_SECRET` in `backend/.env` to a long random string. Without it the
server warns loudly and uses a development key, which is fine locally and
not fine anywhere else.
