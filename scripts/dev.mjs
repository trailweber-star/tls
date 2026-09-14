/* ------------------------------------------------------------------ *
 * One command for local development
 *
 * This exists because of a recurring, entirely avoidable failure: the
 * site is two processes, and `npm run dev:web` on its own gives you a
 * working page that says "Can't reach the server". It looks like a bug
 * in the site. It is a missing process, and the browser can never tell
 * you which.
 *
 * So: one command. It checks the database is reachable before starting
 * anything, applies pending migrations, then runs the API and the web
 * server together with their output labelled. Ctrl-C stops both —
 * leaving one of them orphaned on a port is the other half of this
 * problem.
 * ------------------------------------------------------------------ */
import { spawn, spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const c = {
  api: "\x1b[36m", // cyan
  web: "\x1b[35m", // magenta
  ok: "\x1b[32m",
  warn: "\x1b[33m",
  bad: "\x1b[31m",
  dim: "\x1b[2m",
  off: "\x1b[0m",
};

const say = (colour, label, message) => console.log(`${colour}${label.padEnd(5)}${c.off} ${message}`);

/* ----------------------------------------------------- the database */

/** DATABASE_URL from backend/.env, without pulling in dotenv. */
function databaseUrl() {
  const file = path.join(root, "backend", ".env");
  if (!existsSync(file)) return null;
  const line = readFileSync(file, "utf8")
    .split("\n")
    .find((l) => l.startsWith("DATABASE_URL="));
  const value = line?.slice("DATABASE_URL=".length).trim().replace(/^["']|["']$/g, "");
  return value || null;
}

/** Is anything listening there? A 400ms TCP connect, no driver needed. */
function reachable(host, port) {
  return new Promise((resolve) => {
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
}

const url = databaseUrl();
if (!url) {
  say(c.warn, "db", "no DATABASE_URL in backend/.env — the API will run on demo data, nothing will save.");
} else {
  let host = "localhost";
  let port = 5432;
  try {
    const parsed = new URL(url);
    host = parsed.hostname || host;
    port = Number(parsed.port || 5432);
  } catch {
    /* An unparseable URL is the API's problem to report, not this script's. */
  }

  if (await reachable(host, port)) {
    say(c.ok, "db", `${host}:${port} is up`);
    say(c.dim, "db", "applying any pending migrations…");
    const migrate = spawnSync("npm", ["run", "migrate"], { cwd: root, stdio: "inherit", shell: false });
    if (migrate.status !== 0) {
      say(c.bad, "db", "migrations failed — fix the error above, then run this again.");
      process.exit(1);
    }
  } else {
    console.log("");
    say(c.bad, "db", `nothing is listening on ${host}:${port}, so the API cannot start.`);
    console.log(`${c.dim}      Start Postgres, then run this again:${c.off}`);
    console.log(`${c.dim}        brew services start postgresql@16     (or postgresql@15, whichever you installed)${c.off}`);
    console.log(`${c.dim}        brew services list                    to see what you have${c.off}`);
    console.log("");
    process.exit(1);
  }
}

/* ------------------------------------------------------ both halves */

const children = [];

/* Vite picks its own port when 5173 is busy, and the only thing that
   knows which it settled on is vite. Watched for rather than assumed,
   because a banner that says 5173 while the site is on 5175 sends
   somebody to a page that is not there — which is precisely the class
   of confusion this script exists to remove. */
let sitePort = null;
function noticeSiteUrl(line) {
  const match = /https?:\/\/localhost:(\d+)/.exec(line);
  if (!match || sitePort) return;
  sitePort = match[1];
  console.log("");
  say(c.ok, "dev", `site on http://localhost:${sitePort}  ·  API on :4000  ·  Ctrl-C stops both`);
  if (sitePort !== "5173") {
    say(c.dim, "dev", "(5173 was busy — something else is still running on it)");
  }
  console.log("");
}

function start(label, colour, args) {
  const child = spawn("npm", args, {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    /* Tells frontend/scripts/check-api.mjs that the API is being started
       right now, alongside it, so it should hold its tongue. Without
       this it probes port 4000 before the API has bound, decides the API
       is missing, and advises running the very command that is running
       it. */
    env: { ...process.env, TLS_DEV_LAUNCHER: "1" },
  });
  const relay = (stream) => {
    let buffer = "";
    stream.on("data", (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        if (label === "web") noticeSiteUrl(line);
        say(colour, label, line);
      }
    });
  };
  relay(child.stdout);
  relay(child.stderr);
  child.on("exit", (code) => {
    /* If one half dies the other is useless and its port stays busy, so
       they live and die together. */
    if (!stopping) {
      say(c.bad, label, `stopped (exit ${code}). Stopping the other half too.`);
      stop(code ?? 1);
    }
  });
  children.push(child);
  return child;
}

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 300);
}

process.on("SIGINT", () => {
  console.log("");
  say(c.dim, "dev", "stopping both…");
  stop(0);
});
process.on("SIGTERM", () => stop(0));

console.log("");
start("api", c.api, ["run", "dev:api"]);
start("web", c.web, ["run", "dev:web"]);
/* The real addresses are printed by noticeSiteUrl once vite says which
   port it actually got. Nothing is claimed before then. */
console.log(`${c.dim}      starting both halves…${c.off}\n`);
