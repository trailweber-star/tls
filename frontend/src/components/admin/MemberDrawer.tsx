import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ExternalLink,
  Globe,
  History,
  LogIn,
  Mail,
  MapPin,
  Phone,
  Save,
  Star,
  Tag as TagIcon,
  X,
} from "lucide-react";
import { membersApi } from "../../lib/dashboardApi";
import type { AuditEntry, MemberRow } from "../../lib/dashboardApi";
import { ErrorBlock, LoadingBlock, relativeTime } from "../dashboard/ui";
import { ADMIN_ACTION_LABEL, MemberAvatar, StatusChip } from "./memberChrome";

/* ------------------------------------------------------------------ *
 * One member, opened
 *
 * A side panel rather than a page, so the list keeps its filter, its
 * scroll position and its selection while an administrator checks one
 * row and moves on. Everything in here is either a fact used to decide
 * (where they signed up from, whether they ever came back, where the
 * listing came from) or an act on that decision.
 * ------------------------------------------------------------------ */

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-bold uppercase tracking-wide text-ink-faint">{label}</dt>
      <dd className="mt-0.5 break-words text-[13px] text-ink">{children}</dd>
    </div>
  );
}

const dash = (v: React.ReactNode) => (v === null || v === undefined || v === "" ? <span className="text-ink-faint">—</span> : v);

