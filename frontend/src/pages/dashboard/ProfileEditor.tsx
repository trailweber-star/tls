import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Building2,
  CalendarClock,
  Check,
  Eye,
  Images,
  Link as LinkIcon,
  Loader2,
  Lock,
  MapPin,
  Phone,
  Plus,
  Save,
  Scale,
  Stethoscope,
  Trash2,
  TriangleAlert,
  UserRound,
  Video,
  Wallet,
  X,
} from "lucide-react";
import { DashboardShell, Panel } from "../../components/DashboardShell";
import { ImageUploadField } from "../../components/ImageUploadField";
import { AddressField } from "../../components/AddressField";
import { VideoUploadField } from "../../components/VideoUploadField";
import { MapPreview } from "../../components/MapPreview";
import { SOCIAL_BRANDS, SocialGlyph, normaliseSocial } from "../../lib/socialBrands";
import { UK_REGIONS } from "../../lib/ukRegions";
import { ErrorBlock, LoadingBlock, ProgressBar } from "../../components/dashboard/ui";
import { dashboardApi } from "../../lib/dashboardApi";
import type { DashboardProfile, Overview, ProfilePatch } from "../../lib/dashboardApi";
import { getCities, getAllSpecialties } from "../../lib/api";
import type { City, Specialty } from "../../lib/types";
import { useAuth } from "../../lib/auth";

/* ------------------------------------------------------------------ *
 * The profile form
 *
 * Every field here is one the public profile page actually renders, and
 * each maps to a completion item — which is why saving moves the
 * percentage the dashboard shows. Sections carry ids so "Add a clinic
 * location" on the overview can link straight to the right one.
 * ------------------------------------------------------------------ */

const input =
  "w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-[13.5px] text-ink outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20";

type LocationDraft = {
  address: string;
  cityId: string;
  postcode: string;
  phone: string;
  /** Set when the address was picked from the geocoded suggestions. */
  lat: number | null;
  lng: number | null;
  /**
   * The clinic this address belongs to, when it is one.
   *
   * A hospital's address is the hospital's record, shared with every
   * other specialist who practises there — so it is shown here and not
   * edited here, and it is never sent back in the save. It used to be
   * indistinguishable from an address the specialist typed themselves,
   * which meant every save quietly detached them from their clinic and
   * left a profile page with a location whose clinic had vanished. That
   * was the blank profile page.
   */
  clinic: { id: string; name: string; slug: string } | null;
};

type Draft = {
  fullName: string;
  title: string;
  bio: string;
  photoUrl: string;
  contactEmail: string;
  contactPhone: string;
  yearsExperience: string;
  registrationNumber: string;
  languages: string[];
  coveredRegions: string[];
  // The medico-legal CV -- see the Section below, shown only when
  // isExpertWitnessBranch. Kept as plain strings/array here like every
  // other draft field; toPatch is where "" becomes null.
  medicoLegalExperience: string;
  clinicalPracticeExperience: string;
  clinicalInterests: string;
  managementExperience: string;
  researchInterests: string;
  summaryOfPublications: string;
  teachingTraining: string;
  prizesAndAwards: string;
  memberships: string;
  areasOfExpertise: string[];
  primarySpecialtySlug: string;
  /**
   * Expert Witness only -- the two multi-selects below "Primary
   * specialty". caseTypeSlugs is every "type of report" leaf (direct
   * children of expert-witness-medicolegal) this listing is tagged
   * with; clinicalSpecialtySlugs is every clinical-discipline leaf
   * (children of expert-witness-medical-specialty). Both are full sets
   * -- saving replaces whichever of these the specialist actually has,
   * same as every other joined field on this form.
   */
  caseTypeSlugs: string[];
  clinicalSpecialtySlugs: string[];
  treatmentNames: string[];
  locations: LocationDraft[];
  consultationPrice: string;
  currency: string;
  nextAvailableAt: string;
  videoUrl: string;
  videoThumbnailUrl: string;
  videoDurationSeconds: string;
  coverImageUrl: string;
  gallery: { url: string; caption: string }[];
  websiteUrl: string;
  linkedin: string;
  instagram: string;
  x: string;
  facebook: string;
  youtube: string;
  bookingUrl: string;
  publicEmail: string;
  publicPhone: string;
};

/**
 * `allSpecialties` is the full taxonomy, needed only to work out which of
 * `p.specialties` (a flat list of slugs) belong to the two Expert
 * Witness branches -- everything else on the profile is read directly,
 * with no classification required.
 */
function toDraft(p: DashboardProfile, allSpecialties: Specialty[]): Draft {
  const tagged = new Set(p.specialties ?? []);
  const caseTypeSlugSet = new Set(expertWitnessPracticeAreas(allSpecialties).map((s) => s.slug));
  const clinicalSpecialtySlugSet = new Set(expertWitnessMedicalSpecialties(allSpecialties).map((s) => s.slug));
  return {
    fullName: p.fullName ?? "",
    title: p.title ?? "",
    bio: p.bio ?? "",
    photoUrl: p.photoUrl ?? "",
    contactEmail: p.contactEmail ?? "",
    contactPhone: p.contactPhone ?? "",
    yearsExperience: p.yearsExperience == null ? "" : String(p.yearsExperience),
    registrationNumber: p.registrationNumber ?? "",
    languages: p.languages ?? [],
    coveredRegions: p.coveredRegions ?? [],
    medicoLegalExperience: p.medicoLegalExperience ?? "",
    clinicalPracticeExperience: p.clinicalPracticeExperience ?? "",
    clinicalInterests: p.clinicalInterests ?? "",
    managementExperience: p.managementExperience ?? "",
    researchInterests: p.researchInterests ?? "",
    summaryOfPublications: p.summaryOfPublications ?? "",
    teachingTraining: p.teachingTraining ?? "",
    prizesAndAwards: p.prizesAndAwards ?? "",
    memberships: p.memberships ?? "",
    areasOfExpertise: p.areasOfExpertise ?? [],
    primarySpecialtySlug: p.primarySpecialty?.slug ?? "",
    caseTypeSlugs: [...tagged].filter((slug) => caseTypeSlugSet.has(slug)),
    clinicalSpecialtySlugs: [...tagged].filter((slug) => clinicalSpecialtySlugSet.has(slug)),
    treatmentNames: (p.treatments ?? []).map((t) => t.name),
    locations: (p.clinicLocations ?? []).map((l) => ({
      address: l.address ?? "",
      cityId: l.cityId ?? "",
      postcode: l.postcode ?? "",
      phone: l.phone ?? "",
      // Coordinates the address already has, so re-saving a profile does
      // not silently un-pin an address that was pinned before.
      lat: l.lat ?? null,
      lng: l.lng ?? null,
      clinic: l.clinic ?? null,
    })),
    // Money is held in minor units on the server; the form works in
    // pounds so nobody has to type pence.
    consultationPrice: p.consultationPriceMinor == null ? "" : String(p.consultationPriceMinor / 100),
    currency: p.currency ?? "GBP",
    nextAvailableAt: p.nextAvailableAt ? p.nextAvailableAt.slice(0, 10) : "",
    videoUrl: p.videoUrl ?? "",
    videoThumbnailUrl: p.videoThumbnailUrl ?? "",
    videoDurationSeconds: p.videoDurationSeconds == null ? "" : String(p.videoDurationSeconds),
    coverImageUrl: p.coverImageUrl ?? "",
    gallery: (p.gallery ?? []).map((g) => ({ url: g.url, caption: g.caption ?? "" })),
    websiteUrl: p.websiteUrl ?? "",
    linkedin: p.socials?.linkedin ?? "",
    instagram: p.socials?.instagram ?? "",
    x: p.socials?.x ?? "",
    facebook: p.socials?.facebook ?? "",
    youtube: p.socials?.youtube ?? "",
    bookingUrl: p.bookingUrl ?? "",
    publicEmail: p.publicEmail ?? "",
    publicPhone: p.publicPhone ?? "",
  };
}

