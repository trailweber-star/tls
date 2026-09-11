import { useEffect, useState } from "react";
import { Search as SearchIcon, SlidersHorizontal, X } from "lucide-react";
import type { MemberFacets, MemberQuery } from "../../lib/dashboardApi";

/* ------------------------------------------------------------------ *
 * The stacked filter grid
 *
 * Every filter the list supports, visible at once, each one narrowing
 * what the others returned. The behaviour that matters is the stacking:
 * "premium members in Birmingham who signed up last month and have never
 * logged in" is a question an administrator asks in one go, and a search
 * box that only understood a name would make it four separate exports
 * and a spreadsheet.
 *
 * Text fields commit on Enter or when they lose focus; everything with a
 * fixed set of options commits on change. That split exists because a
 * dropdown has one deliberate value and a text field has an in-progress
 * one, and re-running the query on every keystroke would fight the
 * person typing.
 * ------------------------------------------------------------------ */

const PLANS = [
  { value: "basic", label: "Basic" },
  { value: "premium", label: "Premium" },
  { value: "clinwell", label: "Full Suite" },
];

const PLAN_STATUSES = [
  { value: "active", label: "Active" },
  { value: "pending_verification", label: "Awaiting verification" },
  { value: "pending_payment", label: "Awaiting payment" },
  { value: "past_due", label: "Past due" },
  { value: "canceled", label: "Cancelled" },
];

const YES_NO = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];

/** Human wording for the chips that show what is currently narrowing the list. */
const FILTER_LABELS: Record<string, string> = {
  q: "Search",
  email: "Email",
  status: "Status",
  plan: "Plan",
  planStatus: "Membership",
  claimed: "Claimed",
  accountActive: "Account active",
  specialty: "Specialty",
  city: "City",
  country: "Country",
  ip: "IP",
  hasPhoto: "Has photo",
  source: "Source",
  tag: "Tag",
  joinedFrom: "Joined from",
  joinedTo: "Joined to",
  loginFrom: "Last login from",
  loginTo: "Last login to",
  neverLoggedIn: "Never signed in",
};

/** Keys that are filters rather than paging or ordering. */
export const FILTER_KEYS = Object.keys(FILTER_LABELS);

const fieldClass =
  "w-full rounded-xl border border-line-soft bg-paper px-3 py-2 text-[13px] text-ink outline-none transition placeholder:text-ink-faint focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20";
const labelClass = "mb-1 block text-[11px] font-bold uppercase tracking-wide text-ink-faint";

