import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { UPLOAD_DIR } from "./lib/storage.js";
import cors from "cors";
import morgan from "morgan";
import apiRoutes from "./routes/index.js";
import { isDbConfigured } from "./config/db.js";
import { robotsTxt, sitemapXml } from "./controllers/sitemap.controller.js";
import { previewGate } from "./middleware/previewGate.js";

const app = express();
const here = path.dirname(fileURLToPath(import.meta.url));

/* Behind a load balancer or a reverse proxy, req.protocol is otherwise
   always "http" and req.get("host") the internal name — which would put
   the wrong origin on every uploaded-image URL we hand out. */
app.set("trust proxy", 1);

/* ------------------------------------------------------------------ *
 * A shareable preview
 *
 * In development the API and the site are two servers on two ports. On
 * a deployed preview they are one: this process serves the built site
 * as well as the API, from one origin and one URL. That is not only
 * convenience — it removes the entire class of "works locally, broken
 * on the link you sent the client" caused by cross-origin requests,
 * absolute asset URLs and cookie scope.
 *
 * Everything in this block is off unless its environment variable is
 * set, so local development is untouched.
 * ------------------------------------------------------------------ */

const CLIENT_DIR = process.env.CLIENT_DIR
  ? path.resolve(process.env.CLIENT_DIR)
  : path.resolve(here, "../../frontend/dist");
const servingClient = fs.existsSync(path.join(CLIENT_DIR, "index.html"));

/* A staging site must never turn up in a search result. Members'
   half-finished profiles and seeded demo clinicians indexed under the
   client's brand would be worse than no preview at all. */
const STAGING = process.env.STAGING === "1" || Boolean(process.env.SITE_PASSWORD);

if (STAGING) {
  app.use((req, res, next) => {
    res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
    next();
  });
}

/* robots.txt and sitemap.xml, in both modes. They used to exist only on
   a staging deployment, which meant that in production a crawler asking
   for /robots.txt fell through to the single-page-app catch-all and got
   index.html with a 200 — an HTML document where a text file was
   expected. The controller decides what to say based on whether this
   deployment is gated; see controllers/sitemap.controller.js. */
app.get("/robots.txt", robotsTxt);
app.get("/sitemap.xml", sitemapXml);

/* One shared password over the whole deployment, when SITE_PASSWORD is
   set — see middleware/previewGate.js for why it is a cookie and not
   HTTP Basic auth. */
previewGate(app);

app.use(cors());
/* The raw bytes are kept alongside the parsed body because a payment
   webhook's signature is computed over exactly what was sent — re-encoding
   the parsed object changes key order and whitespace, and the signature
   then never matches. Capped, because this buffer is attacker-controlled. */
app.use(
  express.json({
    limit: "1mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(morgan("dev"));

/* Uploaded images, when local disk is the store. Explicitly read-only
   and no-listing: this directory holds files members uploaded, and the
   only thing anyone should be able to do with it is fetch one by its
   generated name. The Content-Type is pinned from the extension so a
   file can never be served as something executable. */
app.use(
  "/uploads",
  express.static(UPLOAD_DIR, {
    index: false,
    dotfiles: "deny",
    maxAge: "7d",
    setHeaders(res) {
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Disposition", "inline");
      /* The frontend is a different origin from this API, so these
         images are fetched cross-origin by every <img> on the site.
         Stated explicitly rather than left to a default, because the
         day someone adds helmet its same-origin default would blank
         every photo on the site at once and the cause would not be
         obvious. */
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    },
  })
);

app.get("/api/health", (req, res) => {
  res.json({ ok: true, mode: isDbConfigured() ? "postgres" : "demo" });
});

app.use("/api", apiRoutes);

/* An unknown /api path is always JSON — a person fetching it is code,
   and code parsing an HTML 404 as JSON is a confusing crash. */
app.use("/api", (req, res) => {
  res.status(404).json({ error: "Not found" });
});

if (servingClient) {
  /* Hashed filenames can be cached forever; index.html never can, or a
     deploy lands and everybody keeps the previous build. */
  app.use(
    express.static(CLIENT_DIR, {
      index: false,
      maxAge: "30d",
      setHeaders(res, filePath) {
        if (filePath.endsWith(".html")) res.setHeader("Cache-Control", "no-cache");
      },
    })
  );

  // Client-side routing: every other path is the app, which then reads
  // the URL itself. Without this, refreshing /admin/members is a 404.
  app.get(/.*/, (req, res) => {
    /* Never cached: it is the file that names the current build's
       hashed assets, so a cached copy pins a browser to the previous
       deploy for as long as the cache lives. */
    res.setHeader("Cache-Control", "no-cache, must-revalidate");
    res.sendFile(path.join(CLIENT_DIR, "index.html"));
  });
} else {
  app.use((req, res) => {
    res.status(404).json({ error: "Not found" });
  });
}

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  /* A file over the cap is a person's mistake, not a server fault, and
     it deserves a sentence they can act on. Express's body parsers throw
     this before any controller runs, so without translating it here an
     oversized photo came back as a bare 500 — which tells the person
     nothing and tells us the site is broken when it is not. */
  if (err?.type === "entity.too.large" || err?.status === 413) {
    // Which limit to name depends on what was being uploaded — quoting
    // the 5MB photo cap at someone whose 80MB video was refused sends
    // them off to compress it to the wrong target.
    const isVideo = req.path?.endsWith("/uploads/video");
    const limit = isVideo ? (process.env.MAX_VIDEO_MB ?? 64) : (process.env.MAX_UPLOAD_MB ?? 5);
    return res.status(413).json({
      error: `That file is too large. The limit is ${limit}MB.`,
    });
  }
  if (err?.type === "entity.parse.failed") {
    return res.status(400).json({ error: "That request body could not be read." });
  }
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

export default app;
