import crypto from "node:crypto";

/* ------------------------------------------------------------------ *
 * The preview gate
 *
 * One shared password over a whole deployment, so a link can be sent to
 * a client and to nobody else. Off entirely unless SITE_PASSWORD is set.
 *
 * It is a cookie gate rather than HTTP Basic auth, and that is the whole
 * reason this file exists. Basic auth looks simpler — one header, no
 * page — but a browser only reliably attaches those credentials to
 * documents it was challenged on. This site is a single-page app: after
 * the first document loads, everything else is fetch(), and those
 * requests came back 401 while the page around them looked fine. The
 * result is the worst possible failure on a link you have just sent a
 * client: the site renders, and then every panel on it is empty.
 *
 * A cookie is attached by the browser to every same-origin request there
 * is, which is exactly what a single-page app needs.
 *
 * What it is not: authentication. It is a doormat, not a lock — one
 * password shared by everyone who has the link, no accounts, no audit.
 * Member and admin access is still the signed token in
 * middleware/auth.js. This only decides whether the front door opens.
 * ------------------------------------------------------------------ */

const COOKIE = "tls_preview";
const MAX_AGE_DAYS = 14;

/** Paths that must work without the password. */
function isExempt(path) {
  return (
    path === "/api/health" ||
    // Stripe cannot be handed a password, and it verifies its own
    // signature — see lib/paymentProviders.js.
    path === "/api/billing/webhook" ||
    /* Partner machines, for the same reason as Stripe and with the same
       condition attached: nothing under /api/partners/ is reachable
       without a bearer key AND an HMAC signature over the raw body,
       checked before the handler looks at anything (see
       controllers/clinwellStatus.controller.js). A server in someone
       else's data centre cannot be handed a shared password, and the
       gate refusing it is indistinguishable, from their side, from our
       key being wrong — which is a whole afternoon lost to the wrong
       question.

       The condition is not decoration: anything added under this prefix
       that does NOT verify a signature is published to the internet by
       this line. */
    path.startsWith("/api/partners/") ||
    path === "/__preview" ||
    path === "/robots.txt"
  );
}

/**
 * The cookie's value is an HMAC of the password, not the password.
 *
 * So the browser never holds the shared secret, and changing
 * SITE_PASSWORD invalidates every cookie already issued — which is what
 * you want the moment a link has been forwarded somewhere it shouldn't
 * have been.
 */
function token() {
  return crypto
    .createHmac("sha256", process.env.AUTH_SECRET || "preview")
    .update(`preview:${process.env.SITE_PASSWORD}`)
    .digest("hex")
    .slice(0, 32);
}

function readCookie(header, name) {
  return (header ?? "")
    .split(";")
    .map((part) => part.trim().split("="))
    .find(([key]) => key === name)?.[1];
}

