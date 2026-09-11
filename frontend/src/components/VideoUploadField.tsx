import { useEffect, useRef, useState } from "react";
import type { DragEvent } from "react";
import { Film, Loader2, Trash2, TriangleAlert, Upload } from "lucide-react";
import { deleteUpload, getUploadConfig, uploadVideo } from "../lib/api";

/* ------------------------------------------------------------------ *
 * Uploading an introduction video
 *
 * This replaces a text box that asked for a URL — the same assumption
 * the photo field used to make, and a worse one: almost nobody has an
 * MP4 of themselves hosted anywhere they can link to, so the field
 * stayed empty on every listing whose plan had paid for it.
 *
 * Three things it does that the photo field does not have to:
 *
 *  - It reports progress. A 60MB upload over a domestic connection is
 *    minutes, and fetch cannot report progress, so this goes over XHR.
 *    Without a bar, people press the button again or conclude it is
 *    broken.
 *  - It reads the duration off the file itself once the browser has the
 *    metadata, so nobody has to count the seconds and type them in.
 *  - It plays the stored file back, not a local blob. The preview is
 *    therefore proof the thing on the server actually works, rather
 *    than proof the file on the desk does.
 * ------------------------------------------------------------------ */

export function VideoUploadField({
  label,
  hint,
  value,
  onChange,
  /** Called with the duration the browser read out of the file. */
  onDuration,
  id,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (url: string) => void;
  onDuration?: (seconds: number) => void;
  id: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [percent, setPercent] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [limits, setLimits] = useState<{ maxMb: number; accept: string[] } | null>(null);

  // The cap comes from the server rather than being written twice. If it
  // cannot be fetched the field still works — the server enforces it
  // regardless, and a hint is not worth blocking an upload over.
  useEffect(() => {
    getUploadConfig()
      .then((c) => setLimits(c.video ? { maxMb: c.video.maxMb, accept: c.video.accept } : null))
      .catch(() => setLimits(null));
  }, []);

  async function send(file: File) {
    setError(null);
    // Checked here as well as on the server, so a 400MB file fails
    // instantly rather than after four minutes of uploading.
    if (limits && file.type && !limits.accept.includes(file.type)) {
      setError("That needs to be an MP4, MOV or WebM video.");
      return;
    }
    if (limits && file.size > limits.maxMb * 1024 * 1024) {
      setError(
        `That video is ${(file.size / 1024 / 1024).toFixed(0)}MB. The limit is ${limits.maxMb}MB — try trimming it, or export at a lower resolution.`
      );
      return;
    }
    setBusy(true);
    setPercent(0);
    try {
      const saved = await uploadVideo(file, "intro-video", setPercent);
      // Replacing removes the one it replaced, so a profile edited ten
      // times does not leave ten 60MB orphans on the disk.
      if (value) void deleteUpload(value).catch(() => {});
      onChange(saved.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That upload did not go through. Try again.");
    } finally {
      setBusy(false);
    }
  }

  /**
   * The length, read off the player once it has the file's metadata.
   *
   * Asking somebody to type a duration in seconds is asking them to go
   * and find out something their computer already knows. This reads it
   * from the preview — that is, from the stored file being played back
   * rather than from the local copy, so the number describes what
   * patients will actually get.
   *
   * An earlier version probed a blob: URL of the local file instead,
   * and silently produced nothing, because plenty of containers
   * (WebM among them) report Infinity for duration until enough of the
   * stream has been read. The element that is already loading the file
   * knows the answer and costs nothing extra.
   */
  function captureDuration(el: HTMLVideoElement) {
    if (!onDuration) return;
    const seconds = el.duration;
    if (Number.isFinite(seconds) && seconds > 0) onDuration(Math.round(seconds));
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void send(file);
  }

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
        className={`mt-2.5 rounded-2xl border border-dashed p-4 transition ${
          dragging ? "border-teal-400 bg-teal-50/50" : "border-line bg-paper-muted"
        }`}
      >
        <div className="flex flex-wrap items-start gap-4">
          <div className="aspect-video w-full max-w-[260px] shrink-0 overflow-hidden rounded-xl bg-navy-950 ring-1 ring-line">
            {value ? (
              /* The stored file, played from the server — so what you
                 are looking at is what a patient will get, including
                 whether the format actually plays in a browser. */
              <video
                key={value}
                src={value}
                controls
                preload="metadata"
                onLoadedMetadata={(e) => captureDuration(e.currentTarget)}
                className="h-full w-full object-contain"
              />
            ) : (
              <span className="grid h-full w-full place-items-center text-white/40">
                <Film className="h-7 w-7" strokeWidth={1.5} />
              </span>
            )}
          </div>

          <div className="min-w-[220px] flex-1">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={busy}
                className="flex items-center gap-2 rounded-full bg-navy-950 px-4 py-2 text-[13px] font-bold text-white transition hover:bg-teal-700 disabled:opacity-60"
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />
                ) : (
                  <Upload className="h-4 w-4" strokeWidth={2.5} />
                )}
                {busy ? `Uploading ${percent}%` : value ? "Replace video" : "Upload a video"}
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

            {/* A real bar, not a spinner: on a slow connection the
                difference between "working" and "stuck" is the only
                thing the person wants to know. */}
            {busy && (
              <div
                className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-line-soft"
                role="progressbar"
                aria-valuenow={percent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Upload progress"
              >
                <div
                  className="h-full rounded-full bg-teal-500 transition-[width] duration-200"
                  style={{ width: `${percent}%` }}
                />
              </div>
            )}

            <p className="mt-2 text-[12px] text-ink-faint">
              Drag one here, or choose a file. MP4, MOV or WebM
              {limits ? `, up to ${limits.maxMb}MB` : ""}. A minute is plenty — patients watch the
              first fifteen seconds.
            </p>

            {error && (
              <p className="mt-2 flex items-start gap-1.5 text-[12.5px] font-semibold text-danger">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
                {error}
              </p>
            )}
          </div>
        </div>

        <input
          ref={inputRef}
          id={id}
          type="file"
          accept="video/mp4,video/quicktime,video/webm"
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
