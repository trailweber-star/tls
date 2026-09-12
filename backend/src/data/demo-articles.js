/* ------------------------------------------------------------------ *
 * Demo articles
 *
 * Three posts so the blog is a real page from the first load rather
 * than an empty state nobody can judge. They are written the way the
 * Abun imports will arrive — markdown, a title, a hero image, a
 * specialty — and go through exactly the same sanitiser and slug rules,
 * so what the design is tested against is what the live content will be.
 *
 * Deliberately generic patient-education copy, and deliberately no
 * clinical claims beyond what any NHS leaflet says: this is seed data on
 * a healthcare site, and it will be read by somebody eventually.
 * ------------------------------------------------------------------ */

export const demoArticles = [
  {
    title: "What to expect in the first six weeks after a knee replacement",
    specialtySlug: "orthopaedics",
    tags: ["Recovery", "Orthopaedics"],
    authorName: "Top Local Specialists",
    heroImageUrl: "/images/specialist-orthopaedic.jpg",
    heroImageAlt: "A physiotherapist supporting a patient through a knee exercise",
    excerpt:
      "Most of the recovery that matters happens in the first six weeks. Here is what a typical week-by-week looks like, and when to call your surgeon rather than wait.",
    publishedDaysAgo: 3,
    body: `Recovery from a knee replacement is more predictable than most people expect, and the timetable below is roughly what surgeons describe to their own patients. It is not a substitute for the plan your surgeon gives you — if the two disagree, follow theirs.

## Week one: moving sooner than feels reasonable

You will usually be asked to stand within a day of surgery, often the same day. This feels premature and is not: early movement is what keeps the joint from stiffening and reduces the risk of a clot.

Expect swelling, expect to need painkillers on a schedule rather than when the pain arrives, and expect to sleep badly. All three are normal in the first week.

## Weeks two and three: bending is the job

The single number your physiotherapist cares about is how far the knee bends. Most people are aiming for around 90 degrees by the end of week three — enough to sit down and stand up without using your arms.

Progress here is not comfortable and is not supposed to be. What matters is whether the range is improving week on week, not how it feels on any one day.

## Weeks four to six: getting your life back

By six weeks a lot of people are walking without a stick indoors, driving again if their surgeon agrees, and back to a desk job. Kneeling stays difficult for much longer, sometimes permanently, and that surprises people more than anything else on this list.

## When to stop reading and phone somebody

Call your surgical team the same day if you have:

- A calf that is hot, hard or swollen, particularly on one side
- A temperature, or a wound that is leaking, opening or increasingly red
- Pain that is suddenly much worse rather than gradually better
- Chest pain or breathlessness — this is an emergency, call 999

None of these are common. All of them are worth interrupting somebody's afternoon for.

## Finding someone to ask

If you are still deciding on a surgeon, or want a second opinion before committing to surgery, you can compare orthopaedic specialists by location, sub-specialty and consultation price on this site.`,
  },

  {
    title: "Physiotherapy or surgery? How the decision is actually made",
    specialtySlug: "physiotherapy",
    tags: ["Physiotherapy", "Choosing care"],
    authorName: "Top Local Specialists",
    heroImageUrl: "/images/specialist-physio.png",
    heroImageAlt: "A physiotherapist assessing a patient's shoulder movement",
    excerpt:
      "For most joint and back problems, conservative treatment is tried first — not to delay surgery, but because a large share of people never need it.",
    publishedDaysAgo: 9,
    body: `Patients often arrive at a first appointment assuming the choice is theirs: physiotherapy if they are patient, surgery if they are not. That is rarely how a clinician frames it.

## The default is the least invasive thing that could work

For most shoulder, knee and back problems, a structured course of physiotherapy is tried first. Not as a delaying tactic — a substantial proportion of people improve enough that surgery stops being on the table at all.

"Structured" is doing a lot of work in that sentence. Two sessions and a printout is not a course of physiotherapy. Six to twelve weeks of progressive loading, done at home between appointments, is.

## What moves a case towards surgery

The picture usually changes when one of these is true:

- The problem is mechanical and will not remodel — a locked knee, a full-thickness tear, a nerve under demonstrable compression
- A proper course of conservative treatment has been completed without meaningful change
- Function is deteriorating rather than plateauing
- The imaging and the symptoms agree with each other

That last one matters more than patients realise. A scan showing wear that everybody your age has, with pain that does not match its location, is not a reason to operate.

## Questions worth asking at the consultation

- What would you expect to change if I did nothing for three months?
- What does a good outcome look like, in what I can do rather than in degrees of movement?
- How many of these do you do in a year?
- What happens if this does not work?

A specialist who welcomes the third and fourth questions is usually the one to go with.

## Getting a second opinion

There is nothing awkward about seeking one, and most consultants expect it for elective surgery. You can search verified physiotherapists and orthopaedic specialists here by area and sub-specialty.`,
  },

  {
    title: "How to check a private clinician is who they say they are",
    specialtySlug: null,
    tags: ["Choosing care", "Verification"],
    authorName: "Top Local Specialists",
    heroImageUrl: "/images/specialist-orthopaedic.jpg",
    heroImageAlt: "A clinician's registration certificate on a consulting room wall",
    excerpt:
      "Every UK clinician appears on a public register you can search for free in under a minute. Here is which register, and what to look for once you are there.",
    publishedDaysAgo: 18,
    body: `Anyone can put "specialist" on a website. Registration is the part that is checked, it is public, and it takes about a minute to look up.

## Find the right register

- **Doctors** — the General Medical Council register. Look for the doctor's name, their GMC number, and whether they are on the Specialist Register for the specialty they are treating you in.
- **Dentists** — the General Dental Council register.
- **Physiotherapists** — the Health and Care Professions Council register.
- **Nurses** — the Nursing and Midwifery Council register.

All four are free, searchable by name, and do not require an account.

## What you are looking for

A current registration with no conditions or warnings attached, in the name the clinician is practising under. For a doctor doing specialist work, the Specialist Register entry is the one that matters — being on the GMC register at all only means they are a doctor.

If a clinician's entry shows restrictions, that is not automatically disqualifying, but it is a reasonable thing to ask about directly.

## Two things a register will not tell you

**How good they are.** Registration is a floor, not a ranking. Volume of a specific procedure, and outcomes where they are published, tell you more.

**Whether they are insured.** Every practising private clinician should hold indemnity cover. It is a fair question to ask and an easy one for them to answer.

## What we check here

Every specialist listed on this site is checked against the relevant public register before they are marked as verified, and the badge is removed automatically if their registration lapses. Listings that were imported but not yet claimed are labelled as unclaimed, so you always know which is which.`,
  },
];
