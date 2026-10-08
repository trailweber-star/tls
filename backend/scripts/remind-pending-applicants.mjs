import "dotenv/config";
import { specialists as specialistRepo, users as userRepo } from "../src/db/repos.js";
import { isDbConfigured } from "../src/config/db.js";
import { NOTIFICATION_TYPES, notify } from "../src/lib/notifications.js";
import { applicantWelcomeBody, regulatorFromNumber } from "../src/lib/applicantWelcome.js";
import { registerMailer, hasMailer, mailProviderName } from "../src/lib/mailer.js";
import { siteUrl } from "../src/lib/urls.js";
import pg from "pg";

/* ------------------------------------------------------------------ *
 * One-off: email every applicant still waiting for approval, asking
 * for their registration certificate and listing what is left on THEIR
 * profile. Each email uses that applicant's own name and own list.
 *
 *   node scripts/remind-pending-applicants.mjs                 (preview, sends nothing)
 *   node scripts/remind-pending-applicants.mjs --send          (sends to everyone listed)
 *   node scripts/remind-pending-applicants.mjs --send --only=someone@example.com
 *
 * Safe to re-run: each applicant has one reminder key, so a second
 * --send skips anyone already reminded.
 * ------------------------------------------------------------------ */

const send = process.argv.includes("--send");
const reset = process.argv.includes("--reset");
const only = (process.argv.find((a) => a.startsWith("--only=")) ?? "").slice(7).toLowerCase() || null;

if (!isDbConfigured()) {
  console.error("No DATABASE_URL set, nothing to read.");
  process.exit(1);
}

// --reset removes reminder rows from an earlier run that never left the
// building (for example one run where no mail provider was configured),
// so the next --send is not skipped as "already reminded".
if (reset) {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const out = await client.query("delete from notifications where key like 'applicant_reminder:%'");
  console.log(`Removed ${out.rowCount} earlier reminder record(s).`);
  await client.end();
  process.exit(0);
}

if (send) {
  await registerMailer();
  if (!hasMailer()) {
    console.error("Stopped: no mail provider is configured here, so nothing would be emailed. Run this where the mail settings exist (the Render shell).");
    process.exit(1);
  }
  if (/localhost|127\.0\.0\.1/.test(siteUrl())) {
    console.error(`Stopped: SITE_URL resolves to ${siteUrl()}, so links in the email would point at localhost. Run this in the Render shell.`);
    process.exit(1);
  }
  console.log(`Sending via ${mailProviderName()}, links use ${siteUrl()}\n`);
}

const intro =
  "We're still checking your application to Top Local Specialists. Your profile stays hidden from patients until our team has approved it, and updating your profile now will speed that up and help patients find your most up to date practice information.\n\n";

const pending = await specialistRepo.byStatus("pending");
console.log(`${pending.length} pending applicant(s).\n`);

let sent = 0;
let skipped = 0;
for (const sp of pending) {
  const user = sp.userId ? await userRepo.findById(sp.userId) : null;
  const email = user?.email ?? sp.contactEmail ?? null;
  if (!user || !email) {
    console.log(`SKIP  ${sp.fullName}: no account email`);
    skipped++;
    continue;
  }
  if (only && email.toLowerCase() !== only) continue;

  const body = applicantWelcomeBody({
    specialist: sp,
    plan: sp.plan ?? "basic",
    regulatorCode: regulatorFromNumber(sp.registrationNumber),
    intro,
  });

  if (!send) {
    console.log(`WOULD SEND  ${sp.fullName} <${email}>`);
    console.log(body.split("\n").map((l) => "    " + l).join("\n") + "\n");
    continue;
  }

  const result = await notify({
    userId: String(user.id),
    type: NOTIFICATION_TYPES.APPLICATION_RECEIVED,
    title: "Please send your certificate and update your profile",
    body,
    url: "/dashboard",
    subjectId: sp.id,
    key: `applicant_reminder:${sp.id}`,
    email,
  });
  if (result?.created === false) {
    console.log(`SKIP  ${sp.fullName} <${email}>: already reminded`);
    skipped++;
  } else {
    console.log(`SENT  ${sp.fullName} <${email}>`);
    sent++;
  }
}

console.log(send ? `\nDone. Sent ${sent}, skipped ${skipped}.` : "\nPreview only. Nothing was sent. Add --send to send.");
process.exit(0);
