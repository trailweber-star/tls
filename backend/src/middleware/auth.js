import { isDbConfigured } from "../config/db.js";
import { attachSpecialistId, users as userRepo } from "../db/repos.js";
import { demoAccounts } from "../data/accounts.js";
import { verifyToken } from "../lib/auth.js";

async function loadUser(id) {
  if (!isDbConfigured()) return demoAccounts.findById(id);
  try {
    const user = await userRepo.findById(id);
    // Which profile this account administers is read from the specialist
    // row (one nullable, unique user_id) rather than duplicated on the
    // account, so the two can never disagree about who owns a listing.
    return user ? attachSpecialistId(user) : null;
  } catch {
    return null;
  }
}

/**
 * Attaches req.user when a valid Bearer token is present, and rejects
 * otherwise. The token is only an identity claim — the account is loaded
 * fresh on every request so a suspended or deleted account stops working
 * immediately rather than when its token happens to expire.
 */
export async function requireAuth(req, res, next) {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  const claims = token ? verifyToken(token) : null;
  if (!claims?.sub) return res.status(401).json({ error: "Sign in to continue" });

  const user = await loadUser(claims.sub);
  if (!user || user.active === false) return res.status(401).json({ error: "Sign in to continue" });

  req.user = user;

  /* ---------------------------------------------------- impersonation
     `act` is the actor: the administrator who borrowed this session.
     It is in the signed token rather than a header precisely so the
     browser cannot drop it — an impersonated session must not be able
     to launder itself into an ordinary one by omitting a flag.

     Two things follow from it, both enforced below rather than here:
     the session cannot reach an admin route (requireRole), and the
     interface is told so it can say whose account is being worn. */
  if (claims.act) {
    const actor = await loadUser(claims.act);
    // The administrator behind it must still be an active administrator.
    // Revoking someone's admin rights has to end the sessions they
    // opened with them, or revocation means very little.
    if (!actor || actor.role !== "admin" || actor.active === false) {
      return res.status(401).json({ error: "That support session has ended. Sign in again." });
    }
    req.impersonatorId = actor.id;
    req.impersonatorName = actor.fullName;
  }

  next();
}

/** Route guard for a specific role, e.g. requireRole("admin"). */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Sign in to continue" });

    /* A borrowed session is never an administrator, whoever borrowed it.

       This is the guard that makes impersonation safe to have at all.
       Without it an admin could sign in as a member, and — because the
       token still belongs to an account with admin rights if they ever
       impersonated another admin, or simply because the check was
       forgotten — take administrative actions from inside a session the
       log attributes to somebody else. Refusing admin routes outright
       while `act` is set removes the whole class of problem, and costs
       an administrator one click to return to their own session. */
    if (req.impersonatorId && roles.includes("admin")) {
      return res.status(403).json({
        error: "You're signed in as a member. Return to your admin session to do that.",
        code: "impersonating",
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: "You don't have access to that" });
    }
    next();
  };
}

/**
 * The specialist profile the signed-in account administers. Every
 * dashboard endpoint goes through this, so an account can only ever read
 * or write its own profile — the id is taken from the session, never from
 * a request parameter a caller could change.
 */
export function specialistIdOf(user) {
  const id = user?.specialistId ?? user?.specialist;
  return id ? String(id) : null;
}