export function MemberDrawer({
  memberId,
  onClose,
  onChanged,
  onImpersonate,
}: {
  memberId: string | null;
  onClose: () => void;
  /** Something in here changed the record; the list should reload. */
  onChanged: () => void;
  onImpersonate: (member: MemberRow) => void;
}) {
  const [member, setMember] = useState<MemberRow | null>(null);
  const [history, setHistory] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [notes, setNotes] = useState("");
  const [tagDraft, setTagDraft] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    if (!memberId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await membersApi.get(memberId);
      setMember(res.member);
      setHistory(res.history ?? []);
      setNotes(res.member.adminNotes ?? "");
      setTags(res.member.tags ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load this member");
    } finally {
      setLoading(false);
    }
  }, [memberId]);

  useEffect(() => {
    setSaved(false);
    load();
  }, [load]);

  // Escape closes, and the page behind stops scrolling while it is open.
  useEffect(() => {
    if (!memberId) return;
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [memberId, onClose]);

  if (!memberId) return null;

  async function save() {
    if (!member) return;
    setSaving(true);
    setError(null);
    try {
      await membersApi.annotate(member.id, { adminNotes: notes, tags });
      setSaved(true);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  function addTag() {
    const value = tagDraft.trim();
    if (!value || tags.includes(value)) return setTagDraft("");
    setTags([...tags, value]);
    setTagDraft("");
    setSaved(false);
  }

  return (
    <div className="fixed inset-0 z-[60] flex justify-end">
      <button
        type="button"
        aria-label="Close member details"
        onClick={onClose}
        className="absolute inset-0 bg-navy-950/60 backdrop-blur-[2px]"
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label={member ? `${member.fullName} — member record` : "Member record"}
        className="relative flex h-full w-full max-w-[520px] flex-col overflow-y-auto bg-paper shadow-2xl"
      >
        <header className="sticky top-0 z-10 flex items-start gap-3 border-b border-line-soft bg-paper/95 px-5 py-4 backdrop-blur">
          <MemberAvatar photoUrl={member?.photoUrl ?? null} fullName={member?.fullName} size={44} />
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-display text-[17px] font-bold text-ink">
              {member?.fullName ?? "Loading…"}
            </h2>
            <p className="truncate text-[12.5px] text-ink-muted">
              {[member?.title, member?.specialty].filter(Boolean).join(" · ") || "—"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-ink-faint transition hover:bg-paper-tint hover:text-ink"
          >
            <X className="h-4 w-4" strokeWidth={2.5} />
          </button>
        </header>

        <div className="flex-1 px-5 py-5">
          {loading && <LoadingBlock label="Loading member…" />}
          {error && !loading && <ErrorBlock message={error} onRetry={load} />}

          {member && !loading && (
            <div className="space-y-6">
              {/* ------------------------------------------- state */}
              <div className="flex flex-wrap items-center gap-2">
                <StatusChip status={member.verificationStatus} />
                <span className="rounded-full bg-paper-tint px-2.5 py-1 text-[11px] font-bold text-ink-muted">
                  {member.planName}
                </span>
                {member.accountActive === false && (
                  <span className="rounded-full bg-danger/10 px-2.5 py-1 text-[11px] font-bold text-danger">
                    Account deactivated
                  </span>
                )}
                {!member.claimed && (
                  <span className="rounded-full bg-paper-tint px-2.5 py-1 text-[11px] font-bold text-ink-muted">
                    Unclaimed
                  </span>
                )}
                {member.awaitingActivation && (
                  <span className="rounded-full bg-amber/15 px-2.5 py-1 text-[11px] font-bold text-amber">
                    Awaiting activation
                  </span>
                )}
              </div>

              {/* ------------------------------------------ actions */}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={!member.canImpersonate}
                  onClick={() => onImpersonate(member)}
                  title={
                    member.canImpersonate
                      ? undefined
                      : "There is no active account behind this listing to sign in as"
                  }
                  className="inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-[12.5px] font-bold text-white transition hover:bg-ink/90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <LogIn className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
                  Sign in as this member
                </button>
                <Link
                  to={`/admin/verifications?status=${member.verificationStatus}&open=${member.id}`}
                  className="inline-flex items-center gap-2 rounded-full bg-paper-tint px-4 py-2 text-[12.5px] font-bold text-ink-muted transition hover:bg-line-soft"
                >
                  Review application
                </Link>
                <a
                  href={`/specialists/${member.slug}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-full bg-paper-tint px-4 py-2 text-[12.5px] font-bold text-ink-muted transition hover:bg-line-soft"
                >
                  <ExternalLink className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
                  Public profile
                </a>
              </div>

              {/* ------------------------------------------ the facts */}
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-2xl bg-white p-4 shadow-sm">
                <Field label="Email">
                  {member.email ? (
                    /* max-w-full + min-w-0 + break-all, because an
                       inline-flex box sizes to its content: without a
                       width constraint the `truncate` that used to be on
                       the span could never engage, and an imported
                       address like
                       wv1-dental-implant-clinic@unclaimed.toplocalspecialists.com
                       -- 58 characters with no spaces -- ran straight out
                       of its grid column and printed on top of the phone
                       number. Wrapping rather than truncating because an
                       administrator needs to read and copy the whole
                       address, not hover to discover it. */
                    <a
                      className="inline-flex max-w-full items-start gap-1.5 text-teal-700 hover:underline"
                      href={`mailto:${member.email}`}
                    >
                      <Mail className="mt-[3px] h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
                      <span className="min-w-0 break-all">{member.email}</span>
                    </a>
                  ) : (
                    dash(null)
                  )}
                </Field>
                <Field label="Phone">
                  {member.contactPhone ? (
                    <span className="inline-flex max-w-full items-start gap-1.5">
                      <Phone className="mt-[3px] h-3.5 w-3.5 shrink-0 text-ink-faint" strokeWidth={2} aria-hidden />
                      <span className="min-w-0 break-all">{member.contactPhone}</span>
                    </span>
                  ) : (
                    dash(null)
                  )}
                </Field>
                <Field label="Location">
                  <span className="inline-flex items-start gap-1.5">
                    <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-faint" strokeWidth={2} aria-hidden />
                    <span>{member.address ? `${member.address}` : dash(member.city)}</span>
                  </span>
                </Field>
                <Field label="Qualifications">{dash(member.qualifications)}</Field>
                <Field label="Joined">{member.joinedAt ? new Date(member.joinedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : dash(null)}</Field>
                <Field label="Last signed in">
                  {member.lastLoginAt ? relativeTime(member.lastLoginAt) : <span className="text-amber">Never</span>}
                </Field>
                <Field label="Signed up from">
                  <span className="inline-flex items-center gap-1.5">
                    {member.signupCountry && (
                      <span className="rounded bg-paper-tint px-1.5 py-0.5 text-[10.5px] font-bold text-ink-muted">
                        {member.signupCountry}
                      </span>
                    )}
                    <span className="font-mono text-[12px]">{dash(member.signupIp)}</span>
                  </span>
                </Field>
                <Field label="Last seen from">
                  <span className="inline-flex items-center gap-1.5">
                    {member.lastLoginCountry && (
                      <span className="rounded bg-paper-tint px-1.5 py-0.5 text-[10.5px] font-bold text-ink-muted">
                        {member.lastLoginCountry}
                      </span>
                    )}
                    <span className="font-mono text-[12px]">{dash(member.lastLoginIp)}</span>
                  </span>
                </Field>
                <Field label="Rating">
                  {member.ratingCount ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Star className="h-3.5 w-3.5 fill-amber text-amber" strokeWidth={2} aria-hidden />
                      {member.ratingAvg.toFixed(1)}
                      <span className="text-ink-faint">({member.ratingCount})</span>
                    </span>
                  ) : (
                    dash(null)
                  )}
                </Field>
                <Field label="Listing came from">
                  {member.sourceName ? (
                    member.sourceUrl ? (
                      <a
                        href={member.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 text-teal-700 hover:underline"
                      >
                        <Globe className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                        {member.sourceName}
                      </a>
                    ) : (
                      member.sourceName
                    )
                  ) : (
                    "Signed up here"
                  )}
                </Field>
              </dl>

              {/* ----------------------------------- notes and tags */}
              <section className="rounded-2xl bg-white p-4 shadow-sm">
                <h3 className="font-display text-[14px] font-bold text-ink">Internal notes</h3>
                <p className="mt-0.5 text-[12px] text-ink-muted">
                  Only administrators see this. Never shown on the public profile.
                </p>

                <textarea
                  value={notes}
                  onChange={(e) => {
                    setNotes(e.target.value);
                    setSaved(false);
                  }}
                  rows={4}
                  placeholder="Spoke to the practice manager on the 4th; registration certificate to follow."
                  className="mt-3 w-full rounded-xl border border-line-soft bg-paper px-3 py-2 text-[13px] text-ink outline-none transition placeholder:text-ink-faint focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
                />

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1.5 rounded-full bg-teal-50 px-2.5 py-1 text-[11.5px] font-bold text-teal-700"
                    >
                      <TagIcon className="h-3 w-3" strokeWidth={2.5} aria-hidden />
                      {tag}
                      <button
                        type="button"
                        onClick={() => {
                          setTags(tags.filter((t) => t !== tag));
                          setSaved(false);
                        }}
                        aria-label={`Remove tag ${tag}`}
                        className="text-teal-700/60 transition hover:text-teal-900"
                      >
                        <X className="h-3 w-3" strokeWidth={3} />
                      </button>
                    </span>
                  ))}
                  <input
                    value={tagDraft}
                    onChange={(e) => setTagDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addTag();
                      }
                    }}
                    onBlur={addTag}
                    placeholder="Add a tag…"
                    aria-label="Add a tag"
                    className="min-w-[120px] flex-1 rounded-full border border-dashed border-line-soft bg-paper px-3 py-1.5 text-[12.5px] outline-none focus:border-teal-500"
                  />
                </div>

                <div className="mt-3 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={save}
                    disabled={saving || !member.userId}
                    title={member.userId ? undefined : "This listing has no account to annotate yet"}
                    className="inline-flex items-center gap-2 rounded-full bg-teal-600 px-4 py-2 text-[12.5px] font-bold text-white transition hover:bg-teal-700 disabled:opacity-40"
                  >
                    <Save className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
                    {saving ? "Saving…" : "Save notes and tags"}
                  </button>
                  {saved && <span className="text-[12.5px] font-semibold text-teal-700">Saved.</span>}
                </div>
              </section>

              {/* -------------------------------------------- history */}
              <section className="rounded-2xl bg-white p-4 shadow-sm">
                <h3 className="flex items-center gap-2 font-display text-[14px] font-bold text-ink">
                  <History className="h-4 w-4 text-ink-faint" strokeWidth={2} aria-hidden />
                  Administrator actions
                </h3>
                {history.length === 0 ? (
                  <p className="mt-2 text-[12.5px] text-ink-muted">
                    Nothing recorded against this member yet.
                  </p>
                ) : (
                  <ol className="mt-3 space-y-3">
                    {history.map((entry) => (
                      <li key={entry.id} className="border-l-2 border-line-soft pl-3">
                        <p className="text-[12.5px] font-bold text-ink">{ADMIN_ACTION_LABEL[entry.action] ?? entry.action}</p>
                        <p className="text-[12px] text-ink-muted">
                          {entry.actorName} · {relativeTime(entry.createdAt)}
                          {entry.ip && <span className="font-mono text-ink-faint"> · {entry.ip}</span>}
                        </p>
                        {entry.detail && typeof entry.detail === "object" && "note" in entry.detail && entry.detail.note ? (
                          <p className="mt-0.5 text-[12px] italic text-ink-muted">“{String(entry.detail.note)}”</p>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
