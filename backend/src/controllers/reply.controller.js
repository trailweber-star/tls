import { z } from "zod";
import { isDbConfigured } from "../config/db.js";
import { leadMessages as messageRepo, specialists as specialistRepo } from "../db/repos.js";
import { sendMail, buildPatientReplyEmail } from "../lib/mailer.js";

/* ------------------------------------------------------------------ *
 * A patient's side of a message thread
 *
 * No account, no sign-in -- the lead's reply_token in the URL is the
 * whole of the patient's access control. It names exactly one thread,
 * it is unguessable, and it is never listed anywhere a specialist or
 * admin can browse it, so having it is the same proof of identity as
 * having received the email it was sent in.
 * ------------------------------------------------------------------ */

// GET /api/reply/:token
export async function getReplyThread(req, res) {
  if (!isDbConfigured()) return res.status(404).json({ error: "Thread not found" });

  const lead = await messageRepo.findLeadByToken(req.params.token);
  if (!lead) return res.status(404).json({ error: "Thread not found" });

  await messageRepo.markRead(lead.id, "patient");
  const specialist = await specialistRepo.findById(lead.specialistId);
  const messages = await messageRepo.forLead(lead.id);

  res.json({
    specialist: specialist
      ? { fullName: specialist.fullName, title: specialist.title, photoUrl: specialist.photoUrl, slug: specialist.slug }
      : null,
    messages: messages.map((m) => ({ id: m.id, senderRole: m.senderRole, body: m.body, createdAt: m.createdAt })),
  });
}

const replySchema = z.object({ body: z.string().min(1).max(4000) });

// POST /api/reply/:token  { body }
export async function postReply(req, res) {
  if (!isDbConfigured()) return res.status(501).json({ error: "Replies need a database" });

  const lead = await messageRepo.findLeadByToken(req.params.token);
  if (!lead) return res.status(404).json({ error: "Thread not found" });

  const parsed = replySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid reply", issues: parsed.error.issues });

  const message = await messageRepo.create({ leadId: lead.id, senderRole: "patient", body: parsed.data.body });

  const specialist = await specialistRepo.findById(lead.specialistId);
  let delivery = { sent: false, reason: "no-recipient" };
  if (specialist?.contactEmail) {
    const profileUrl = `${(process.env.SITE_URL || "").replace(/\/+$/, "")}/dashboard/messages`;
    delivery = await sendMail(buildPatientReplyEmail({ specialist, lead, body: parsed.data.body, profileUrl }));
  }
  res.status(201).json({ ok: true, message, delivery });
}