/**
 * The town to centre a map on when the address itself has no pin.
 *
 * Most addresses are typed rather than picked from the suggestions, so
 * without this almost no location in the editor would show a map at
 * all. The map says "Approximate" when it is standing in like this.
 */
function cityFallback(cities: City[], cityId: string) {
  const city = cities.find((c) => c.id === cityId);
  return city ? { lat: city.lat, lng: city.lng, label: city.name } : null;
}

const nullable = (v: string) => (v.trim() ? v.trim() : null);
const numberOrNull = (v: string) => (v.trim() === "" ? null : Number(v));

/** Add/remove a value from a small multi-select array, used by every
 *  checkbox-grid field below (regions, type of report, medical specialty). */
const toggleValue = (values: string[], value: string) =>
  values.includes(value) ? values.filter((v) => v !== value) : [...values, value];

/** The shared look for one tile in a checkbox grid -- teal when picked,
 *  muted otherwise. One definition so the three grids below can never
 *  drift out of sync with each other. */
function checkboxTileClass(checked: boolean) {
  return `flex items-center gap-2 rounded-lg border px-3 py-2 text-[13.5px] font-medium ${
    checked ? "border-teal-300 bg-teal-50 text-teal-800" : "border-line text-ink-muted"
  }`;
}

function toPatch(d: Draft): ProfilePatch {
  return {
    fullName: d.fullName.trim(),
    title: nullable(d.title),
    bio: nullable(d.bio),
    photoUrl: nullable(d.photoUrl),
    contactEmail: nullable(d.contactEmail),
    contactPhone: nullable(d.contactPhone),
    yearsExperience: numberOrNull(d.yearsExperience),
    registrationNumber: nullable(d.registrationNumber),
    languages: d.languages,
    coveredRegions: d.coveredRegions,
    medicoLegalExperience: nullable(d.medicoLegalExperience),
    clinicalPracticeExperience: nullable(d.clinicalPracticeExperience),
    clinicalInterests: nullable(d.clinicalInterests),
    managementExperience: nullable(d.managementExperience),
    researchInterests: nullable(d.researchInterests),
    summaryOfPublications: nullable(d.summaryOfPublications),
    teachingTraining: nullable(d.teachingTraining),
    prizesAndAwards: nullable(d.prizesAndAwards),
    memberships: nullable(d.memberships),
    areasOfExpertise: d.areasOfExpertise,
    primarySpecialtySlug: d.primarySpecialtySlug || null,
    caseTypeSlugs: d.caseTypeSlugs,
    clinicalSpecialtySlugs: d.clinicalSpecialtySlugs,
    treatmentNames: d.treatmentNames,
    locations: d.locations
      // Clinic addresses are deliberately left out: the server treats
      // this list as the specialist's OWN addresses and keeps the
      // shared ones on their behalf. Sending a clinic address back
      // would recreate it as a personal copy and break the link.
      .filter((l) => !l.clinic)
      .filter((l) => l.address.trim() && l.cityId)
      .map((l) => ({
        address: l.address.trim(),
        cityId: l.cityId,
        postcode: nullable(l.postcode),
        phone: nullable(l.phone),
        // Only sent when the address was actually pinned. Sending stale
        // coordinates for an address someone has since retyped would put
        // the pin somewhere they no longer are.
        lat: l.lat,
        lng: l.lng,
      })),
    consultationPriceMinor:
      d.consultationPrice.trim() === "" ? null : Math.round(Number(d.consultationPrice) * 100),
    currency: d.currency || "GBP",
    // Midday avoids a date shifting a day either side of UTC.
    nextAvailableAt: d.nextAvailableAt ? new Date(`${d.nextAvailableAt}T12:00:00Z`).toISOString() : null,
    videoUrl: nullable(d.videoUrl),
    videoThumbnailUrl: nullable(d.videoThumbnailUrl),
    videoDurationSeconds: numberOrNull(d.videoDurationSeconds),
    coverImageUrl: nullable(d.coverImageUrl),
    gallery: d.gallery
      .filter((g) => g.url.trim())
      .map((g) => ({ url: g.url.trim(), caption: g.caption.trim() || null })),
    websiteUrl: nullable(d.websiteUrl),
    socials:
      d.linkedin || d.instagram || d.x || d.facebook || d.youtube
        ? {
            linkedin: nullable(d.linkedin),
            instagram: nullable(d.instagram),
            x: nullable(d.x),
            facebook: nullable(d.facebook),
            youtube: nullable(d.youtube),
          }
        : null,
    bookingUrl: nullable(d.bookingUrl),
    publicEmail: nullable(d.publicEmail),
    publicPhone: nullable(d.publicPhone),
  };
}

