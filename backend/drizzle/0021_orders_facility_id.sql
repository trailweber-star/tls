/* ------------------------------------------------------------------ *
 * Orders can target a facility, not only a specialist
 *
 * An organisation's application (see organisations.controller.js)
 * could be quoted and even paid for, but there was no way for the
 * money to land anywhere: orders.specialist_id was NOT NULL, and
 * activateSubscription() only ever knew how to patch a `specialists`
 * row. A won hospital/clinic/pharmacy/care home application had
 * nowhere to go.
 *
 * specialist_id becomes nullable, facility_id is added alongside it,
 * and the CHECK constraint makes "exactly one of the two" a fact the
 * database enforces rather than a convention callers have to remember.
 * ------------------------------------------------------------------ */

ALTER TABLE "orders" ALTER COLUMN "specialist_id" DROP NOT NULL;
ALTER TABLE "orders" ADD COLUMN "facility_id" text;
ALTER TABLE "orders" ADD CONSTRAINT "orders_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX "orders_facility_idx" ON "orders" USING btree ("facility_id","created_at");
ALTER TABLE "orders" ADD CONSTRAINT "orders_specialist_xor_facility" CHECK ((specialist_id is not null) <> (facility_id is not null));
