/* ------------------------------------------------------------------ *
 * Is the API up?
 *
 * This exists because of one specific, repeated, entirely avoidable
 * confusion: there are three `dev` scripts in this repository and only
 * one of them starts the whole site.
 *
 *   repo root    database check, migrations, API and web together
 *   frontend/    vite alone  ← you are here
 *   backend/     the API alone
 *
 * Run the middle one and you get a working page that says "Could not
 * reach the API". It looks like the site is broken. It is a missing
 * process, and the browser has no way of telling you which.
 *
 * So this runs before vite does, and if nothing is listening on the
 * API's port it prints the one command that fixes it. It does NOT
 * refuse to continue — running the frontend alone is legitimate (a
 * pure styling pass, or pointing at a deployed API through
 * VITE_API_URL), and a dev script that blocks that would be a worse
 * problem than the one it solves.
 * ------------------------------------------------------------------ */
import net from "node:net";

/* Started by the root launcher, which is starting the API alongside
   this at the same moment — so there is nothing useful to say and about
   a second in which the answer would be wrong anyway.

   This is the whole reason the guard cannot simply probe and warn. Both
   halves start together; vite is ready long before the API has bound
   its port; so the check ran, found nothing listening, and advised
   running `cd .. && npm run dev` to somebody who had just run exactly
   that. A warning that fires on the correct command is worse than no
   warning at all, because it trains people to ignore the one case it
   was written for. */
if (process.env.TLS_DEV_LAUNCHER === "1") process.exit(0);

/* Whatever VITE_API_URL points at, or the local default the API uses.
   A developer pointing at a deployed API should not be warned about
   localhost. */
const target = process.env.VITE_API_URL || "http://localhost:4000/api";

function hostAndPort(value) {
  try {
    const url = new URL(value);
    return { host: url.hostname, port: Number(url.port || (url.protocol === "https:" ? 443 : 80)), remote: true };
  } catch {
    /* A relative value like "/api" means same-origin in production, and
       locally that is the API's own port. */
    return { host: "127.0.0.1", port: 4000, remote: false };
  }
}

const { host, port } = hostAndPort(target);

/* Only worth warning about something we can start. A remote API being
   unreachable is not this script's business. */
const local = host === "localhost" || host === "127.0.0.1" || host === "::1";
if (!local) process.exit(0);

const reachable = await new Promise((resolve) => {
  const socket = net.connect({ host, port });
  const done = (answer) => {
    socket.destroy();
    resolve(answer);
  };
  socket.setTimeout(400);
  socket.once("connect", () => done(true));
  socket.once("timeout", () => done(false));
  socket.once("error", () => done(false));
});

if (reachable) process.exit(0);

const dim = "\x1b[2m";
const bold = "\x1b[1m";
const amber = "\x1b[33m";
const off = "\x1b[0m";

console.log("");
console.log(`${amber}  Nothing is listening on ${host}:${port}, so the API is not running.${off}`);
console.log(`${dim}  The page will load and every request on it will fail.${off}`);
console.log("");
console.log(`${dim}  This starts vite only. To run the whole site, stop this and use${off}`);
console.log(`      ${bold}cd ..  &&  npm run dev${off}`);
console.log(`${dim}  which checks the database, applies migrations, and starts both halves.${off}`);
console.log("");
console.log(`${dim}  Carrying on with the frontend alone.${off}`);
console.log("");
