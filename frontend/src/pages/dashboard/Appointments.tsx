import { useCallback, useEffect, useState } from "react";
import { CalendarDays, Check, Loader2, Plus, Trash2, X } from "lucide-react";
import { DashboardShell, Panel } from "../../components/DashboardShell";
import { EmptyState, ErrorBlock, LoadingBlock } from "../../components/dashboard/ui";
import { dashboardApi } from "../../lib/dashboardApi";
import type { Appointment, AvailabilityBlock } from "../../lib/dashboardApi";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function minutesToTime(m: number) {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}
function timeToMinutes(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}
function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const STATUS_TONE: Record<Appointment["status"], string> = {
  pending: "bg-amber/15 text-amber",
  confirmed: "bg-teal-50 text-teal-700",
  cancelled: "bg-paper-tint text-ink-faint",
  completed: "bg-navy-950/8 text-navy-800",
};

export default function Appointments() {
  return (
    <DashboardShell
      title="Appointments"
      subtitle="Set the hours you consult, and patients can book straight from your profile — no phone tag."
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,420px)_1fr]">
        <AvailabilityEditor />
        <UpcomingBookings />
      </div>
    </DashboardShell>
  );
}

/* ------------------------------------------------------------------ *
 * Weekly availability
 * ------------------------------------------------------------------ */
function AvailabilityEditor() {
  const [blocks, setBlocks] = useState<AvailabilityBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await dashboardApi.availability();
      setBlocks(res.results);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load your availability");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function addBlock(weekday: number) {
    setSaved(false);
    setBlocks((b) => [...b, { weekday, startMinute: 9 * 60, endMinute: 17 * 60 }]);
  }
  function removeBlock(index: number) {
    setSaved(false);
    setBlocks((b) => b.filter((_, i) => i !== index));
  }
  function updateBlock(index: number, patch: Partial<AvailabilityBlock>) {
    setSaved(false);
    setBlocks((b) => b.map((blk, i) => (i === index ? { ...blk, ...patch } : blk)));
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await dashboardApi.setAvailability(blocks);
      setBlocks(res.results);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your availability");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel title="Weekly hours">
      {loading ? (
        <LoadingBlock label="Loading your hours…" />
      ) : (
        <>
          <div className="space-y-4">
            {WEEKDAYS.map((label, weekday) => {
              const dayBlocks = blocks
                .map((b, i) => ({ ...b, index: i }))
                .filter((b) => b.weekday === weekday);
              return (
                <div key={label}>
                  <div className="flex items-center justify-between">
                    <p className="text-[12.5px] font-bold text-ink">{label}</p>
                    <button
                      type="button"
                      onClick={() => addBlock(weekday)}
                      className="inline-flex items-center gap-1 text-[11.5px] font-bold text-teal-700 hover:text-teal-800"
                    >
                      <Plus className="h-3.5 w-3.5" strokeWidth={3} />
                      Add hours
                    </button>
                  </div>
                  {dayBlocks.length === 0 ? (
                    <p className="mt-1 text-[12px] text-ink-faint">Not consulting</p>
                  ) : (
                    <div className="mt-1.5 space-y-1.5">
                      {dayBlocks.map((b) => (
                        <div key={b.index} className="flex items-center gap-2">
                          <input
                            type="time"
                            value={minutesToTime(b.startMinute)}
                            onChange={(e) => updateBlock(b.index, { startMinute: timeToMinutes(e.target.value) })}
                            className="rounded-lg border border-line bg-white px-2 py-1.5 text-[12.5px] text-ink outline-none focus:border-teal-500"
                          />
                          <span className="text-[12px] text-ink-faint">to</span>
                          <input
                            type="time"
                            value={minutesToTime(b.endMinute)}
                            onChange={(e) => updateBlock(b.index, { endMinute: timeToMinutes(e.target.value) })}
                            className="rounded-lg border border-line bg-white px-2 py-1.5 text-[12.5px] text-ink outline-none focus:border-teal-500"
                          />
                          <button
                            type="button"
                            onClick={() => removeBlock(b.index)}
                            aria-label="Remove this block"
                            className="ml-auto text-ink-faint transition hover:text-danger"
                          >
                            <Trash2 className="h-4 w-4" strokeWidth={2} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {error && (
            <p role="alert" className="mt-4 text-[12.5px] font-semibold text-danger">
              {error}
            </p>
          )}

          <div className="mt-5 flex items-center gap-3 border-t border-line-soft pt-4">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-full bg-teal-600 px-5 py-2.5 text-[13px] font-bold text-white transition hover:bg-teal-700 disabled:opacity-40"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" strokeWidth={2.5} />}
              {saving ? "Saving…" : "Save hours"}
            </button>
            {saved && !saving && <span className="text-[12.5px] font-semibold text-teal-700">Saved</span>}
          </div>
        </>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------ *
 * Bookings
 * ------------------------------------------------------------------ */
function UpcomingBookings() {
  const [rows, setRows] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await dashboardApi.appointments({ from: new Date().toISOString() });
      setRows(res.results);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load your appointments");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function setStatus(id: string, status: Appointment["status"]) {
    setUpdatingId(id);
    try {
      const res = await dashboardApi.updateAppointmentStatus(id, status);
      setRows((r) => r.map((row) => (row.id === id ? res.appointment : row)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update that booking");
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <Panel title="Upcoming bookings" padded={rows.length === 0}>
      {loading && <LoadingBlock label="Loading your appointments…" />}
      {error && !loading && <ErrorBlock message={error} onRetry={load} />}
      {!loading && !error && rows.length === 0 && (
        <EmptyState
          icon={CalendarDays}
          title="Nothing booked yet"
          body="Once you set your weekly hours, patients can book a slot straight from your profile and it will show up here."
        />
      )}
      {!loading && !error && rows.length > 0 && (
        <ul className="divide-y divide-line-soft">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
              <div className="min-w-0">
                <p className="text-[13.5px] font-bold text-ink">{row.patientName}</p>
                <p className="mt-0.5 text-[12.5px] text-ink-muted">{formatDateTime(row.startsAt)}</p>
                {(row.patientEmail || row.patientPhone) && (
                  <p className="mt-0.5 text-[11.5px] text-ink-faint">
                    {[row.patientEmail, row.patientPhone].filter(Boolean).join(" · ")}
                  </p>
                )}
                {row.notes && <p className="mt-1 text-[12px] italic text-ink-muted">“{row.notes}”</p>}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span
                  className={`rounded-full px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-wide ${STATUS_TONE[row.status]}`}
                >
                  {row.status}
                </span>
                {row.status === "pending" || row.status === "confirmed" ? (
                  <>
                    {row.status === "pending" && (
                      <button
                        type="button"
                        disabled={updatingId === row.id}
                        onClick={() => setStatus(row.id, "confirmed")}
                        className="rounded-full bg-teal-600 p-1.5 text-white transition hover:bg-teal-700 disabled:opacity-40"
                        aria-label="Confirm"
                      >
                        <Check className="h-3.5 w-3.5" strokeWidth={3} />
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={updatingId === row.id}
                      onClick={() => setStatus(row.id, "cancelled")}
                      className="rounded-full bg-paper-tint p-1.5 text-ink-muted transition hover:bg-danger/10 hover:text-danger disabled:opacity-40"
                      aria-label="Cancel"
                    >
                      <X className="h-3.5 w-3.5" strokeWidth={3} />
                    </button>
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
