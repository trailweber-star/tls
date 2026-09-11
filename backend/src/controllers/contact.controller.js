import crypto from "node:crypto";
import { z } from "zod";
import { isDbConfigured } from "../config/db.js";
import { eq, desc } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { contactMessages } from "../db/schema.js";
import { users as userRepo } from "../db/repos.js";
import { demoAccounts } from "../data/accounts.js";
import { sendMail } from "../lib/mailer.js";
import { NOTIFICATION_TYPES, notifyAdmins } from "../lib/notifications.js";

/* ------------------------------------------------------------------ *
 * Contact messages
 *
 * A real submission path, not a form that pretends. Each message is
 * stored, raised in the admin's bell, and emailed to the support inbox
 * with reply-to set to the sender so hitting reply reaches them.
 *
 * The only thing missing is a configured mailer — see lib/mailer.js. The
 * message is recorded either way, so nothing is ever lost because email
 * was not connected yet.
 * ------------------------------------------------------------------ */

export const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || "admin@toplocalspecialists.com";

const messages = [];

const isoDates = (row) =>
  row ? { ...row, createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt } : null;

/**
 * Rows when a database is configured, memory in demo mode. Contact
 * messages used to live only in memory, which meant a restart threw away
 * anything a patient had written while nobody was looking.
 */
export const contactStore = {
  async create(row) {
    if (!isDbConfigured()) {
      messages.push(row);
      return row;
    }
    const { createdAt, ...rest } = row;
    const [saved] = await getDb().insert(contactMessages).values(rest).returning();
    return isoDates(saved);
  },
  async all() {
    if (!isDbConfigured()) return [...messages].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const rows = await getDb().select().from(contactMessages).orderBy(desc(contactMessages.createdAt));
    return rows.map(isoDates);
  },
  async find(id) {
    if (!isDbConfigured()) return messages.find((m) => m.id === id) ?? null;
    const [row] = await getDb().select().from(contactMessages).where(eq(contactMessages.id, id)).limit(1);
    return isoDates(row);
  },
};

/** Which enquiry desk it belongs to — the three cards on the page. */
export const CONTACT_TOPICS = [
  { id: "patient", label: "Patient support" },
  { id: "practitioner", label: "Practitioner support" },
  { id: "partnership", label: "Partnerships" },
  { id: "other", label: "Something else" },
];

const contactSchema = z.object({
  fullName: z.string().min(2, "Please enter your name").max(120),
  email: z.string().email("Please enter a valid email address"),
  phone: z.string().max(50).optional().or(z.literal("")),
  topic: z.enum(["patient", "practitioner", "partnership", "other"]).default("other"),
  message: z.string().min(10, "Please tell us a little more").max(4000),
  // Bots fill hidden fields; people do not. A filled honeypot is accepted
  // with a normal-looking response and then dropped, so a spammer gets no
  // signal about what was rejected.
  company: z.string().max(200).optional().or(z.literal("")),
});

// POST /api/contact
export async function submitContactMessage(req, res) {
  const parsed = contactSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: parsed.error.issues[0]?.message ?? "Please check the form and try again",
      issues: parsed.error.issues,
    });
  }
  const { fullName, email, phone, topic, message, company } = parsed.data;

  if (company) {
    // Honeypot tripped. Look successful, store nothing.
    return res.status(201).json({ ok: true });
  }

  const row = await contactStore.create({
    id: `msg_${crypto.randomBytes(8).toString("hex")}`,
    fullName: fullName.trim(),
    email: email.trim().toLowerCase(),
    phone: phone || null,
    topic,
    message: message.trim(),
    status: "new",
    createdAt: new Date().toISOString(),
  });

  const topicLabel = CONTACT_TOPICS.find((t) => t.id === topic)?.label ?? "Enquiry";

  const admins = isDbConfigured()
    ? await userRepo.admins()
    : demoAccounts.all().filter((u) => u.role === "admin" && u.active);

  await notifyAdmins(admins, {
    type: NOTIFICATION_TYPES.ENQUIRY_RECEIVED,
    title: `${topicLabel}: ${row.fullName}`,
    body: row.message.length > 140 ? `${row.message.slice(0, 140)}…` : row.message,
    url: "/admin/messages",
    subjectId: row.id,
    key: `contact:${row.id}`,
    // Admins get the bell entry; the support inbox gets the message
    // itself, below, with reply-to pointing at the sender.
    channels: { inApp: true, email: false, push: true },
  });

  const delivery = await sendMail({
    to: SUPPORT_EMAIL,
    // So "Reply" in the support inbox goes to the person who wrote in.
    replyTo: row.email,
    subject: `[${topicLabel}] ${row.fullName}`,
    text: [
      `${row.fullName} <${row.email}>`,
      row.phone ? `Phone: ${row.phone}` : null,
      `Topic: ${topicLabel}`,
      ``,
      row.message,
    ]
      .filter((l) => l !== null)
      .join("\n"),
  });

  // A copy to the sender, so they have a record of what they sent.
  await sendMail({
    to: row.email,
    subject: "We've received your message — Top Local Specialists",
    text: [
      `Hi ${row.fullName.split(" ")[0]},`,
      ``,
      `Thanks for getting in touch. A member of our team will reply as soon`,
      `as possible, usually within one working day.`,
      ``,
      `What you sent us:`,
      row.message,
      ``,
      `— Top Local Specialists`,
    ].join("\n"),
  });

  res.status(201).json({ ok: true, id: row.id, delivery });
}

// GET /api/admin/contact-messages
export async function listContactMessages(req, res) {
  res.json({ results: await contactStore.all() });
}
