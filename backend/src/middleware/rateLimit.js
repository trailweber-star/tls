import { rateLimit } from "express-rate-limit";

/* ------------------------------------------------------------------ *
 * Rate limiting
 *
 * Until now there was none, anywhere. Login, registration,
 * forgot-password, and every public form (enquiries, reviews,
 * organisation applications) would take requests as fast as a script
 * could send them -- which makes each of those endpoints a free tool
 * for credential stuffing, mail-bombing a stranger's inbox, or burying
 * the admin queue and the review moderation queue under noise.
 *
 * Three limiters, keyed on IP by express-rate-limit's own default, each
 * tuned to what the endpoint behind it can actually be used for:
 *
 *   authLimiter            login and registration. Loose enough that a
 *                           real person mistyping a password a few
 *                           times never sees it, tight enough that a
 *                           password-guessing script cannot get through
 *                           many attempts an hour.
 *
 *   passwordResetLimiter    forgot-password. This sits OUTSIDE the
 *                           per-account cap password.controller.js
 *                           already enforces (MAX_REQUESTS_PER_HOUR,
 *                           three asks an hour for one address) -- that
 *                           cap stops one account's mailbox being
 *                           buried, this one stops a single machine
 *                           working through a list of addresses looking
 *                           for accounts that exist. Neither replaces
 *                           the other.
 *
 *   publicFormLimiter       enquiries, reviews, organisation
 *                           applications. Generous: a patient only ever
 *                           submits one of these at a time, so the
 *                           figure is set by what a flooding script
 *                           would need, not by what a person would ever
 *                           hit.
 *
 * Every one of these answers with the same plain, friendly JSON shape
 * a client already knows how to show -- `{ error: "..." }`, the same
 * contract every other 4xx on this API uses -- rather than the HTML
 * error page Express serves by default for a 429.
 * ------------------------------------------------------------------ */

function limitExceeded(message) {
  return (req, res) => {
    res.status(429).json({ error: message });
  };
}

/* Ten tries in fifteen minutes. A person who has forgotten which of two
   passwords they used gets through this without noticing it is there;
   a script trying even a short list of passwords against one email
   does not get far enough to matter, and the account lock-out this
   stands in front of is the password itself, not a counter that resets
   on its own. Shared between login and registration -- a registration
   script creating accounts is the same shape of abuse as a login script
   guessing them. */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: limitExceeded("Too many attempts. Please wait a few minutes and try again."),
});

/* Five requests an hour, per IP. The endpoint itself already answers
   `{ ok: true }` to everything regardless of whether the address exists
   (see the long comment in password.controller.js) and already caps
   each ACCOUNT at three emails an hour -- this is the outer layer on
   top of that, capping each MACHINE instead, so that one caller cannot
   walk a list of addresses hunting for ones that are registered here.
   Five is above the per-account cap of three on purpose: a shared
   office IP with two colleagues each asking for a reset inside the
   same hour must not start failing before either person's own limit
   would. */
export const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: limitExceeded("Too many requests. Please wait and try again."),
});

/* Twenty an hour, per IP, shared by every public write that does not
   need an account: enquiries, reviews, organisation applications. A
   real visitor sends one of these and is done; twenty an hour is
   nowhere near a number a patient could reach by hand, so this never
   touches somebody filling in a form. It is low enough that a script
   flooding the enquiry desk, the review queue, or the quote pipeline
   hits the ceiling long before it has done any real damage. */
export const publicFormLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: limitExceeded("Too many requests. Please wait and try again."),
});
