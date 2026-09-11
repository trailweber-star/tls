/* ------------------------------------------------------------------ *
 * Outbound email
 *
 * One place the whole application sends mail from, and one shape every
 * caller uses: sendMail({ to, replyTo, subject, text }).
 *
 * Everything below that line — which provider, how it authenticates,
 * whether it is even switched on — is decided here from environment
 * variables at boot. Nothing else in the codebase knows or cares. That
 * means going live is a change to .env and a restart, not a change to
 * ten controllers.
 *
 * Supported without touching any code:
 *
 *   SMTP        SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS   (any host:
 *               Gmail, Microsoft 365, Zoho, Fastmail, IONOS, SES SMTP…)
 *   Resend      RESEND_API_KEY
 *   Postmark    POSTMARK_SERVER_TOKEN
 *   SendGrid    SENDGRID_API_KEY
 *   Mailgun     MAILGUN_API_KEY + MAILGUN_DOMAIN
 *   (none)      messages are logged to the console — the development
 *               default, so every flow can be walked end to end without
 *               a mail account attached.
 *
 * Two rules hold whatever is configured.
 *
 * Delivery never takes the request down with it. send() resolves with
 * { sent: false, reason } rather than throwing, because a patient's
 * enquiry must be recorded even when the mail provider is having a bad
 * afternoon.
 *
 * And nothing is sent quietly. Every attempt — sent, skipped or failed —
 * is written to a small in-memory log the admin dashboard reads, so
 * "did that approval email actually go out?" has an answer that is not
 * "check the server logs".
 * ------------------------------------------------------------------ */

/* Read at call time, not at import.
   Two reasons, and the second is the important one: a test can set a
   guard and see it take effect, and an operator who fixes MAIL_ALLOWLIST
   in a hurry gets the fix on the next message rather than after a
   restart. These are read once per send — the cost is nothing. */
const env = (key, fallback = null) => process.env[key] || fallback;

const from = () => env("MAIL_FROM", "Top Local Specialists <no-reply@toplocalspecialists.com>");
const defaultReplyTo = () => env("MAIL_REPLY_TO");
const bcc = () => env("MAIL_BCC");

/* Staging guards. Both exist so a real provider can be pointed at a
   staging copy of the database without emailing real clinicians:

   MAIL_REDIRECT_TO   every message goes to this address instead, with
                      the intended recipient named in the subject.
   MAIL_ALLOWLIST     comma-separated addresses or domains; anything
                      else is skipped rather than sent. */
const redirectTo = () => env("MAIL_REDIRECT_TO");
const allowlist = () =>
  (process.env.MAIL_ALLOWLIST || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

/* Addresses that are reserved by standard and can never receive mail.
   The demo data is full of them, and a provider that is handed a few
   hundred of these will start counting them as bounces against the
   sending domain's reputation — which is a real cost for a fake
   recipient. Set MAIL_ALLOW_EXAMPLE=1 to send anyway. */
const UNDELIVERABLE = /@(example\.(com|org|net)|.*\.(test|invalid|localhost|local))$/i;
const allowExample = () => process.env.MAIL_ALLOW_EXAMPLE === "1";

/* ------------------------------------------------------------ the log */

const LOG_LIMIT = 50;
const log = [];

function record(entry) {
  log.unshift({ at: new Date().toISOString(), ...entry });
  if (log.length > LOG_LIMIT) log.length = LOG_LIMIT;
}

/** The most recent attempts, newest first. Never includes message bodies. */
export function recentMail(limit = 20) {
  return log.slice(0, Math.max(1, Math.min(LOG_LIMIT, limit)));
}

/* -------------------------------------------------------- the seam */

let mailer = null;
let providerName = "console";

/**
 * Register the real sender: async ({ to, replyTo, subject, text, html }).
 * Exported because tests and scripts substitute their own, and because
 * a provider this file does not know about can still be wired in from
 * server.js in one line.
 */
export function setMailer(fn, name = "custom") {
  mailer = fn;
  providerName = fn ? name : "console";
}

export function hasMailer() {
  return typeof mailer === "function";
}

export function mailProviderName() {
  return providerName;
}

/** Everything the admin dashboard needs to say what mail is doing. */
export function mailerStatus() {
  const dayAgo = Date.now() - 86400000;
  const recent = log.filter((e) => new Date(e.at).getTime() > dayAgo);
  return {
    configured: hasMailer(),
    provider: providerName,
    from: from(),
    replyTo: defaultReplyTo(),
    redirectTo: redirectTo(),
    allowlist: allowlist(),
    sent24h: recent.filter((e) => e.ok).length,
    failed24h: recent.filter((e) => !e.ok && e.reason !== "skipped").length,
    skipped24h: recent.filter((e) => e.reason === "skipped").length,
    lastAttempt: log[0] ?? null,
    lastSuccess: log.find((e) => e.ok) ?? null,
    lastFailure: log.find((e) => !e.ok && e.reason !== "skipped") ?? null,
  };
}

/* ------------------------------------------------------ the wrapper */

const SITE_URL = process.env.SITE_URL || "http://localhost:5173";

/**
 * The plain-text message, wrapped in a plain HTML one.
 *
 * Deliberately austere: a table-free, image-free, single-column layout
 * that renders the same in Outlook, Gmail and Apple Mail, with the text
 * part carried alongside. Clinical correspondence that arrives looking
 * like a marketing blast gets treated like one.
 */
function toHtml({ subject, text }) {
  const escape = (s) =>
    String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const body = escape(text ?? "")
    .split(/\n{2,}/)
    .map((para) => {
      const linked = para
        .split("\n")
        .map((line) =>
          /* Trailing punctuation is sentence, not URL. Without this the
             full stop after a link becomes part of the href and the link
             404s — a small bug that would show up in every approval
             email ever sent. */
          line.replace(/(https?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]])/g, '<a href="$1" style="color:#0a6f66">$1</a>')
        )
        .join("<br>");
      return `<p style="margin:0 0 14px;line-height:1.6">${linked}</p>`;
    })
    .join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escape(subject)}</title></head>
