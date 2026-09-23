import "dotenv/config";
import {
  buildTestEmail,
  mailProviderName,
  mailerStatus,
  registerMailer,
  sendMail,
  setMailer,
} from "../src/lib/mailer.js";

/* ------------------------------------------------------------------ *
 * Prove that email works — before a member's approval depends on it
 *
 *   npm run mail:test -- you@yourdomain.com
 *       Sends one real message using whatever .env configures. This is
 *       the check to run after adding credentials: it exercises the
 *       provider, the from-address, the template and the credentials
 *       together, which is the only combination that matters.
 *
 *   npm run mail:test -- --local
 *       Needs no account and no network. Starts an SMTP server on
 *       127.0.0.1:2525, points the app's SMTP provider at it, sends a
 *       message and checks what arrived — headers, both body parts, the
 *       staging guards and the delivery log. Proves the plumbing is
 *       correct, so a failure with real credentials is a credentials
 *       problem and nothing else.
 * ------------------------------------------------------------------ */

const args = process.argv.slice(2);
const local = args.includes("--local");
const recipient = args.find((a) => !a.startsWith("--"));

let failures = 0;
function check(label, condition, detail = "") {
  if (!condition) failures += 1;
  console.log(`${condition ? "  ok" : "FAIL"}  ${label}${condition ? "" : ` — ${detail}`}`);
}

/* ------------------------------------------------------- local proof */

if (local) {
  /* Imported here, not at the top of the file, because smtp-server is a
     devDependency and a production host installs production dependencies
     only. A top-level import killed this script on Render before it
     reached the send path — which never needed the catcher at all. */
  const { SMTPServer } = await import("smtp-server");

  const inbox = [];
  const server = new SMTPServer({
    authOptional: true,
    disabledCommands: ["STARTTLS"],
    onData(stream, session, callback) {
      let raw = "";
      stream.on("data", (chunk) => (raw += chunk));
      stream.on("end", () => {
        inbox.push({ raw, to: session.envelope.rcptTo.map((r) => r.address) });
        callback();
      });
    },
  });

  await new Promise((resolve) => server.listen(2525, "127.0.0.1", resolve));
  console.log("catcher listening on 127.0.0.1:2525\n");

  process.env.MAIL_PROVIDER = "smtp";
  process.env.SMTP_HOST = "127.0.0.1";
  process.env.SMTP_PORT = "2525";
  process.env.SMTP_SECURE = "false";
  delete process.env.SMTP_USER;

  const { provider } = await registerMailer();
  check("the SMTP provider starts from environment variables alone", provider === "smtp", provider);

  const result = await sendMail({
    to: "clinician@real-practice.example-uk.co.uk",
    replyTo: "patient@somewhere.co.uk",
    subject: "Your application has been approved",
    text: "Your profile is live.\n\nPatients can now find you at http://localhost:5173/search.",
  });

  check("sendMail reports success", result.sent === true, JSON.stringify(result));
  check("a message actually reached the server", inbox.length === 1, `${inbox.length} received`);

  /* Quoted-printable: soft line breaks and =3D for "=" would make every
     assertion below depend on where the encoder happened to wrap. */
  const decode = (raw) => raw.replace(/=\r?\n/g, "").replace(/=3D/gi, "=");
  const message = decode(inbox[0]?.raw ?? "");
  check("it carries the configured From address", /^From: .+/m.test(message));
  check("the subject survives", message.includes("Your application has been approved"));
  check("reply-to is set to the patient", /Reply-To: .*patient@somewhere\.co\.uk/i.test(message));
  check("it is sent as multipart with both parts", /multipart\/alternative/i.test(message));
  check("the plain-text part is there", message.includes("Your profile is live."));
  check(
    "the HTML part is there and is branded",
    /Content-Type: text\/html/i.test(message) && /Top Local Specialists/i.test(message)
  );
  check(
    "links in the text are clickable in the HTML part",
    /<a href="http:\/\/localhost:5173\/search"/.test(message)
  );

  /* The guards, which are the difference between pointing a real provider
     at a staging database and emailing every clinician on it. */
  const reserved = await sendMail({ to: "someone@example.com", subject: "Should not send", text: "x" });
  check("reserved test addresses are skipped, not sent", reserved.sent === false && reserved.reason === "skipped");
  check("and no second message reached the server", inbox.length === 1, `${inbox.length}`);

  process.env.MAIL_ALLOWLIST = "@toplocalspecialists.com";
  const blocked = await sendMail({ to: "stranger@elsewhere.co.uk", subject: "Blocked", text: "x" });
  check(
    "MAIL_ALLOWLIST holds everything else back",
    blocked.sent === false && blocked.reason === "skipped",
    JSON.stringify(blocked)
  );
  delete process.env.MAIL_ALLOWLIST;

  const status = mailerStatus();
  check("the delivery log records the send", status.sent24h === 1, `${status.sent24h}`);
  check("and records the two skips", status.skipped24h === 2, `${status.skipped24h}`);
  check("the dashboard can name the provider", status.provider === "smtp", status.provider);

  /* A refusal by the provider must be reported, not swallowed. */
  setMailer(async () => {
    throw new Error("550 mailbox unavailable");
  }, "broken");
  const failed = await sendMail({ to: "clinician@real-practice.example-uk.co.uk", subject: "x", text: "y" });
  check("a provider failure is reported honestly", failed.sent === false && failed.reason === "send-failed");
  check("and the reason is kept for the dashboard", /550/.test(mailerStatus().lastFailure?.detail ?? ""));

  server.close();
  console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
  process.exit(failures ? 1 : 0);
}

/* ------------------------------------------------- send a real one */

if (!recipient) {
  console.log(
    [
      "Usage:",
      "  npm run mail:test -- you@yourdomain.com    send one real message with the configured provider",
      "  npm run mail:test -- --local               prove the plumbing with a local SMTP catcher",
    ].join("\n")
  );
  process.exit(1);
}

const { provider } = await registerMailer();
console.log(`provider: ${provider}`);

if (provider === "console") {
  console.log(
    "\nNo provider is configured, so nothing will leave this machine.\n" +
      "Set one of these in backend/.env and run again:\n" +
      "  RESEND_API_KEY=…        (simplest)\n" +
      "  POSTMARK_SERVER_TOKEN=… \n" +
      "  SENDGRID_API_KEY=…      \n" +
      "  MAILGUN_API_KEY=… MAILGUN_DOMAIN=…\n" +
      "  SMTP_HOST=… SMTP_PORT=587 SMTP_USER=… SMTP_PASS=…\n"
  );
}

const result = await sendMail(buildTestEmail({ to: recipient, byName: "the mail:test script" }));
console.log(JSON.stringify({ ...result, provider: mailProviderName() }, null, 2));

if (result.sent) {
  console.log(`\nSent. Check ${recipient} — including its spam folder, which is where a new sending domain lands first.`);
} else if (result.reason !== "no-mailer-configured") {
  console.log(`\nNot sent: ${result.detail ?? result.reason}`);
  process.exit(1);
}
