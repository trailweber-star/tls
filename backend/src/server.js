import "dotenv/config";
import app from "./app.js";
import { connectDB, isDbConfigured } from "./config/db.js";
import { startReminderSweep } from "./lib/reminders.js";
import { registerGeocoder } from "./lib/geocoders.js";
import { registerMailer } from "./lib/mailer.js";
import { registerPaymentProvider } from "./lib/paymentProviders.js";

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

  app.listen(PORT, () => {
    console.log(`[server] listening on http://localhost:${PORT}`);
  });

  // Applications nobody has looked at are invisible unless something
  // goes looking for them. This raises one reminder per overdue
  // application, de-duplicated by key so restarts don't stack them.
  startReminderSweep();
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
