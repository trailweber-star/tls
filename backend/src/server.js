import "dotenv/config";
import app from "./app.js";
import { connectDB, isDbConfigured } from "./config/db.js";
import { startReminderSweep } from "./lib/reminders.js";
import { registerGeocoder } from "./lib/geocoders.js";
import { registerMailer } from "./lib/mailer.js";
import { registerPaymentProvider } from "./lib/paymentProviders.js";
import { registerPushProvider } from "./lib/pushProvider.js";
import { registerClinWell } from "./lib/clinwellProvider.js";
import { startOutboxSweep } from "./lib/clinwellSender.js";

const PORT = process.env.PORT || 4000;

async function main() {
  if (isDbConfigured()) {
    await connectDB();
    console.log("[server] connected to Postgres");
  } else {
    console.log("[server] DATABASE_URL not set — running in demo mode (src/data/mock.js)");
  }

  // Postcode and place-name lookup. Free by default; see lib/geocoders.js.
  registerGeocoder();

  // Outbound email. Picks a provider from the environment, or logs every
  // message when none is configured — see lib/mailer.js.
  await registerMailer();

  // Card payments. Simulated until Stripe's keys are present — see
  // lib/paymentProviders.js.
  registerPaymentProvider();

  // Desktop notifications for the admin. Off unless VAPID keys are set;
  // no account and no vendor either way — see lib/pushProvider.js.
  registerPushProvider();

  // The clinical suite, behind a boundary. Reads go straight to
  // ClinWell and are never stored here; writes go through an outbox
  // because the contract's retry schedule runs for fourteen hours —
  // see lib/clinwellProvider.js and lib/clinwellSender.js.
  registerClinWell();

  app.listen(PORT, () => {
    console.log(`[server] listening on http://localhost:${PORT}`);
  });

  // Applications nobody has looked at are invisible unless something
  // goes looking for them. This raises one reminder per overdue
  // application, de-duplicated by key so restarts don't stack them.
  startReminderSweep();

  // Drains queued ClinWell events. Separate from the reminder sweep
  // because it runs every minute rather than every half hour: a
  // practice waiting for its clinical workspace should not wait
  // twenty-nine minutes for the next tick.
  startOutboxSweep();
}

main().catch((err) => {
  /* A boot failure with a fix in it deserves to be readable. The
     schema-behind-the-code check raises a sentence naming the command
     that repairs it, and a stack trace above that sentence buries the
     one line worth reading. Anything unexpected still gets the full
     trace, because for those the trace IS the information. */
  if (err?.expected) {
    console.error(`\n${err.message}\n`);
  } else {
    console.error(err);
  }
  process.exit(1);
});
