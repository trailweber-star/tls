import { useEffect, useRef, useState } from "react";
import type { DragEvent } from "react";
import { ImageUp, Loader2, Trash2, TriangleAlert } from "lucide-react";
import { deleteUpload, getUploadConfig, uploadImage } from "../lib/api";

/* ------------------------------------------------------------------ *
 * Uploading a photo
 *
 * This replaces a text box that asked people to paste a URL. That box
 * quietly assumed every specialist already hosts their own headshot
 * somewhere and can find the link — almost nobody does, so almost every
 * listing stayed faceless on a directory where the photograph is most of
 * what a patient chooses on.
 *
 * The file goes straight up on selection rather than on save, so the
 * preview is the real stored image and not a browser-only blob that
 * would vanish if the save failed. The field's value is the URL that
 * comes back, which is what the rest of the form was already built
 * around — nothing downstream had to change.
 * ------------------------------------------------------------------ */

export function ImageUploadField({
  label,
  hint,
  value,
  onChange,
  kind = "image",
  /** "avatar" is a circle for faces; "wide" a 16/9 box for covers. */
  shape = "avatar",
  id,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (url: string) => void;
  kind?: "profile-photo" | "cover" | "gallery" | "logo" | "image" | "article";
  shape?: "avatar" | "wide";
  id: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [limits, setLimits] = useState<{ maxMb: number; accept: string[] } | null>(null);

  // The cap comes from the server rather than being written twice. If it
  // cannot be fetched the field still works — the server enforces it
  // regardless, and a hint is not worth blocking an upload over.
  useEffect(() => {
    getUploadConfig()
      .then((c) => setLimits({ maxMb: c.maxMb, accept: c.accept }))
      .catch(() => setLimits(null));
  }, []);

  async function send(file: File) {
    setError(null);
    if (limits && !limits.accept.includes(file.type)) {
      setError("That needs to be a JPEG, PNG, WebP or GIF.");
      return;
    }
    // Checked here as well as on the server, so a 6MB photo fails in a
    // moment rather than after the whole thing has been sent.
    if (limits && file.size > limits.maxMb * 1024 * 1024) {
      setError(`That image is ${(file.size / 1024 / 1024).toFixed(1)}MB. The limit is ${limits.maxMb}MB.`);
      return;
    }
    setBusy(true);
    try {
      const saved = await uploadImage(file, kind);
      // Replacing a photo removes the one it replaced, so a profile
      // edited ten times does not leave ten orphans on disk.
      if (value) void deleteUpload(value).catch(() => {});
      onChange(saved.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That upload did not go through. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void send(file);
  }

  const preview = shape === "avatar"
    ? "h-24 w-24 rounded-full"
    : "h-28 w-full max-w-[280px] rounded-xl";

  return (
    <div>
      <label htmlFor={id} className="text-[13px] font-bold text-ink">
        {label}
      </label>
      {hint && <p className="mt-0.5 text-[12.5px] text-ink-muted">{hint}</p>}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`mt-2.5 flex flex-wrap items-center gap-4 rounded-2xl border border-dashed p-4 transition ${
          dragging ? "border-teal-400 bg-teal-50/50" : "border-line bg-paper-muted"
        }`}
      >
        <div className={`${preview} shrink-0 overflow-hidden bg-white ring-1 ring-line`}>
          {value ? (
            <img src={value} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="grid h-full w-full place-items-center text-ink-faint">
              <ImageUp className="h-6 w-6" strokeWidth={1.75} />
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
              className="flex items-center gap-2 rounded-full bg-navy-950 px-4 py-2 text-[13px] font-bold text-white transition hover:bg-teal-700 disabled:opacity-60"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />}
              {busy ? "Uploading…" : value ? "Replace photo" : "Upload a photo"}
            </button>
            {value && !busy && (
              <button
                type="button"
                onClick={() => {
                  void deleteUpload(value).catch(() => {});
                  onChange("");
                }}
                className="flex items-center gap-2 rounded-full border border-line bg-white px-4 py-2 text-[13px] font-bold text-ink-muted transition hover:text-danger"
              >
                <Trash2 className="h-4 w-4" strokeWidth={2} />
                Remove
              </button>
            )}
          </div>

          <p className="mt-2 text-[12px] text-ink-faint">
            Drag one here, or choose a file. JPEG, PNG, WebP or GIF
            {limits ? `, up to ${limits.maxMb}MB` : ""}.
          </p>

          {error && (
            <p className="mt-2 flex items-start gap-1.5 text-[12.5px] font-semibold text-danger">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
              {error}
            </p>
          )}
        </div>

        <input
          ref={inputRef}
          id={id}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void send(file);
            // Cleared so picking the same file twice still fires.
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}
