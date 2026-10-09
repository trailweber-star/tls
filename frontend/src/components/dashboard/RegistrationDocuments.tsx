import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, Loader2, ShieldCheck, Trash2, Upload } from "lucide-react";
import { Panel } from "../DashboardShell";
import { documentsApi } from "../../lib/dashboardApi";
import type { StoredDocument } from "../../lib/dashboardApi";

/* ------------------------------------------------------------------ *
 * Registration certificate
 *
 * Optional on purpose: making it compulsory at sign up would turn people
 * away before they have even joined. It is asked for clearly instead,
 * and our team checks it before a profile goes live. Files are private:
 * only the listing owner and our admins can open them.
 * ------------------------------------------------------------------ */

const ACCEPT = "application/pdf,image/jpeg,image/png,image/webp";
const MAX_MB = 8;

export function RegistrationDocuments({ regulatorHint }: { regulatorHint?: string }) {
  const [docs, setDocs] = useState<StoredDocument[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    documentsApi
      .list()
      .then((res) => setDocs(res.documents))
      .catch(() => setDocs([]));
  }, []);
  useEffect(load, [load]);

  async function onPick(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (file.size > MAX_MB * 1024 * 1024) {
      setError(`That file is over ${MAX_MB}MB. Please send a smaller scan or photo.`);
      return;
    }
    setBusy(true);
    try {
      await documentsApi.upload(file);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not upload that file.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  async function remove(id: string) {
    setError(null);
    try {
      await documentsApi.remove(id);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove that file.");
    }
  }

  const has = (docs?.length ?? 0) > 0;

  return (
    <Panel>
      <section id="registration-documents" className="scroll-mt-24">
        <div className="mb-4 flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-teal-50 text-teal-700">
            <ShieldCheck className="h-[18px] w-[18px]" strokeWidth={2} />
          </span>
          <div>
            <h2 className="font-display text-[16px] font-bold text-ink">Registration certificate</h2>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-muted">
              {regulatorHint ?? "Your GDC, GMC or HCPC certificate"} lets us approve your profile faster. Only you and our
              verification team can see it.
            </p>
          </div>
        </div>

        {docs === null ? (
          <p className="text-[13px] text-ink-muted">Loading...</p>
        ) : (
          <ul className="space-y-1.5">
            {docs.map((d) => (
              <li key={d.id} className="flex items-center gap-2.5 rounded-lg bg-paper-muted px-3 py-2.5 text-[12.5px] font-semibold text-ink">
                <FileText className="h-4 w-4 shrink-0 text-ink-faint" strokeWidth={2} />
                <button type="button" onClick={() => documentsApi.open(d.id).catch((e) => setError(e.message))} className="min-w-0 flex-1 truncate text-left hover:underline">
                  {d.name}
                </button>
                <button
                  type="button"
                  onClick={() => remove(d.id)}
                  aria-label={`Remove ${d.name}`}
                  className="shrink-0 rounded-full p-1.5 text-ink-faint transition hover:bg-line-soft hover:text-danger"
                >
                  <Trash2 className="h-4 w-4" strokeWidth={2} />
                </button>
              </li>
            ))}
          </ul>
        )}

        <input
          ref={input}
          id="registration-document-file"
          type="file"
          accept={ACCEPT}
          className="sr-only"
          onChange={(e) => onPick(e.target.files?.[0])}
        />
        <label
          htmlFor="registration-document-file"
          className={`mt-3 inline-flex cursor-pointer items-center gap-2 rounded-full bg-teal-600 px-5 py-2.5 text-[13px] font-bold text-white transition hover:bg-teal-700 ${
            busy ? "pointer-events-none opacity-60" : ""
          }`}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" strokeWidth={2.5} />}
          {busy ? "Uploading..." : has ? "Add another file" : "Upload your certificate"}
        </label>
        <p className="mt-2 text-[12px] text-ink-faint">PDF, JPG, PNG or WebP, up to {MAX_MB}MB.</p>
        {error && (
          <p role="alert" className="mt-2 text-[12.5px] font-semibold text-danger">
            {error}
          </p>
        )}
      </section>
    </Panel>
  );
}
