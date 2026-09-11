# Specialist profile — field reference

Every field the profile page renders, where it lives, and what it drives.
This is the checklist the specialist submission form needs to cover: fill
these and the profile is complete; leave one empty and the page drops that
element rather than showing a placeholder.

Model: `backend/src/models/Specialist.js` · Serializer:
`backend/src/controllers/specialists.controller.js` · Page:
`frontend/src/pages/SpecialistProfile.tsx`

## Identity and credentials

| Field | Type | Drives | If empty |
|---|---|---|---|
| `fullName` | string, required | Hero heading, About heading, enquiry form, page title | — (required) |
| `slug` | string, required, unique | Profile URL `/specialists/<slug>` | — (required) |
| `title` | string | Line under the name ("Consultant Orthopaedic Surgeon") | Line omitted |
| `photoUrl` | string | Hero portrait in the glass frame, search result card, featured card | Initials tile |
| `bio` | string | About section (clamped to 4 lines with a Read more toggle) | "No biography published yet." |
| `yearsExperience` | number | "N years experience" under the title, and the first key stat | Both omitted |
| `languages` | string[] | "Speaks …" under Areas of Expertise | Line omitted |

Bios shorter than ~4 lines show no Read more control — the toggle appears
only when there is something to collapse.

## Verification

| Field | Type | Drives | If empty |
|---|---|---|---|
| `verificationStatus` | `unverified` \| `pending` \| `verified` | TLS Verified badge in the hero, "100% verified" key stat, the "TLS verified only" search filter | Badge hidden; stat reads "Pending" |
| `regulator` | ref → Regulator | Register line at the foot of Locations | Line omitted |
| `registrationNumber` | string | Same line (e.g. "GMC 7023456") | Line omitted |
| `claimed` | boolean | Whether the profile has been claimed by its owner | — |

`verified` should only be set once the registration number has actually
been checked against the regulator's register — it is the core claim the
whole directory rests on.

## Contact (registration only — never published)

| Field | Type | Drives | If empty |
|---|---|---|---|
| `contactEmail` | string | Where patient enquiries are emailed. Captured on the registration form | The enquiry is still recorded as a lead, but nobody is notified |
| `contactPhone` | string | Reserved for future notification routing | — |

These are **excluded from the public profile API** on purpose — they are
the specialist's own inbox, not a directory listing. The enquiry dialog
posts to `/api/leads`; the server looks up the specialist, builds the
message and sends it with reply-to set to the patient, so the specialist
can simply hit reply. `backend/src/lib/mailer.js` is the only place mail
goes out: register a provider there once (SMTP, SendGrid, Postmark, Resend
and SES all fit the same one-function shape) and every enquiry starts
sending for real. Until then each message is logged, so the flow is
verifiable end to end without a mail account. A delivery failure never
loses the enquiry — the lead is saved first and email is a notification on
top of it.

## Practice details

| Field | Type | Drives | If empty |
|---|---|---|---|
| `primarySpecialty` | ref → Specialty (narrowest tier) | Hero chips, expertise pills, search matching, and which specialty photo the hero uses | No chips; hero falls back to the generic photo |
| `specialties` | ref[] → Specialty | Hero chips, expertise pills, search matching | As above |
| `conditions` | ref[] → Condition | Expertise pills | Fewer pills |
| `treatments` | ref[] → Treatment | Treatments list, expertise pills, result-card tags | "hasn't listed individual treatments yet" |
| `consultationPriceMinor` | integer, **minor units** (pence) | "Consultation from £X", result card, price-range filter | Price omitted; profile drops out while a price filter is active |
| `currency` | ISO code, default `GBP` | Formats the price | — |
| `nextAvailableAt` | Date | "Next available" on the profile and result card; availability filter and sort | Line omitted |

Money is always stored as integer minor units plus a currency code, never
a float. £160 is `16000`.

## Locations

From `clinicLocations` (ref[] → ClinicLocation). Each contributes:

| Field | Drives |
|---|---|
| `clinic.name` / `clinic.slug` | Location card heading, link to the clinic page |
| `address`, `postcode` | Address block, and the "· Harley Street" line on the result card |
| `city.name`, `city.region` | Hero location line, search result card, location filter |
| `city.lat` / `city.lng` | Radius search and the distance shown on results |
| `phone` | Tappable phone link on the location card |

The first location is the one shown in the hero. Coordinates come from the
city record, so a specialist is searchable by radius the moment their
clinic is attached to a city.

## Intro video

| Field | Type | Drives |
|---|---|---|
| `videoUrl` | string | The video card; without it the card is not rendered at all |
| `videoThumbnailUrl` | string | Still shown before playback |
| `videoDurationSeconds` | number | "Watch video (0:08)" label |

These three travel together. The card is a thumbnail until clicked, then a
real player.

## Ratings and reviews

`ratingAvg` and `ratingCount` are stored on the specialist as a cache, and
are **derived from review rows** — never edited by hand in production.
`backend/src/lib/ratings.js` owns the calculation and every write path
calls it, so the cache cannot drift from the reviews behind it.

| Field | Drives |
|---|---|
| `ratingAvg` | Hero rating, key stat, big number in Patient Reviews, rating filter and sort |
| `ratingCount` | "(N reviews)" everywhere |
| `reviews[]` | Testimonial carousel and the full paginated list |
| `reviews[].rating` | Stars on each review; feeds `ratingAvg` |
| `reviews[].comment` | Quote text (reviews without a comment still count toward the rating) |
| `reviews[].patientName` | Attribution — falls back to "Verified patient" |
| `reviews[].verified` | "Verified visit" marker. Set only from a real booking/invite record, never from user input |
| `reviews[].scores.communication` / `.expertise` / `.care` / `.waitTime` | The rating breakdown bars. Each is optional; a category nobody scored is left out rather than shown as zero |
| `reviewScores` | Computed by the API from the above — not stored |

### Endpoints

- `GET /api/specialists/:slug` — full profile
- `GET /api/specialists/:slug/reviews?page=1&pageSize=10` — paginated reviews ("View all reviews")
- `POST /api/specialists/:slug/reviews` — create a review; recomputes
  `ratingAvg` / `ratingCount` in the same request
- `POST /api/leads` — the enquiry form

## Demo data caveat

The current dataset is placeholder content. Names, bios, photos, the intro
video and the reviews are stand-ins, and the seeded `ratingAvg` /
`ratingCount` on demo profiles represent review history that doesn't exist
yet. The moment a real review is written through the endpoint above, that
profile's aggregate becomes fully derived. Nothing else changes when real
profiles arrive: they populate the same fields and render through the same
components.