/** Constant-time compare, so the gate cannot be probed character by character. */
function matches(a, b) {
  const left = Buffer.from(String(a ?? ""));
  const right = Buffer.from(String(b ?? ""));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

/** The password page. Deliberately one file, no JavaScript, no build step. */
function passwordPage({ error = false, next = "/" } = {}) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Top Local Specialists — preview</title>
<style>
  :root { color-scheme: light }
  * { box-sizing: border-box }
  body { margin:0; min-height:100vh; display:grid; place-items:center; padding:24px;
         background:#061626; color:#fff;
         font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif }
  .card { width:100%; max-width:380px; background:#fff; color:#0b1220; border-radius:18px; padding:28px 26px }
  .eyebrow { margin:0; font-size:11px; font-weight:700; letter-spacing:.14em; text-transform:uppercase; color:#0a6f66 }
  h1 { margin:8px 0 0; font-size:21px; line-height:1.2 }
  p { margin:10px 0 0; font-size:13.5px; line-height:1.6; color:#55677a }
  label { display:block; margin-top:20px; font-size:12px; font-weight:700 }
  input { width:100%; margin-top:6px; padding:11px 13px; font-size:15px; color:#0b1220;
          border:1px solid #dfe7ee; border-radius:12px; background:#f7fafb }
  input:focus { outline:none; border-color:#14b8a6; box-shadow:0 0 0 3px rgba(20,184,166,.18) }
  button { width:100%; margin-top:16px; padding:12px; font-size:14px; font-weight:700; color:#fff;
           background:#061626; border:0; border-radius:999px; cursor:pointer }
  button:hover { background:#0a2035 }
  .error { margin-top:14px; padding:10px 12px; border-radius:10px; background:rgba(214,69,90,.1);
           color:#b3283d; font-size:12.5px; font-weight:600 }
  .foot { margin-top:18px; font-size:11.5px; color:#8998a8 }
</style></head>
<body>
  <main class="card">
    <p class="eyebrow">Top Local Specialists</p>
    <h1>This is a private preview</h1>
    <p>A build in progress, shared for review. Enter the password you were sent to continue.</p>
    <form method="POST" action="/__preview">
      <input type="hidden" name="next" value="${String(next).replace(/"/g, "&quot;")}">
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" autofocus required>
      <button type="submit">View the site</button>
    </form>
    ${error ? '<p class="error">That password is not right. Try again, or ask for the link to be re-sent.</p>' : ""}
    <p class="foot">Nothing on this preview is live, and it is not indexed by search engines.</p>
  </main>
</body></html>`;
}

/**
 * Mount the gate. Returns a no-op when SITE_PASSWORD is unset, so
 * development and production-without-a-password are untouched.
 */
export function previewGate(app) {
  if (!process.env.SITE_PASSWORD) return false;

  /* Serving the form and accepting it are the only two routes that exist
     outside the gate. The POST is parsed here with express.urlencoded
     rather than globally, because the rest of the API is JSON and adding
     a second body parser to every route to serve one form is a poor
     trade. */
  app.get("/__preview", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.type("html").send(passwordPage({ next: typeof req.query.next === "string" ? req.query.next : "/" }));
  });

  app.post("/__preview", expressUrlencoded, (req, res) => {
    const given = String(req.body?.password ?? "");
    if (!matches(given, process.env.SITE_PASSWORD)) {
      res.setHeader("Cache-Control", "no-store");
      return res.status(401).type("html").send(passwordPage({ error: true, next: req.body?.next ?? "/" }));
    }

    res.setHeader(
      "Set-Cookie",
      [
        `${COOKIE}=${token()}`,
        "Path=/",
        "HttpOnly",
        "SameSite=Lax",
        `Max-Age=${MAX_AGE_DAYS * 86400}`,
        // Secure is correct on every host that terminates TLS, and would
        // break a plain-http preview on a laptop — so it follows the
        // protocol the request actually arrived on.
        req.secure || req.headers["x-forwarded-proto"] === "https" ? "Secure" : null,
      ]
        .filter(Boolean)
        .join("; ")
    );

    /* Only ever a path on this site. An open redirect on the one page
       everybody is sent to would be a gift to a phisher. */
    const next = String(req.body?.next ?? "/");
    res.redirect(302, next.startsWith("/") && !next.startsWith("//") ? next : "/");
  });

  app.use((req, res, next) => {
    if (isExempt(req.path)) return next();

    if (matches(readCookie(req.headers.cookie, COOKIE), token())) return next();

    /* Basic auth is accepted as well as the cookie — not for browsers,
       but so an uptime probe, a curl, or the client's own developer can
       reach it without a session. */
    const basic = `Basic ${Buffer.from(`${process.env.SITE_USER || "client"}:${process.env.SITE_PASSWORD}`).toString("base64")}`;
    if (req.headers.authorization && matches(req.headers.authorization, basic)) return next();

    res.setHeader("Cache-Control", "no-store");

    // An API call gets JSON; a person gets the password page.
    if (req.path.startsWith("/api/")) {
      return res.status(401).json({ error: "This preview is password protected.", gate: "/__preview" });
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      return res.status(401).type("text/plain").send("This preview is password protected.");
    }
    return res.redirect(302, `/__preview?next=${encodeURIComponent(req.originalUrl)}`);
  });

  return true;
}

/* Imported lazily to keep this file's import list honest: express is
   already a dependency, and the parser is only ever used by the one
   route above. */
const { default: express } = await import("express");
const expressUrlencoded = express.urlencoded({ extended: false, limit: "4kb" });
