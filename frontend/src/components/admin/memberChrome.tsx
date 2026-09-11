import { useEffect, useState } from "react";
import type { VerificationStatus } from "../../lib/dashboardApi";
import { initials } from "../dashboard/ui";

/* ------------------------------------------------------------------ *
 * The vocabulary of a member's state
 *
 * Defined once, here, because the same six statuses appear as tabs, row
 * badges, drawer chips and bulk-action confirmations — and a label that
 * said "Approved" in one place and "Verified" in another would make an
 * administrator hesitate over whether they are the same thing.
 *
 * These mirror MEMBER_STATUSES in the API's members controller.
 * ------------------------------------------------------------------ */

export const MEMBER_STATUS_LABEL: Record<VerificationStatus, string> = {
  pending: "Awaiting review",
  info_requested: "Info requested",
  verified: "Approved",
  unverified: "Unclaimed",
  rejected: "Rejected",
  suspended: "Suspended",
};

const TONE: Record<VerificationStatus, string> = {
  pending: "bg-amber/15 text-amber",
  info_requested: "bg-amber/15 text-amber",
  verified: "bg-teal-50 text-teal-700",
  unverified: "bg-paper-tint text-ink-muted",
  rejected: "bg-danger/10 text-danger",
  suspended: "bg-danger/10 text-danger",
};

/**
 * A member's picture, or their initials when there isn't one.
 *
 * The fallback is on the error as well as on the absence. Imported
 * listings carry a photo URL from somebody else's site, and those
 * sometimes 404 or get hot-link blocked — which left an empty ring in
 * the table where a face should be, looking like a bug in the page
 * rather than a dead link on another server.
 */
export function MemberAvatar({
  photoUrl,
  fullName,
  size = 36,
  className = "",
}: {
  photoUrl: string | null;
  fullName: string | null | undefined;
  size?: number;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  // A different member in the same row position starts fresh.
  useEffect(() => setBroken(false), [photoUrl]);

  const box = { width: size, height: size };

  if (!photoUrl || broken) {
    return (
      <span
        style={box}
        className={`grid shrink-0 place-items-center rounded-full bg-paper-tint font-bold text-ink-muted ${className}`}
      >
        <span style={{ fontSize: Math.max(10, Math.round(size / 3)) }}>{initials(fullName)}</span>
      </span>
    );
  }

  return (
    <img
      src={photoUrl}
      alt=""
      loading="lazy"
      style={box}
      onError={() => setBroken(true)}
      className={`shrink-0 rounded-full object-cover ring-1 ring-line-soft ${className}`}
    />
  );
}

export function StatusChip({ status }: { status: VerificationStatus }) {
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-wide ${
        TONE[status] ?? "bg-paper-tint text-ink-muted"
      }`}
    >
      {MEMBER_STATUS_LABEL[status] ?? status}
    </span>
  );
}

/**
 * Plain-English names for the actions the server records against a
 * member. Shared by the activity log and the record drawer, so the same
 * event is never called "impersonate.start" in one place and "Started a
 * support session" in the other.
 */
export const ADMIN_ACTION_LABEL: Record<string, string> = {
  "impersonate.start": "Started a support session",
  "impersonate.stop": "Ended a support session",
  "member.approve": "Approved a listing",
  "member.hold": "Put a listing on hold",
  "member.request-info": "Requested more information",
  "member.reject": "Rejected a listing",
  "member.suspend": "Suspended a listing",
  "member.deactivate-account": "Deactivated an account",
  "member.reactivate-account": "Reactivated an account",
  "member.tag": "Added a tag",
  "member.untag": "Removed a tag",
  "member.annotate": "Edited internal notes",
  "member.export": "Exported the members list",
};