export function MemberFilters({
  query,
  facets,
  onChange,
  onClear,
}: {
  query: MemberQuery;
  facets: MemberFacets | null;
  /** Commit one or more filters. Paging is reset by the caller. */
  onChange: (patch: Partial<Record<string, string | null>>) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);

  /* Text fields keep a local draft so typing is never interrupted by a
     re-render from the request the last keystroke triggered. */
  const [draft, setDraft] = useState<Record<string, string>>({});
  useEffect(() => {
    setDraft({
      q: query.q ?? "",
      email: query.email ?? "",
      city: query.city ?? "",
      ip: query.ip ?? "",
    });
  }, [query.q, query.email, query.city, query.ip]);

  const active = FILTER_KEYS.filter((key) => {
    const value = (query as Record<string, unknown>)[key];
    return value !== undefined && value !== null && value !== "" && value !== "all";
  });

  function commitText(key: string) {
    const value = (draft[key] ?? "").trim();
    if ((query as Record<string, unknown>)[key] === (value || undefined)) return;
    onChange({ [key]: value || null });
  }

  return (
    <section className="mb-4 overflow-hidden rounded-2xl bg-white text-ink shadow-sm">
      {/* ---------------------------------------------- always visible */}
      <div className="flex flex-wrap items-center gap-3 p-4 sm:p-5">
        <form
          className="relative min-w-0 flex-1 basis-64"
          onSubmit={(e) => {
            e.preventDefault();
            commitText("q");
          }}
        >
          <SearchIcon
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint"
            strokeWidth={2}
            aria-hidden
          />
          <input
            value={draft.q ?? ""}
            onChange={(e) => setDraft((d) => ({ ...d, q: e.target.value }))}
            onBlur={() => commitText("q")}
            placeholder="Name, email, town, specialty, profile ID…"
            aria-label="Search members"
            className={`${fieldClass} pl-10`}
          />
        </form>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-[12.5px] font-bold transition ${
            open || active.length > 1
              ? "bg-teal-50 text-teal-700"
              : "bg-paper-tint text-ink-muted hover:bg-line-soft"
          }`}
        >
          <SlidersHorizontal className="h-4 w-4" strokeWidth={2.5} aria-hidden />
          {open ? "Hide filters" : "More filters"}
          {active.length > 0 && (
            <span className="rounded-full bg-teal-600 px-1.5 py-0.5 text-[10.5px] font-bold text-white">
              {active.length}
            </span>
          )}
        </button>
      </div>

      {/* -------------------------------------------------- the grid */}
      {open && (
        <div className="border-t border-line-soft p-4 sm:p-5">
          <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block">
              <span className={labelClass}>Email contains</span>
              <input
                value={draft.email ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))}
                onBlur={() => commitText("email")}
                onKeyDown={(e) => e.key === "Enter" && commitText("email")}
                placeholder="@nhs.uk"
                className={fieldClass}
              />
            </label>

            <label className="block">
              <span className={labelClass}>Membership</span>
              <select
                value={query.plan ?? "all"}
                onChange={(e) => onChange({ plan: e.target.value })}
                className={fieldClass}
              >
                <option value="all">Any plan</option>
                {PLANS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className={labelClass}>Billing state</span>
              <select
                value={query.planStatus ?? "all"}
                onChange={(e) => onChange({ planStatus: e.target.value })}
                className={fieldClass}
              >
                <option value="all">Any state</option>
                {PLAN_STATUSES.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className={labelClass}>Specialty</span>
              <select
                value={query.specialty ?? "all"}
                onChange={(e) => onChange({ specialty: e.target.value })}
                className={fieldClass}
              >
                <option value="all">Any specialty</option>
                {(facets?.specialties ?? []).map((s) => (
                  <option key={s.slug} value={s.slug}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className={labelClass}>Town or city</span>
              <input
                value={draft.city ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, city: e.target.value }))}
                onBlur={() => commitText("city")}
                onKeyDown={(e) => e.key === "Enter" && commitText("city")}
                list="member-cities"
                placeholder="Birmingham"
                className={fieldClass}
              />
              <datalist id="member-cities">
                {(facets?.cities ?? []).map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </label>

            <label className="block">
              <span className={labelClass}>Sign-up country</span>
              <select
                value={query.country ?? "all"}
                onChange={(e) => onChange({ country: e.target.value })}
                className={fieldClass}
              >
                <option value="all">Anywhere</option>
                {(facets?.countries ?? []).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className={labelClass}>IP address</span>
              <input
                value={draft.ip ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, ip: e.target.value }))}
                onBlur={() => commitText("ip")}
                onKeyDown={(e) => e.key === "Enter" && commitText("ip")}
                placeholder="81.100."
                className={fieldClass}
              />
            </label>

            <label className="block">
              <span className={labelClass}>Where from</span>
              <select
                value={query.source ?? "all"}
                onChange={(e) => onChange({ source: e.target.value })}
                className={fieldClass}
              >
                <option value="all">Any origin</option>
                <option value="signup">Signed up here</option>
                <option value="imported">Imported</option>
                {(facets?.sources ?? []).map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className={labelClass}>Claimed</span>
              <select
                value={query.claimed ?? "all"}
                onChange={(e) => onChange({ claimed: e.target.value })}
                className={fieldClass}
              >
                <option value="all">Either</option>
                {YES_NO.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className={labelClass}>Account active</span>
              <select
                value={query.accountActive ?? "all"}
                onChange={(e) => onChange({ accountActive: e.target.value })}
                className={fieldClass}
              >
                <option value="all">Either</option>
                {YES_NO.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className={labelClass}>Has a photo</span>
              <select
                value={query.hasPhoto ?? "all"}
                onChange={(e) => onChange({ hasPhoto: e.target.value })}
                className={fieldClass}
              >
                <option value="all">Either</option>
                {YES_NO.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className={labelClass}>Tag</span>
              <select
                value={query.tag ?? ""}
                onChange={(e) => onChange({ tag: e.target.value || null })}
                className={fieldClass}
              >
                <option value="">Any tag</option>
                {(facets?.tags ?? []).map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className={labelClass}>Joined from</span>
              <input
                type="date"
                value={query.joinedFrom ?? ""}
                onChange={(e) => onChange({ joinedFrom: e.target.value || null })}
                className={fieldClass}
              />
            </label>

            <label className="block">
              <span className={labelClass}>Joined up to</span>
              <input
                type="date"
                value={query.joinedTo ?? ""}
                onChange={(e) => onChange({ joinedTo: e.target.value || null })}
                className={fieldClass}
              />
            </label>

            <label className="block">
              <span className={labelClass}>Last signed in from</span>
              <input
                type="date"
                value={query.loginFrom ?? ""}
                onChange={(e) => onChange({ loginFrom: e.target.value || null })}
                className={fieldClass}
              />
            </label>

            <label className="block">
              <span className={labelClass}>Last signed in up to</span>
              <input
                type="date"
                value={query.loginTo ?? ""}
                onChange={(e) => onChange({ loginTo: e.target.value || null })}
                className={fieldClass}
              />
            </label>
          </div>

          <label className="mt-4 inline-flex items-center gap-2 text-[13px] text-ink-muted">
            <input
              type="checkbox"
              checked={query.neverLoggedIn === "yes"}
              onChange={(e) => onChange({ neverLoggedIn: e.target.checked ? "yes" : null })}
              className="h-4 w-4 rounded border-line-soft text-teal-600 focus:ring-teal-500/30"
            />
            Signed up but has never signed in
          </label>
        </div>
      )}

      {/* ------------------------------------------- what is narrowing */}
      {active.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t border-line-soft bg-paper-muted px-4 py-3 sm:px-5">
          <span className="text-[11.5px] font-bold uppercase tracking-wide text-ink-faint">Filtering by</span>
          {active.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => onChange({ [key]: null })}
              className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-[12px] font-semibold text-ink shadow-sm transition hover:bg-paper-tint"
            >
              <span className="text-ink-faint">{FILTER_LABELS[key]}:</span>
              {String((query as Record<string, unknown>)[key])}
              <X className="h-3 w-3 text-ink-faint" strokeWidth={3} aria-hidden />
              <span className="sr-only">Remove this filter</span>
            </button>
          ))}
          <button
            type="button"
            onClick={onClear}
            className="ml-auto text-[12px] font-bold text-teal-700 underline-offset-2 hover:underline"
          >
            Clear all
          </button>
        </div>
      )}
    </section>
  );
}
