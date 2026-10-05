-- Five notification types exist in the application code (src/lib/notifications.js
-- NOTIFICATION_TYPES, src/db/schema.js notificationTypeEnum) with no matching
-- migration ever having been generated for them, so the live "notification_type"
-- Postgres enum never actually gained these labels. Two of the five --
-- inbound_mail and mail_bounced -- are in the ACTIONABLE set, which is read on
-- every single /api/notifications/count poll and on every admin verification
-- decision (decideVerification -> notificationStore.resolveSubject), via
-- inArray(notificationsTable.type, [...ACTIONABLE]). Postgres rejects an
-- inArray() comparison against an enum value the type does not have, so both
-- of those were failing on every single call with a bare 500.
--
-- Separate from 0006 for the same reason 0006 is separate from 0005: that
-- migration is already applied everywhere it has run.
ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'application_received';
ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'new_enquiry';
ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'new_message_reply';
ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'inbound_mail';
ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'mail_bounced';