/**
 * Flatten the three-level taxonomy into a single indented list.
 *
 * A specialist's primary specialty is usually a narrow leaf ("Shoulder
 * Arthroscopy"), so an options list that stopped at the second level
 * would silently fail to match their current value and show the
 * placeholder instead.
 */
function specialtyOptions(all: Specialty[]) {
  const out: { slug: string; label: string }[] = [];
  const walk = (parentId: string | null, depth: number) => {
    all
      .filter((s) => (s.parentId ?? null) === parentId)
      .forEach((node) => {
        out.push({ slug: node.slug, label: `${"  ".repeat(depth)}${depth ? "└ " : ""}${node.name}` });
        walk(node.id, depth + 1);
      });
  };
  walk(null, 0);
  return out;
}

/* ------------------------------------------------------------------ *
 * Expert Witness -- two guided second steps
 *
 * The dropdown above lists all three taxonomy levels flattened together,
 * which works fine when a specialist already knows they're "Shoulder
 * Arthroscopy". It doesn't work at all for Expert Witness: a solicitor
 * searching Expert Witnesses filters on two separate things -- the
 * specific TYPE of report (see "Type of report" in SearchFilters.tsx)
 * and the clinical discipline behind it -- and a real expert witness is
 * routinely tagged with several of each, not one. Both are their own
 * multi-select here, feeding caseTypeSlugs / clinicalSpecialtySlugs
 * (see toPatch and dashboard.controller.js's updateProfile), entirely
 * separate from the single primarySpecialtySlug value above them.
 *
 * A dashboard save used to collapse both down to whatever the single
 * primarySpecialtySlug dropdown held, silently dropping every other tag
 * a specialist had -- real risk once specialists actually carrying
 * several tags exist to lose them. These two multi-selects, and the
 * union in updateProfile, are what keep a save from ever doing that
 * again.
 * ------------------------------------------------------------------ */
function isExpertWitnessBranch(all: Specialty[], slug: string): boolean {
  const bySlug = new Map(all.map((s) => [s.slug, s]));
  const byId = new Map(all.map((s) => [s.id, s]));
  let node = bySlug.get(slug);
  while (node) {
    if (node.slug === "expert-witness") return true;
    node = node.parentId ? byId.get(node.parentId) : undefined;
  }
  return false;
}

/** The "type of report" options -- direct children of the Medicolegal
 *  branch (Personal Injury, Clinical Negligence, and so on). */
function expertWitnessPracticeAreas(all: Specialty[]) {
  const medicolegal = all.find((s) => s.slug === "expert-witness-medicolegal");
  if (!medicolegal) return [];
  return all.filter((s) => s.parentId === medicolegal.id);
}

/** The "medical specialty" options -- the clinical-discipline leaves
 *  under expert-witness-medical-specialty (Cardiology, Orthopaedics,
 *  and so on -- 0022_expert_witness_medical_specialty.sql). Sorted by
 *  name: there are close to ninety of these, in no useful taxonomy
 *  order for a flat checkbox grid. */