<body style="margin:0;padding:24px 12px;background:#f4f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0b1220">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:14px;padding:28px 26px">
    <p style="margin:0 0 20px;font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#0a6f66">
      Top Local Specialists
    </p>
    <div style="font-size:15px;color:#243447">${body}</div>
    <p style="margin:24px 0 0;padding-top:16px;border-top:1px solid #e8eef4;font-size:12px;line-height:1.6;color:#8998a8">
      Sent by Top Local Specialists · <a href="${SITE_URL}" style="color:#0a6f66">${SITE_URL.replace(/^https?:\/\//, "")}</a><br>
      TopLocalSpecialists.com Limited, 27 New Road, Bromsgrove B60 2JL
    </p>
  </div>
</body></html>`;
}

/** Decide whether this address may be written to at all. */
function gate(to) {
  if (!to) return { ok: false, reason: "no-recipient" };
  const address = String(to).toLowerCase();

  if (!allowExample() && UNDELIVERABLE.test(address)) {
    return { ok: false, reason: "skipped", detail: "reserved test address" };
  }
  const list = allowlist();
  if (list.length > 0) {
    const allowed = list.some((entry) =>
      entry.startsWith("@") ? address.endsWith(entry) : address === entry
    );
    if (!allowed) return { ok: false, reason: "skipped", detail: "not on MAIL_ALLOWLIST" };
  }
  return { ok: true };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Send one message.
 *
 * Retries once. Most delivery failures are a momentary refusal — a rate
 * limit, a dropped connection — and one retry a second later clears them
 * without the complexity of a queue. Anything that fails twice is logged
 * and reported rather than retried forever.
 */
export async function sendMail({ to, replyTo, subject, text, html }) {
  const started = Date.now();
  const allowed = gate(to);

  if (!allowed.ok && allowed.reason === "no-recipient") {
    return { sent: false, reason: "no-recipient" };
  }
  if (!allowed.ok) {
    record({ to, subject, provider: providerName, ok: false, reason: "skipped", detail: allowed.detail });
    console.log(`[mail] skipped (${allowed.detail}): ${to} — "${subject}"`);
    return { sent: false, reason: "skipped", detail: allowed.detail };
  }

  const redirect = redirectTo();
  const recipient = redirect || to;
  const line = redirect ? `[for ${to}] ${subject}` : subject;
  const message = {
    from: from(),
    to: recipient,
    replyTo: replyTo || defaultReplyTo() || undefined,
    bcc: bcc() || undefined,
    subject: line,
    text,
    html: html ?? toHtml({ subject: line, text }),
  };

  if (!mailer) {
    /* Development: print it, record it, and tell the caller honestly
       that nothing left the building. */
    console.log(
      `[mail] (not sent — no provider configured)\n  to: ${recipient}\n  reply-to: ${message.replyTo ?? "-"}\n  subject: ${line}\n  ${String(text ?? "").split("\n").join("\n  ")}`
    );
    record({ to: recipient, subject: line, provider: "console", ok: false, reason: "no-provider" });
    return { sent: false, reason: "no-mailer-configured" };
  }

  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const result = await mailer(message);
      record({
        to: recipient,
        subject: line,
        provider: providerName,
        ok: true,
        ms: Date.now() - started,
        id: result?.id ?? result?.messageId ?? null,
        attempts: attempt,
      });
      return { sent: true, provider: providerName, id: result?.id ?? result?.messageId ?? null };
    } catch (err) {
      lastError = err;
      if (attempt === 1) await wait(1000);
    }
  }

  const detail = lastError?.message ?? String(lastError);
  console.error(`[mail] send failed after 2 attempts: ${detail}`);
  record({
    to: recipient,
    subject: line,
    provider: providerName,
    ok: false,
    reason: "send-failed",
    detail,
    ms: Date.now() - started,
  });
  return { sent: false, reason: "send-failed", detail };
}

/* ------------------------------------------------------- providers */

/** POST JSON and turn a non-2xx into a readable error. */
async function postJson(url, headers, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const payload = await res.text();
  if (!res.ok) {
    throw new Error(`${res.status} ${payload.slice(0, 300)}`);
  }
  try {
    return JSON.parse(payload);
  } catch {
    return {};
  }
}

const PROVIDERS = {
  resend: {
    detect: () => Boolean(process.env.RESEND_API_KEY),
    create: () => async ({ from, to, replyTo, bcc, subject, text, html }) =>
      postJson(
        "https://api.resend.com/emails",
        { authorization: `Bearer ${process.env.RESEND_API_KEY}` },
        { from, to: [to], reply_to: replyTo, bcc: bcc ? [bcc] : undefined, subject, text, html }
      ),
  },

  postmark: {
    detect: () => Boolean(process.env.POSTMARK_SERVER_TOKEN),
    create: () => async ({ from, to, replyTo, bcc, subject, text, html }) =>
      postJson(
        "https://api.postmarkapp.com/email",
        { "X-Postmark-Server-Token": process.env.POSTMARK_SERVER_TOKEN, accept: "application/json" },
        {
          From: from,
          To: to,
          ReplyTo: replyTo,
          Bcc: bcc,
          Subject: subject,
          TextBody: text,
          HtmlBody: html,
          MessageStream: process.env.POSTMARK_STREAM || "outbound",
        }
      ),
  },

  sendgrid: {
    detect: () => Boolean(process.env.SENDGRID_API_KEY),
    create: () => async ({ from, to, replyTo, bcc, subject, text, html }) => {
      // SendGrid wants the display name split out of the address.
      const match = /^(.*)<(.+)>$/.exec(from);
      const sender = match ? { name: match[1].trim().replace(/"/g, ""), email: match[2].trim() } : { email: from };
      return postJson(
        "https://api.sendgrid.com/v3/mail/send",
        { authorization: `Bearer ${process.env.SENDGRID_API_KEY}` },
        {
          personalizations: [{ to: [{ email: to }], bcc: bcc ? [{ email: bcc }] : undefined }],
          from: sender,
          reply_to: replyTo ? { email: replyTo } : undefined,
          subject,
          content: [
            { type: "text/plain", value: text ?? "" },
            { type: "text/html", value: html ?? "" },
          ],
        }
      );
    },
  },

  mailgun: {
    detect: () => Boolean(process.env.MAILGUN_API_KEY && process.env.MAILGUN_DOMAIN),
    create: () => async ({ from, to, replyTo, bcc, subject, text, html }) => {
      const region = process.env.MAILGUN_REGION === "eu" ? "api.eu.mailgun.net" : "api.mailgun.net";
      const form = new URLSearchParams({ from, to, subject, text: text ?? "", html: html ?? "" });
      if (replyTo) form.set("h:Reply-To", replyTo);
      if (bcc) form.set("bcc", bcc);
      const res = await fetch(`https://${region}/v3/${process.env.MAILGUN_DOMAIN}/messages`, {
        method: "POST",
        headers: {
          authorization: `Basic ${Buffer.from(`api:${process.env.MAILGUN_API_KEY}`).toString("base64")}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: form,
      });
      const payload = await res.text();
      if (!res.ok) throw new Error(`${res.status} ${payload.slice(0, 300)}`);
      return JSON.parse(payload || "{}");
    },
  },

  smtp: {
    detect: () => Boolean(process.env.SMTP_HOST),
    create: async () => {
      /* Imported here rather than at the top of the file so that a
         deployment using an HTTP provider — or none at all — does not
         need nodemailer installed to boot. */
      const { default: nodemailer } = await import("nodemailer");
      const port = Number(process.env.SMTP_PORT ?? 587);
      const transport = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port,
        // 465 is implicit TLS; 587 and 25 start plain and upgrade.
        secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" : port === 465,
        auth: process.env.SMTP_USER
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
          : undefined,
      });
      return async (message) => transport.sendMail(message);
    },
  },
};

/**
 * Choose a provider and switch it on.
 *
 * Called once from server.js. MAIL_PROVIDER forces a specific one —
 * useful when several sets of credentials are present — otherwise the
 * first one whose configuration is complete wins, in the order listed.
 */
export async function registerMailer() {
  const forced = (process.env.MAIL_PROVIDER || "").trim().toLowerCase();

  if (forced === "console" || forced === "off") {
    setMailer(null);
    console.log("[mail] provider disabled (MAIL_PROVIDER=console) — messages are logged, not sent");
    return { provider: "console" };
  }

  const order = forced ? [forced] : ["resend", "postmark", "sendgrid", "mailgun", "smtp"];

  for (const name of order) {
    const provider = PROVIDERS[name];
    if (!provider) {
      console.error(`[mail] unknown MAIL_PROVIDER "${name}" — falling back to console logging`);
      break;
    }
    if (!provider.detect()) {
      if (forced) {
        console.error(
          `[mail] MAIL_PROVIDER=${name} but its credentials are missing — messages will be logged, not sent`
        );
      }
      continue;
    }

    try {
      const send = await provider.create();
      setMailer(send, name);
      console.log(
        `[mail] sending via ${name} as ${from()}` +
          (redirectTo() ? ` — REDIRECTED to ${redirectTo()}` : "") +
          (allowlist().length ? ` — allowlist: ${allowlist().join(", ")}` : "")
      );
      return { provider: name };
    } catch (err) {
      console.error(`[mail] could not start ${name}: ${err?.message ?? err}`);
    }
  }

  console.log("[mail] no provider configured — messages are logged, not sent (see .env.example)");
  return { provider: "console" };
}

/* --------------------------------------------------------- templates */

/**
 * The message a specialist receives when a patient enquires. Reply-to is
 * set to the patient so the specialist can simply hit reply.
 */
export function buildEnquiryEmail({ specialist, lead, profileUrl }) {
  const lines = [
    `You have a new enquiry from your Top Local Specialists profile.`,
    ``,
    `From: ${lead.patientName}`,
    lead.email ? `Email: ${lead.email}` : null,
    lead.phone ? `Phone: ${lead.phone}` : null,
    ``,
    lead.message ? `Message:` : null,
    lead.message ? lead.message : null,
    ``,
    profileUrl ? `Your profile: ${profileUrl}` : null,
    ``,
    `Reply directly to this email to reach ${lead.patientName}.`,
  ].filter((l) => l !== null);

  return {
    to: specialist.contactEmail,
    replyTo: lead.email || undefined,
    subject: `New patient enquiry for ${specialist.fullName}`,
    text: lines.join("\n"),
  };
}

/** The message sent by the "send a test email" button in the admin console. */
export function buildTestEmail({ to, byName }) {
  return {
    to,
    subject: "Test email from Top Local Specialists",
    text: [
      `This is a test message from the Top Local Specialists admin console.`,
      ``,
      `If you are reading it, outbound email is working: the provider accepted`,
      `the message and delivered it to this address.`,
      ``,
      `Sent by: ${byName ?? "an administrator"}`,
      `Provider: ${mailProviderName()}`,
      `From address: ${from()}`,
      `Site: ${SITE_URL}`,
      ``,
      `Nothing else was sent, and no member was contacted.`,
    ].join("\n"),
  };
}
