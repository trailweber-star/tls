/* ------------------------------------------------------------------ *
 * Inbound mail — Resend's webhook
 *
 * Outbound has always had a home (lib/mailer.js). Inbound didn't: mail
 * arriving at the domain had nowhere to go but a mailbox nobody in the
 * app ever looks at. This is the other half — one webhook, signed the
 * same careful way as the billing and ClinWell webhooks, that turns
 * "someone emailed us" into the same admin notification (bell + email +
 * push, via lib/notifications.js) that every other piece of admin work
 * already raises. No new inbox UI, no threading model: an admin sees
 * "New email: <subject>" in the same place they see a pending
 * application, and replies from their own mail client like they always
 * have. Simplest thing that is actually useful.
 *
 * Also handles the two delivery-health events worth an admin's
 * attention — a bounce or a spam complaint — because they arrive on the
 * same webhook once subscribed to, and a bounced or complained-about
 * address quietly degrades the sending domain's reputation for every
 * other member if nobody ever finds out.
 *
 * Setup (Resend dashboard):
 *   1. Emails → Receiving → add the MX record to your verified domain.
 *   2. Webhooks → Add endpoint → `${SITE_URL}/api/mail/inbound`,
 *      subscribed to email.received, email.bounced, email.complained.
 *   3. Copy the signing secret into RESEND_WEBHOOK_SECRET.
 * See .env.example for the full walkthrough.
 * ------------------------------------------------------------------ */
import { isDbConfigured } from "../config/db.js";
import { users as userRepo } from "../db/repos.js";
import { demoAccounts } from "../data/accounts.js";
import { NOTIFICATION_TYPES, notifyAdmins } from "../lib/notifications.js";
import { secretsFrom, verify as verifyResendSignature } from "../lib/resendSignature.js";

async function activeAdmins() {
  return isDbConfigured()
    ? await userRepo.admins()
    : demoAccounts.all().filter((u) => u.role === "admin" && u.active);
}

function snippet(text, max = 280) {
  const s = String(text ?? "")
    .trim()
    .replace(/\s+/g, " ");
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Resend's from/to fields show up as a string in some payload shapes and
    an { text, address } object in others — read either without throwing. */
function addressText(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(addressText).filter(Boolean).join(", ");
  return value.text ?? value.address ?? value.email ?? "";
}

function stripHtml(html) {
  return String(html ?? "").replace(/<[^>]+>/g, " ");
}

/**
 * POST /api/mail/inbound
 *
 * One endpoint, three event types handled, everything else acknowledged
 * and otherwise ignored (delivered/opened/clicked are noise an admin
 * does not need a bell for). Always answers 200 once the signature is
 * good, even if the event type is one we skip — Resend retries a
 * non-2xx delivery, and there is nothing to gain from being retried for
 * an event we were never going to act on.
 */
export async function handleInboundMail(req, res) {
  const secrets = secretsFrom("RESEND_WEBHOOK_SECRET", "RESEND_WEBHOOK_SECRET_PREVIOUS");
  if (secrets.length === 0) {
    console.error("[mail] inbound webhook received but RESEND_WEBHOOK_SECRET is not set — refusing");
    return res.status(503).json({ error: "Inbound mail is not configured" });
  }

  const result = verifyResendSignature(req.rawBody ?? JSON.stringify(req.body ?? {}), req.headers, secrets);
  if (!result.ok) {
    console.error(`[mail] rejected an unverified inbound webhook: ${result.reason}`);
    return res.status(401).json({ error: "Signature verification failed" });
  }

  const event = req.body ?? {};
  const data = event.data ?? {};

  try {
    if (event.type === "email.received") {
      const from = addressText(data.from) || "an unknown sender";
      const to = addressText(data.to);
      const subject = data.subject || "(no subject)";
      const body = data.text || stripHtml(data.html);

      const admins = await activeAdmins();
      await notifyAdmins(admins, {
        type: NOTIFICATION_TYPES.INBOUND_MAIL,
        title: `New email: ${subject}`,
        body: `From ${from}${to ? ` to ${to}` : ""} — ${snippet(body) || "(no message body)"}`,
        url: null,
        subjectId: event.id ?? null,
        key: `${NOTIFICATION_TYPES.INBOUND_MAIL}:${event.id ?? `${from}:${subject}:${Date.now()}`}`,
      });
    } else if (event.type === "email.bounced" || event.type === "email.complained") {
      const to = addressText(data.to) || "an unknown address";
      const bounced = event.type === "email.bounced";
      const admins = await activeAdmins();
      await notifyAdmins(admins, {
        type: NOTIFICATION_TYPES.MAIL_BOUNCED,
        title: bounced ? `Email bounced: ${to}` : `Marked as spam: ${to}`,
        body: bounced
          ? `A message to ${to} bounced${data.subject ? ` ("${data.subject}")` : ""}. Worth checking the address is still correct before sending it more mail.`
          : `${to} marked a message from us as spam${data.subject ? ` ("${data.subject}")` : ""}. Consider whether they should keep receiving mail.`,
        url: null,
        subjectId: event.id ?? null,
        key: `${NOTIFICATION_TYPES.MAIL_BOUNCED}:${event.id ?? `${to}:${Date.now()}`}`,
      });
    }
    // Anything else (email.delivered, email.opened, email.clicked, …) is
    // acknowledged below and otherwise ignored on purpose.
  } catch (err) {
    /* Never let a downstream failure turn into a retry storm: a bug in
       notify() must not turn one inbound email into Resend retrying the
       same webhook delivery forever. Logged, not thrown. */
    console.error("[mail] failed to process inbound webhook:", err?.message ?? err);
  }

  res.json({ received: true });
}