function expertWitnessMedicalSpecialties(all: Specialty[]) {
  const branch = all.find((s) => s.slug === "expert-witness-medical-specialty");
  if (!branch) return [];
  return all.filter((s) => s.parentId === branch.id).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The nine medico-legal CV fields (migration
 * 0014_expert_witness_profile_fields.sql), in the same order
 * MedicoLegalCV renders them on the public profile. `key` is a Draft
 * field, not a DashboardProfile one — toDraft already turned each
 * null into "" so every textarea below can stay a plain controlled
 * input like the rest of the form.
 */
const CV_FIELDS: {
  key:
    | "medicoLegalExperience"
    | "clinicalPracticeExperience"
    | "clinicalInterests"
    | "managementExperience"
    | "researchInterests"
    | "summaryOfPublications"
    | "teachingTraining"
    | "memberships"
    | "prizesAndAwards";
  label: string;
}[] = [
  { key: "medicoLegalExperience", label: "Medico-legal experience" },
  { key: "clinicalPracticeExperience", label: "Clinical practice experience" },
  { key: "clinicalInterests", label: "Clinical interests" },
  { key: "managementExperience", label: "Management experience" },
  { key: "researchInterests", label: "Research interests" },
  { key: "summaryOfPublications", label: "Summary of publications" },
  { key: "teachingTraining", label: "Teaching & training" },
  { key: "memberships", label: "Memberships" },
  { key: "prizesAndAwards", label: "Prizes & awards" },
];

export default function ProfileEditor() {
  const { specialist: specialistAccount } = useAuth();
  const [profile, setProfile] = useState<DashboardProfile | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [baseline, setBaseline] = useState<string>("");
  const [completion, setCompletion] = useState<Overview["completion"] | null>(null);
  const [cities, setCities] = useState<City[]>([]);
  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [res, cityList, specialtyList] = await Promise.all([
        dashboardApi.profile(),
        getCities().catch(() => [] as City[]),
        getAllSpecialties().catch(() => [] as Specialty[]),
      ]);
      const d = toDraft(res.profile, specialtyList);
      setProfile(res.profile);
      setDraft(d);
      setBaseline(JSON.stringify(d));
      setCompletion(res.completion);
      setCities(cityList);
      setSpecialties(specialtyList);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load your profile");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Jump to the section named in the hash once the form has rendered —
  // this is what makes the overview's "missing item" links land.
  useEffect(() => {
    if (!draft) return;
    const id = window.location.hash.slice(1);
    if (!id) return;
    const el = document.getElementById(id);
    if (el) window.requestAnimationFrame(() => el.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, [draft]);

  // What this specialist may actually edit. Read from the session rather
  // than assumed, so the form matches what the API will accept.
  const features = (specialistAccount?.features ?? {}) as Record<string, boolean | number | string | null>;
  const can = (key: string) => Boolean(features[key]);
  const galleryLimit = Number(features.galleryImageLimit ?? 0);
  const planName = specialistAccount?.planName ?? "your plan";

  const dirty = useMemo(() => (draft ? JSON.stringify(draft) !== baseline : false), [draft, baseline]);

  // Guard against losing edits to a stray back/refresh.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => (d ? { ...d, [key]: value } : d));

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    if (!draft) return;
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const res = await dashboardApi.updateProfile(toPatch(draft));
      setCompletion(res.completion);
      setBaseline(JSON.stringify(draft));
      setSaved(true);
      // Re-read so server-normalised values (a new treatment's canonical
      // name, a location's resolved city) replace what was typed.
      const fresh = await dashboardApi.profile();
      setProfile(fresh.profile);
      setDraft(toDraft(fresh.profile, specialties));
      setBaseline(JSON.stringify(toDraft(fresh.profile, specialties)));
      window.setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Could not save your changes");
    } finally {
      setSaving(false);
    }
  }

  return (
    <DashboardShell
      title="Your profile"
      subtitle="This is what patients see. Everything here is optional except your name — but the more you complete, the higher you appear."
      actions={
        profile ? (
          <Link
            to={`/specialists/${profile.slug}`}
            className="inline-flex items-center gap-2 rounded-full bg-paper-tint px-4 py-2.5 text-[13px] font-bold text-ink ring-1 ring-line transition hover:bg-line-soft"
          >
            <Eye className="h-4 w-4" strokeWidth={2} />
            Preview
          </Link>
        ) : null
      }
    >
      {loading && <LoadingBlock label="Loading your profile…" />}
      {error && !loading && <ErrorBlock message={error} onRetry={load} />}

      {draft && profile && !loading && (
        <form onSubmit={handleSave} className="space-y-5 pb-24">
          {completion && (
            <div className="rounded-2xl bg-white p-4 ring-1 ring-line sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[13.5px] font-bold text-ink">Profile completion</p>
                <p className="text-[13.5px] font-bold text-teal-700">{completion.percent}%</p>
              </div>
              <div className="mt-3">
                <ProgressBar percent={completion.percent} tone={completion.percent < 60 ? "amber" : "teal"} />
              </div>
              {completion.missing.length > 0 && (
                <p className="mt-2.5 text-[12.5px] text-ink-faint">
                  Still to add: {completion.missing.map((m) => m.label.replace(/^Add (your )?/i, "")).join(", ")}.
                </p>
              )}
            </div>
          )}

          {/* --------------------------------------------- basics */}
          <Section id="basic" icon={UserRound} title="About you" hint="Your name, photo and the summary patients read first.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Labelled label="Full name" required>
                <input value={draft.fullName} onChange={(e) => set("fullName", e.target.value)} className={input} required />
              </Labelled>
              <Labelled label="Professional title" hint="e.g. Consultant Orthopaedic Surgeon">
                <input value={draft.title} onChange={(e) => set("title", e.target.value)} className={input} />
              </Labelled>
            </div>

            <ImageUploadField
              id="profile-photo"
              label="Profile photo"
              hint="A head-and-shoulders portrait. It is the first thing a patient sees, and listings with one get contacted far more often than listings without."
              kind="profile-photo"
              shape="avatar"
              value={draft.photoUrl}
              onChange={(url) => set("photoUrl", url)}
            />

            <Labelled
              label="Biography"
              hint={`${draft.bio.length} characters — around 120 or more reads best on your profile page.`}
            >
              <textarea
                value={draft.bio}
                onChange={(e) => set("bio", e.target.value)}
                rows={6}
                maxLength={5000}
                placeholder="Where you trained, what you treat, how you work with patients…"
                className={`${input} resize-y leading-relaxed`}
              />
            </Labelled>

            <div className="grid gap-4 sm:grid-cols-2">
              <Labelled label="Contact email" hint="Where patient enquiries are sent. Never shown publicly.">
                <input
                  type="email"
                  value={draft.contactEmail}
                  onChange={(e) => set("contactEmail", e.target.value)}
                  className={input}
                />
              </Labelled>
              <Labelled label="Contact phone" hint="Used for enquiries only. Never shown publicly.">
                <input
                  type="tel"
                  value={draft.contactPhone}
                  onChange={(e) => set("contactPhone", e.target.value)}
                  className={input}
                />
              </Labelled>
            </div>
          </Section>

          {/* --------------------------------------- professional */}
          <Section
            id="professional"
            icon={Building2}
            title="Professional details"
            hint="Your registration is checked against the regulator during verification."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Labelled label="Years of experience">
                <input
                  type="number"
                  min={0}
                  max={80}
                  value={draft.yearsExperience}
                  onChange={(e) => set("yearsExperience", e.target.value)}
                  className={input}
                />
              </Labelled>
              <Labelled label="Registration number" hint="GMC, GDC, NMC or HCPC.">
                <input
                  value={draft.registrationNumber}
                  onChange={(e) => set("registrationNumber", e.target.value)}
                  className={input}
                />
              </Labelled>
            </div>

            <Labelled label="Languages spoken" hint="Patients filter on this.">
              <ChipInput
                values={draft.languages}
                onChange={(v) => set("languages", v)}
                placeholder="Add a language and press Enter"
              />
            </Labelled>
          </Section>

          {/* ---------------------------------------- specialties */}
          <Section
            id="specialties"
            icon={Stethoscope}
            title="Specialty"
            hint="Decides which category your profile appears under and which hero image it uses."
          >
            <Labelled
              label="Primary specialty"
              required
              hint="Pick the narrowest one that fits — patients searching the category above it will still find you."
            >
              <select
                value={draft.primarySpecialtySlug}
                onChange={(e) => set("primarySpecialtySlug", e.target.value)}
                className={input}
              >
                <option value="">Select a specialty…</option>
                {specialtyOptions(specialties).map((opt) => (
                  <option key={opt.slug} value={opt.slug}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </Labelled>

            {isExpertWitnessBranch(specialties, draft.primarySpecialtySlug) && (
              <>
                <Labelled
                  label="Type of report"
                  hint="Every kind of expert witness report you write. Solicitors searching Expert Witnesses filter by this, so an empty list means you won't turn up in a report-type search -- pick as many as apply."
                >
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {expertWitnessPracticeAreas(specialties).map((opt) => {
                      const checked = draft.caseTypeSlugs.includes(opt.slug);
                      return (
                        <label key={opt.slug} className={checkboxTileClass(checked)}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => set("caseTypeSlugs", toggleValue(draft.caseTypeSlugs, opt.slug))}
                            className="h-4 w-4 rounded border-line text-teal-600 focus:ring-teal-500"
                          />
                          {opt.name}
                        </label>
                      );
                    })}
                  </div>
                </Labelled>

                <Labelled
                  label="Medical specialty"
                  hint="Every clinical discipline you're instructed on as an expert witness. This is filtered separately from the type of report above, so solicitors can search by either -- pick as many as apply."
                >
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {expertWitnessMedicalSpecialties(specialties).map((opt) => {
                      const checked = draft.clinicalSpecialtySlugs.includes(opt.slug);
                      return (
                        <label key={opt.slug} className={checkboxTileClass(checked)}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              set("clinicalSpecialtySlugs", toggleValue(draft.clinicalSpecialtySlugs, opt.slug))
                            }
                            className="h-4 w-4 rounded border-line text-teal-600 focus:ring-teal-500"
                          />
                          {opt.name}
                        </label>
                      );
                    })}
                  </div>
                </Labelled>

                <Labelled
                  label="Regions covered"
                  hint="Every region you'll travel to or write reports for. Solicitors filter Expert Witnesses by this, so an empty list means you won't turn up in a region search."
                >
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {UK_REGIONS.map((region) => {
                      const checked = draft.coveredRegions.includes(region);
                      return (
                        <label key={region} className={checkboxTileClass(checked)}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => set("coveredRegions", toggleValue(draft.coveredRegions, region))}
                            className="h-4 w-4 rounded border-line text-teal-600 focus:ring-teal-500"
                          />
                          {region}
                        </label>
                      );
                    })}
                  </div>
                </Labelled>
              </>
            )}
          </Section>

          {/* -------------------------------------- medico-legal CV
              Same gate as "Type of report" / "Regions covered" above,
              and the same reasoning: the API accepts these fields from
              any specialist (see profileSchema's own comment), but
              there's nothing for most specialists to put in a
              "Summary of publications" box on an expert-witness CV, so
              the form only surfaces it once they're in that branch. */}
          {isExpertWitnessBranch(specialties, draft.primarySpecialtySlug) && (
            <Section
              id="medico-legal-cv"
              icon={Scale}
              title="Medico-legal experience"
              hint="Rendered as its own labelled section on your public profile, the same shape a solicitor expects from an expert witness CV. Leave anything blank — only what you fill in appears."
            >
              <Labelled
                label="Areas of expertise"
                hint="Your own terms for what you're instructed on — e.g. Breast Implants, Mastopexy. Shown as tags on your profile, not linked to a search filter."
              >
                <ChipInput
                  values={draft.areasOfExpertise}
                  onChange={(v) => set("areasOfExpertise", v)}
                  placeholder="Add a term and press Enter"
                />
              </Labelled>

              <div className="grid gap-4 sm:grid-cols-2">
                {CV_FIELDS.map(({ key, label }) => (
                  <Labelled key={key} label={label}>
                    <textarea
                      value={draft[key]}
                      onChange={(e) => set(key, e.target.value)}
                      rows={4}
                      maxLength={4000}
                      className={`${input} resize-y leading-relaxed`}
                    />
                  </Labelled>
                ))}
              </div>
            </Section>
          )}

          {/* ----------------------------------------- treatments */}
          <Section
            id="treatments"
            icon={Stethoscope}
            title="Treatments you offer"
            hint="These are what patients search for. Anything not already on the platform is added under your specialty."
          >
            <ChipInput
              values={draft.treatmentNames}
              onChange={(v) => set("treatmentNames", v)}
              placeholder="e.g. Total Knee Replacement — press Enter to add"
            />
          </Section>

          {/* ------------------------------------------ locations */}
          <Section
            id="locations"
            icon={MapPin}
            title="Where you practise"
            hint="Each address appears on your profile and puts you in that city's search results."
          >
            <div className="space-y-3">
              {draft.locations.map((loc, i) =>
                /* An address that belongs to a clinic is shown, not
                   edited: it is the clinic's record, shared with every
                   other specialist who practises there, and one person
                   editing it here would change it for all of them. */
                loc.clinic ? (
                  <div
                    key={`clinic-${loc.clinic.id}-${i}`}
                    className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-line bg-white p-3.5"
                  >
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 text-[13px] font-bold text-ink">
                        <Building2 className="h-3.5 w-3.5 shrink-0 text-teal-600" strokeWidth={2.5} />
                        {loc.clinic.name}
                      </p>
                      <p className="mt-1 text-[12.5px] text-ink-muted">
                        {loc.address}
                        {loc.postcode ? `, ${loc.postcode}` : ""}
                        {loc.phone ? ` · ${loc.phone}` : ""}
                      </p>
                      <p className="mt-1.5 text-[11.5px] text-ink-faint">
                        Managed by {loc.clinic.name}. It appears on your profile and puts you in that city&apos;s
                        results — ask them to update it if anything here is wrong.
                      </p>
                      {/* Shown here too, because "is this the right
                          address?" is the only question worth asking
                          about a row you cannot edit. */}
                      <MapPreview
                        lat={loc.lat}
                        lng={loc.lng}
                        address={[loc.address, loc.postcode].filter(Boolean).join(", ")}
                        fallback={cityFallback(cities, loc.cityId)}
                        size={170}
                        className="mt-3"
                        quiet
                      />
                    </div>
                    <Link
                      to={`/clinics/${loc.clinic.slug}`}
                      target="_blank"
                      className="shrink-0 rounded-full px-3 py-2 text-[12.5px] font-bold text-teal-700 ring-1 ring-line transition hover:bg-paper-tint"
                    >
                      View
                    </Link>
                  </div>
                ) : (
                <div key={i} className="rounded-xl bg-paper-muted p-3.5">
                  <div className="grid gap-3 sm:grid-cols-[1.6fr_1fr]">
                    <Labelled label="Address">
                      <AddressField
                        id={`location-address-${i}`}
                        value={{
                          address: loc.address,
                          postcode: loc.postcode,
                          lat: loc.lat ?? null,
                          lng: loc.lng ?? null,
                        }}
                        // The chosen city, so a typed address still gets
                        // a map — marked approximate — instead of none.
                        fallback={cityFallback(cities, loc.cityId)}
                        onChange={(next) =>
                          set(
                            "locations",
                            draft.locations.map((l, j) =>
                              j === i
                                ? {
                                    ...l,
                                    address: next.address,
                                    // A picked suggestion usually knows
                                    // the postcode too — fill it rather
                                    // than making them type it twice.
                                    postcode: next.postcode || l.postcode,
                                    lat: next.lat,
                                    lng: next.lng,
                                  }
                                : l
                            )
                          )
                        }
                      />
                    </Labelled>
                    <Labelled label="City">
                      <select
                        value={loc.cityId}
                        onChange={(e) =>
                          set(
                            "locations",
                            draft.locations.map((l, j) => (j === i ? { ...l, cityId: e.target.value } : l))
                          )
                        }
                        className={input}
                      >
                        <option value="">Select a city…</option>
                        {cities.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </Labelled>
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
                    <Labelled label="Postcode">
                      <input
                        value={loc.postcode}
                        onChange={(e) =>
                          set(
                            "locations",
                            draft.locations.map((l, j) => (j === i ? { ...l, postcode: e.target.value } : l))
                          )
                        }
                        placeholder="B3 2QD"
                        className={input}
                      />
                    </Labelled>
                    <Labelled label="Phone">
                      <input
                        value={loc.phone}
                        onChange={(e) =>
                          set(
                            "locations",
                            draft.locations.map((l, j) => (j === i ? { ...l, phone: e.target.value } : l))
                          )
                        }
                        placeholder="0121 496 0100"
                        className={input}
                      />
                    </Labelled>
                    <div className="flex items-end">
                      <button
                        type="button"
                        onClick={() => set("locations", draft.locations.filter((_, j) => j !== i))}
                        className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2.5 text-[12.5px] font-bold text-danger transition hover:bg-danger/10"
                      >
                        <Trash2 className="h-3.5 w-3.5" strokeWidth={2.5} />
                        Remove
                      </button>
                    </div>
                  </div>
                </div>
                )
              )}
            </div>

            <button
              type="button"
              onClick={() =>
                set("locations", [
                  ...draft.locations,
                  { address: "", cityId: "", postcode: "", phone: "", lat: null, lng: null, clinic: null },
                ])
              }
              className="mt-3 inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-[13px] font-bold text-teal-700 ring-1 ring-line transition hover:bg-paper-tint"
            >
              <Plus className="h-4 w-4" strokeWidth={2.5} />
              Add a location
            </button>
          </Section>

          {/* --------------------------------------- consultation */}
          <Section
            id="consultation"
            icon={Wallet}
            title="Consultation"
            hint="Shown on your profile card and used by the price filter in search."
          >
            <div className="grid gap-4 sm:grid-cols-3">
              <Labelled label="Initial consultation price" hint="In pounds. Leave blank if it varies.">
                <div className="relative">
                  <span className="absolute inset-y-0 left-3.5 grid place-items-center text-[13.5px] font-semibold text-ink-faint">
                    £
                  </span>
                  <input
                    type="number"
                    min={0}
                    step="1"
                    value={draft.consultationPrice}
                    onChange={(e) => set("consultationPrice", e.target.value)}
                    className={`${input} pl-7`}
                  />
                </div>
              </Labelled>
              <Labelled label="Currency">
                <select value={draft.currency} onChange={(e) => set("currency", e.target.value)} className={input}>
                  {["GBP", "EUR", "USD"].map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </Labelled>
              <Labelled label="Next available appointment" hint="Patients can sort by soonest availability.">
                <input
                  type="date"
                  value={draft.nextAvailableAt}
                  onChange={(e) => set("nextAvailableAt", e.target.value)}
                  className={input}
                />
              </Labelled>
            </div>
          </Section>

          {/* ---------------------------------------------- media */}
          <GatedSection
            id="media"
            icon={Video}
            title="Introduction video"
            hint="When a video is set, it replaces the placeholder panel on your profile page."
            entitled={can("videoBio")}
            planName={planName}
          >
            <VideoUploadField
              id="intro-video"
              label="Your video"
              hint="Record on a phone and upload it here — patients watch the first fifteen seconds, so a minute is plenty."
              value={draft.videoUrl}
              onChange={(url) => set("videoUrl", url)}
              // Read off the file itself, so nobody has to count the
              // seconds and type them into a box.
              onDuration={(seconds) => set("videoDurationSeconds", String(seconds))}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <ImageUploadField
                id="video-thumbnail"
                label="Cover image"
                hint="Shown before the video plays. Optional — without one the first frame is used."
                value={draft.videoThumbnailUrl}
                onChange={(url) => set("videoThumbnailUrl", url)}
                kind="cover"
                shape="wide"
              />
              <Labelled label="Duration (seconds)" hint="Filled in automatically when you upload.">
                <input
                  id="video-duration"
                  type="number"
                  min={0}
                  value={draft.videoDurationSeconds}
                  onChange={(e) => set("videoDurationSeconds", e.target.value)}
                  className={input}
                />
              </Labelled>
            </div>
          </GatedSection>

          {/* -------------------------------------- plan-gated */}
          <GatedSection
            id="links"
            icon={LinkIcon}
            title="Website & social links"
            hint="Shown in the contact strip under your profile."
            entitled={can("websiteAndSocial")}
            planName={planName}
          >
            <Labelled label="Practice website">
              <input
                value={draft.websiteUrl}
                onChange={(e) => set("websiteUrl", e.target.value)}
                placeholder="https://www.yourpractice.co.uk"
                className={input}
              />
            </Labelled>
            {/* Each field wears its own platform's mark in its own
                colour, so the row is scannable rather than five
                identical boxes with different words above them. */}
            <div className="grid gap-4 sm:grid-cols-2">
              {SOCIAL_BRANDS.map((brand) => (
                <Labelled key={brand.key} label={brand.name}>
                  <div className="relative">
                    <span
                      className="pointer-events-none absolute left-2.5 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-lg"
                      style={{ backgroundColor: brand.tint }}
                    >
                      <SocialGlyph platform={brand.key} className="h-[15px] w-[15px]" />
                    </span>
                    <input
                      id={`social-${brand.key}`}
                      value={draft[brand.key]}
                      onChange={(e) => set(brand.key, e.target.value)}
                      // A full URL, an @handle or a bare username all
                      // work — normaliseSocial sorts it out on save
                      // rather than rejecting two of the three ways
                      // people actually paste these.
                      onBlur={(e) => set(brand.key, normaliseSocial(brand.key, e.target.value) ?? "")}
                      placeholder={brand.prefix.replace(/^https?:\/\/(www\.)?/, "") + brand.placeholder}
                      className={`${input} pl-11`}
                    />
                  </div>
                </Labelled>
              ))}
            </div>
          </GatedSection>

          <GatedSection
            id="booking"
            icon={CalendarClock}
            title="Booking link"
            hint="Powers the Book an appointment button on your profile."
            entitled={can("bookingLink")}
            planName={planName}
          >
            <Labelled label="Calendar or booking URL" hint="Calendly, your own system — anything with a public link.">
              <input
                value={draft.bookingUrl}
                onChange={(e) => set("bookingUrl", e.target.value)}
                placeholder="https://calendly.com/…"
                className={input}
              />
            </Labelled>
          </GatedSection>

          {/* Distinct from the enquiry address above: that one is
              private and never leaves your inbox. These two are
              click-to-reveal details on your public profile -- leave
              either blank and there's simply nothing for a patient to
              reveal there. Each field is only shown when its own plan
              feature allows it, so Basic can publish a phone number
              without also publishing an email address. */}
          <GatedSection
            id="public-contact"
            icon={Phone}
            title="Published contact details"
            hint="Shown as click-to-reveal buttons on your profile, separate from where enquiries land."
            entitled={can("phoneReveal") || can("publicContactEmail")}
            planName={planName}
          >
            {can("phoneReveal") && (
              <Labelled label="Published phone" hint="What a patient sees after tapping “Reveal phone” on your profile.">
                <input
                  type="tel"
                  value={draft.publicPhone}
                  onChange={(e) => set("publicPhone", e.target.value)}
                  placeholder="020 7946 0958"
                  className={input}
                />
              </Labelled>
            )}
            {can("publicContactEmail") && (
              <Labelled
                label="Published email"
                hint="What a patient sees after tapping “Reveal email” on your profile."
              >
                <input
                  type="email"
                  value={draft.publicEmail}
                  onChange={(e) => set("publicEmail", e.target.value)}
                  placeholder="reception@yourclinic.co.uk"
                  className={input}
                />
              </Labelled>
            )}
          </GatedSection>

          <GatedSection
            id="gallery"
            icon={Images}
            title="Clinic photo gallery"
            hint={
              galleryLimit
                ? `Up to ${galleryLimit} images on your plan. They appear as their own tab on your profile.`
                : "Images of your rooms, theatre and team."
            }
            entitled={can("photoGallery")}
            planName={planName}
          >
            <ImageUploadField
              id="cover-image"
              label="Cover banner"
              hint="A wide image shown behind your profile header."
              value={draft.coverImageUrl}
              onChange={(url) => set("coverImageUrl", url)}
              kind="cover"
              shape="wide"
            />

            {/* Uploaded, not pasted. This was the last URL box left in
                the form, which meant the gallery could only be filled by
                someone who already hosts their photographs somewhere and
                can find the links — so in practice it was never filled
                at all. */}
            <div className="space-y-3">
              {draft.gallery.map((image, i) => (
                <div key={i} className="flex flex-wrap items-start gap-4 rounded-xl bg-paper-muted p-3.5">
                  <div className="min-w-[240px] flex-1">
                    <ImageUploadField
                      id={`gallery-image-${i}`}
                      label={`Image ${i + 1}`}
                      value={image.url}
                      onChange={(url) =>
                        set("gallery", draft.gallery.map((g, j) => (j === i ? { ...g, url } : g)))
                      }
                      kind="gallery"
                      shape="wide"
                    />
                  </div>
                  <div className="min-w-[180px] flex-1">
                    <Labelled label="Caption" hint="What a patient is looking at.">
                      <input
                        value={image.caption}
                        onChange={(e) =>
                          set("gallery", draft.gallery.map((g, j) => (j === i ? { ...g, caption: e.target.value } : g)))
                        }
                        placeholder="Consulting room"
                        className={input}
                      />
                    </Labelled>
                    <button
                      type="button"
                      onClick={() => set("gallery", draft.gallery.filter((_, j) => j !== i))}
                      className="mt-3 inline-flex items-center gap-1.5 rounded-xl px-3 py-2.5 text-[12.5px] font-bold text-danger transition hover:bg-danger/10"
                    >
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={2.5} />
                      Remove this image
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {draft.gallery.length < galleryLimit && (
              <button
                type="button"
                onClick={() => set("gallery", [...draft.gallery, { url: "", caption: "" }])}
                className="inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-[13px] font-bold text-teal-700 ring-1 ring-line transition hover:bg-paper-tint"
              >
                <Plus className="h-4 w-4" strokeWidth={2.5} />
                Add an image
              </button>
            )}
            {galleryLimit > 0 && (
              <p className="text-[11.5px] text-ink-faint">
                {draft.gallery.length} of {galleryLimit} used.
              </p>
            )}
          </GatedSection>

          {/* ------------------------------------------ save bar
              `left-0` put this underneath the fixed 248px sidebar on
              desktop, and the sidebar sits on a higher layer — so the
              status message, which lives at the left end of the bar,
              was covered by it. Someone pressing Save saw nothing
              happen. The bar now begins where the sidebar ends.

              Same failure, different cause, during a support session:
              ImpersonationBanner is also fixed to the bottom edge, at a
              higher z-index, so it sat directly on top of this bar and
              hid the button entirely -- an admin editing a member's
              profile had no visible way to save. ImpersonationBanner
              publishes its own height as --impersonation-bar-h while
              active; reading it here lifts this bar to sit above the
              banner instead of underneath it. Outside a support
              session the variable is unset and this is bottom: 0, same
              as before. */}
          <div
            className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-navy-950/95 px-5 py-3 backdrop-blur sm:px-7 lg:left-[248px]"
            style={{ bottom: "var(--impersonation-bar-h, 0px)" }}
          >
            {/* Confirmation deserves more than a line of grey text: it
                is the only answer to "did that work?", and it has to be
                unmissable from wherever on the page the eye happens to
                be. It rises above the bar, in the middle, and is
                announced to screen readers as it appears. */}
            {(saved || saveError) && (
              <div
                className="pointer-events-none absolute inset-x-0 bottom-full flex justify-center px-5 pb-3"
                role="status"
                aria-live="polite"
              >
                <p
                  className={`animate-[toast_240ms_ease-out] inline-flex max-w-full items-center gap-2 rounded-full px-4 py-2.5 text-[13.5px] font-bold shadow-lg ring-1 ${
                    saveError
                      ? "bg-danger text-white ring-line"
                      : "bg-teal-500 text-navy-950 ring-teal-300/40"
                  }`}
                >
                  {saveError ? (
                    <TriangleAlert className="h-4 w-4 shrink-0" strokeWidth={2.5} />
                  ) : (
                    <Check className="h-4 w-4 shrink-0" strokeWidth={3} />
                  )}
                  <span className="truncate">
                    {saveError ?? "Your changes have been saved to your profile."}
                  </span>
                </p>
              </div>
            )}

            <div className="mx-auto flex w-full max-w-[1180px] flex-wrap items-center justify-between gap-3">
              <p className="text-[12.5px] text-ink-faint">
                {saved ? (
                  <span className="inline-flex items-center gap-1.5 font-semibold text-teal-700">
                    <Check className="h-3.5 w-3.5" strokeWidth={3} />
                    Saved just now
                  </span>
                ) : dirty ? (
                  "You have unsaved changes."
                ) : (
                  "All changes saved."
                )}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={!dirty || saving}
                  onClick={() => setDraft(JSON.parse(baseline) as Draft)}
                  className="rounded-full px-4 py-2.5 text-[13px] font-bold text-ink-muted transition hover:bg-paper-tint hover:text-ink disabled:opacity-40"
                >
                  Discard
                </button>
                <button
                  type="submit"
                  disabled={!dirty || saving}
                  className={`inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-[13px] font-bold transition ${
                    saved
                      ? "bg-white text-teal-700"
                      : "bg-teal-500 text-navy-950 hover:bg-teal-400 disabled:opacity-40"
                  }`}
                >
                  {saving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : saved ? (
                    <Check className="h-4 w-4" strokeWidth={3} />
                  ) : (
                    <Save className="h-4 w-4" strokeWidth={2.5} />
                  )}
                  {saving ? "Saving…" : saved ? "Saved" : "Save changes"}
                </button>
              </div>
            </div>
          </div>
        </form>
      )}
    </DashboardShell>
  );
}

/* ----------------------------------------------------------- pieces */

function Section({
  id,
  icon: Icon,
  title,
  hint,
  children,
}: {
  id: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <Panel className="scroll-mt-24" >
      <section id={id}>
        <div className="mb-4 flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-teal-50 text-teal-700">
            <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
          </span>
          <div>
            <h2 className="font-display text-[16px] font-bold text-ink">{title}</h2>
            {hint && <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-muted">{hint}</p>}
          </div>
        </div>
        <div className="space-y-4">{children}</div>
      </section>
    </Panel>
  );
}

function Labelled({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12.5px] font-bold text-ink">
        {label}
        {required && <span className="ml-1 text-danger">*</span>}
      </span>
      {children}
      {hint && <span className="mt-1.5 block text-[11.5px] leading-relaxed text-ink-faint">{hint}</span>}
    </label>
  );
}

/** Tag entry: Enter or comma commits, Backspace on an empty field removes. */
function ChipInput({
  values,
  onChange,
  placeholder,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
}) {
  const [text, setText] = useState("");

  function commit() {
    const value = text.trim().replace(/,$/, "");
    if (value && !values.some((v) => v.toLowerCase() === value.toLowerCase())) onChange([...values, value]);
    setText("");
  }

  return (
    <div className="rounded-xl border border-line bg-white p-2 focus-within:border-teal-500 focus-within:ring-2 focus-within:ring-teal-500/20">
      {values.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-1.5">
          {values.map((v) => (
            <li key={v}>
              <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 py-1 pl-3 pr-1 text-[12.5px] font-semibold text-teal-800">
                {v}
                <button
                  type="button"
                  onClick={() => onChange(values.filter((x) => x !== v))}
                  aria-label={`Remove ${v}`}
                  className="grid h-5 w-5 place-items-center rounded-full text-teal-700 transition hover:bg-teal-100"
                >
                  <X className="h-3 w-3" strokeWidth={3} />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            commit();
          } else if (e.key === "Backspace" && !text && values.length) {
            onChange(values.slice(0, -1));
          }
        }}
        onBlur={commit}
        placeholder={placeholder}
        className="w-full bg-transparent px-2 py-1.5 text-[13.5px] text-ink outline-none placeholder:text-ink-faint"
      />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * A section the plan may or may not include
 *
 * When it does not, the fields are not rendered at all — a disabled form
 * you can see but not use is worse than an honest explanation of what
 * would unlock it. Anything already saved stays in the database and
 * comes back on upgrade, which is what the notice says.
 * ------------------------------------------------------------------ */
function GatedSection({
  id,
  icon: Icon,
  title,
  hint,
  entitled,
  planName,
  children,
}: {
  id: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  title: string;
  hint?: string;
  entitled: boolean;
  planName: string;
  children: React.ReactNode;
}) {
  if (entitled) {
    return (
      <Section id={id} icon={Icon} title={title} hint={hint}>
        {children}
      </Section>
    );
  }

  return (
    <Panel className="scroll-mt-24">
      <section id={id}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-paper-tint text-ink-faint">
              <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
            </span>
            <div>
              <h2 className="flex items-center gap-2 font-display text-[16px] font-bold text-ink-muted">
                {title}
                <Lock className="h-3.5 w-3.5 text-ink-faint" strokeWidth={2.5} aria-hidden />
              </h2>
              <p className="mt-0.5 max-w-[52ch] text-[12.5px] leading-relaxed text-ink-muted">
                Not included on {planName}. {hint} Anything you saved on a previous plan is still here and returns the
                moment you upgrade.
              </p>
            </div>
          </div>
          <Link
            to="/dashboard/billing"
            className="shrink-0 rounded-full bg-teal-600 px-4 py-2.5 text-[12.5px] font-bold text-white transition hover:bg-teal-700"
          >
            Upgrade
          </Link>
        </div>
      </section>
    </Panel>
  );
}
