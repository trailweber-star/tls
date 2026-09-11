# Top Local Specialists — MERN build

MongoDB, Express, React (Vite), Node — same architecture and data model as
the published build plan, on a MERN stack instead of Next.js/Supabase.
Runs in **demo mode** out of the box (no MongoDB required) using an
in-memory dataset that mirrors `backend/src/data/seed.js`.

## Structure

```
tls-mern/
  backend/   Express API (Mongoose models, REST routes, seed script)
  frontend/  React app (Vite + TypeScript + Tailwind v4 + React Router)
```

## Getting started

Two terminals:

```bash
# Terminal 1 — API
cd backend
npm install
npm run dev            # http://localhost:4000, demo mode (no MONGODB_URI needed)

# Terminal 2 — web app
cd frontend
npm install
npm run dev             # http://localhost:5173
```

Open http://localhost:5173 — the site works immediately in demo mode, no
database required.

> **Updating an existing checkout?** This version adds new frontend
> dependencies (`lucide-react`) and new backend files. Re-run `npm install`
> in both `backend/` and `frontend/` after pulling these changes, and if
> you were running the dev servers, stop and restart them.

## Connecting a real MongoDB database

1. Create a database (MongoDB Atlas, or a self-hosted instance).
2. Copy `backend/.env.example` to `backend/.env` and set `MONGODB_URI`.
3. Seed it with the same starter data used in demo mode:
   ```bash
   cd backend
   npm run seed
   ```
4. Restart `npm run dev` in `backend/`. `src/config/db.js` detects
   `MONGODB_URI` and every controller in `src/controllers/*` switches from
   the in-memory dataset to real Mongoose queries automatically — no
   frontend changes needed.

The frontend always talks to the API over HTTP (`VITE_API_URL`, see
`frontend/.env.example`); it has no separate mock data of its own, so
there's only one place the demo-vs-live split happens.

## Taxonomy

The full specialty and facility-category taxonomy lives as data, not code,
in `backend/src/data/taxonomy/*.json` (parsed once into a flat
parent/slug/name list by `backend/src/data/taxonomy/build.js`). To change
or extend it, edit those JSON trees and re-run `npm run seed` against a
real database — nothing else needs to change.

- **Specialties** (tag *people* — Specialist records): Orthopaedics,
  Physiotherapy, Dentistry, Aesthetics Specialists, ENT, Gynaecology. Each
  is a 3-level tree (e.g. Orthopaedics → Knee → Total Knee Replacement).
  A specialist is tagged only at the narrowest level; searching a broader
  level (e.g. just "Orthopaedics", or "Knee") automatically expands to
  match everyone tagged anywhere underneath it.
- **Facility categories** (tag *places* — Facility records): Hospital
  Care, Care Homes, Pharmacy, Clinics, Hospitals — same 3-level shape,
  same branch-expansion search behaviour, entirely separate from the
  clinical specialty taxonomy above (a hospital isn't a "specialty").

## API

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/specialties` | flat tree: top-level + sub + narrow sub-specialty |
| GET | `/api/specialties/top-level` | top-level only |
| GET | `/api/specialties/:slug/subspecialties` | children of one top-level specialty |
| GET | `/api/cities` | |
| GET | `/api/facility-categories` | flat tree: Hospital Care, Care Homes, Pharmacy, Clinics, Hospitals |
| GET | `/api/facility-categories/top-level` | top-level only |
| GET | `/api/facility-categories/:slug/children` | children of one top-level category |
| GET | `/api/specialists/featured?limit=4` | highest-rated verified specialists |
| GET | `/api/specialists/search?specialty=&subspecialty=&location=` | |
| GET | `/api/specialists/:slug` | |
| GET | `/api/clinics/:slug` | |
| GET | `/api/facilities/featured?limit=4` | highest-rated verified facilities |
| GET | `/api/facilities/search?type=&category=&location=` | `type`: hospital \| clinic \| care_home \| pharmacy |
| GET | `/api/facilities/:slug` | |
| POST | `/api/leads` | public enquiry endpoint (write-only, mirrors the original public-insert RLS policy); accepts `specialistId`, `clinicId` or `facilityId` |

## What's implemented so far

- Redesigned homepage: dark hero with headline, pill-shaped chained
  search bar, trust-stat row, specialty tiles, "how it works" + patient
  testimonial, featured specialists, a hospitals/clinics/care-homes
  section, a professionals CTA banner and a closing CTA — all on a new
  teal/navy design system (`frontend/src/index.css`), light + dark mode.
- `/search`: filters by specialty → sub-specialty → location (a top-level
  or mid-level specialty search correctly matches every specialist
  tagged anywhere underneath it, not just an exact slug match)
- `/facilities`: browse hospitals, clinics, care homes and pharmacies by
  type, category and location
- Specialist profile: bio, verification badge, clinic location, reviews,
  consultation price, working enquiry form
- Facility profile: type, categories, location, working enquiry form
- Clinic profile: location + roster of specialists
- Full specialty + facility-category taxonomy (see **Taxonomy** above) —
  479 specialty nodes, 172 facility-category nodes, seeded from the
  client's complete category list rather than a small demo subset

## Imagery

The redesign uses placeholder gradient tiles with icons in place of real
photography, so nothing here embeds stock photos whose licence isn't
known. Before launch, swap the gradient tiles (`CategoryGrid`, the
facility tiles on the homepage and `/facilities`) for licensed photos of
real specialists, clinics and facilities.

## Not yet built

Auth/claiming flows, specialist & clinic self-service dashboards, admin
platform, video/article content, booking, subscriptions, and everything in
the build plan's Phase 2/3 (peer endorsements, AI features, multi-country,
Clinwell integration).
