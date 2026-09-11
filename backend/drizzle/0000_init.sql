CREATE TYPE "public"."claim_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."contact_status" AS ENUM('new', 'read', 'answered', 'closed');--> statement-breakpoint
CREATE TYPE "public"."contact_topic" AS ENUM('patient', 'practitioner', 'partnership', 'other');--> statement-breakpoint
CREATE TYPE "public"."facility_type" AS ENUM('hospital', 'clinic', 'care_home', 'pharmacy');--> statement-breakpoint
CREATE TYPE "public"."facility_verification" AS ENUM('verified', 'unverified');--> statement-breakpoint
CREATE TYPE "public"."lead_status" AS ENUM('new', 'responded', 'in_progress', 'closed', 'contact_attempted', 'contacted', 'appointment_offered', 'booked', 'attended', 'converted', 'lost', 'no_response');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('signup_pending', 'claim_pending', 'approval_overdue', 'payment_received', 'enquiry_received', 'application_decided');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('awaiting_payment', 'paid', 'failed', 'refunded', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."plan_id" AS ENUM('basic', 'premium', 'clinwell');--> statement-breakpoint
CREATE TYPE "public"."plan_interval" AS ENUM('monthly', 'yearly');--> statement-breakpoint
CREATE TYPE "public"."plan_status" AS ENUM('active', 'pending_verification', 'pending_payment', 'past_due', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."review_subject" AS ENUM('specialist', 'clinic');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('specialist', 'admin');--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('unverified', 'pending', 'info_requested', 'verified', 'rejected', 'suspended');--> statement-breakpoint
CREATE TABLE "cities" (
	"id" text PRIMARY KEY NOT NULL,
	"country_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"region" text,
	"lat" double precision,
	"lng" double precision,
	CONSTRAINT "cities_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"id" text PRIMARY KEY NOT NULL,
	"specialist_id" text NOT NULL,
	"specialist_slug" text NOT NULL,
	"specialist_name" text NOT NULL,
	"user_id" text NOT NULL,
	"full_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"registration_number" text NOT NULL,
	"registration_matches" boolean DEFAULT false NOT NULL,
	"message" text,
	"plan" "plan_id" DEFAULT 'basic' NOT NULL,
	"plan_interval" "plan_interval" DEFAULT 'yearly' NOT NULL,
	"status" "claim_status" DEFAULT 'pending' NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clinic_locations" (
	"id" text PRIMARY KEY NOT NULL,
	"clinic_id" text,
	"owned_by_specialist_id" text,
	"city_id" text NOT NULL,
	"address" text NOT NULL,
	"postcode" text,
	"lat" double precision,
	"lng" double precision,
	"phone" text
);
--> statement-breakpoint
CREATE TABLE "clinics" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"logo_url" text,
	"website" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clinics_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "conditions" (
	"id" text PRIMARY KEY NOT NULL,
	"specialty_id" text,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	CONSTRAINT "conditions_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "contact_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"full_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"topic" "contact_topic" NOT NULL,
	"message" text NOT NULL,
	"status" "contact_status" DEFAULT 'new' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "countries" (
	"id" text PRIMARY KEY NOT NULL,
	"iso_code" text NOT NULL,
	"name" text NOT NULL,
	"currency" text NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"timezone" text DEFAULT 'Europe/London' NOT NULL,
	CONSTRAINT "countries_iso_code_unique" UNIQUE("iso_code")
);
--> statement-breakpoint
CREATE TABLE "facilities" (
	"id" text PRIMARY KEY NOT NULL,
	"facility_type" "facility_type" NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"photo_url" text,
	"website" text,
	"phone" text,
	"city_id" text NOT NULL,
	"address" text,
	"postcode" text,
	"verification_status" "facility_verification" DEFAULT 'unverified' NOT NULL,
	"rating_avg" double precision DEFAULT 0 NOT NULL,
	"rating_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "facilities_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "facility_categories" (
	"id" text PRIMARY KEY NOT NULL,
	"parent_id" text,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	CONSTRAINT "facility_categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "facility_category_links" (
	"facility_id" text NOT NULL,
	"category_id" text NOT NULL,
	CONSTRAINT "facility_category_links_facility_id_category_id_pk" PRIMARY KEY("facility_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" text PRIMARY KEY NOT NULL,
	"patient_name" text NOT NULL,
	"email" text,
	"phone" text,
	"message" text,
	"specialist_id" text,
	"clinic_id" text,
	"facility_id" text,
	"condition_id" text,
	"status" "lead_status" DEFAULT 'new' NOT NULL,
	"held" boolean DEFAULT false NOT NULL,
	"released_at" timestamp with time zone,
	"response" text,
	"responded_at" timestamp with time zone,
	"source" text DEFAULT 'website_enquiry' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"user_id" text NOT NULL,
	"type" "notification_type" NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"url" text,
	"subject_id" text,
	"read_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" text PRIMARY KEY NOT NULL,
	"specialist_id" text NOT NULL,
	"specialist_name" text NOT NULL,
	"email" text,
	"plan_id" "plan_id" NOT NULL,
	"plan_name" text NOT NULL,
	"interval" "plan_interval" NOT NULL,
	"currency" text DEFAULT 'GBP' NOT NULL,
	"net_minor" integer NOT NULL,
	"vat_minor" integer NOT NULL,
	"vat_rate" double precision NOT NULL,
	"total_minor" integer NOT NULL,
	"period_end" timestamp with time zone,
	"status" "order_status" DEFAULT 'awaiting_payment' NOT NULL,
	"provider" text DEFAULT 'none' NOT NULL,
	"provider_ref" text,
	"failure_reason" text,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
CREATE TABLE "regulators" (
	"id" text PRIMARY KEY NOT NULL,
	"country_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "regulators_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"subject_type" "review_subject" NOT NULL,
	"subject_id" text NOT NULL,
	"rating" integer NOT NULL,
	"comment" text,
	"patient_name" text,
	"condition_id" text,
	"verified" boolean DEFAULT false NOT NULL,
	"score_communication" integer,
	"score_expertise" integer,
	"score_care" integer,
	"score_wait_time" integer,
	"response" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "specialist_clinic_locations" (
	"specialist_id" text NOT NULL,
	"clinic_location_id" text NOT NULL,
	CONSTRAINT "specialist_clinic_locations_specialist_id_clinic_location_id_pk" PRIMARY KEY("specialist_id","clinic_location_id")
);
--> statement-breakpoint
CREATE TABLE "specialist_conditions" (
	"specialist_id" text NOT NULL,
	"condition_id" text NOT NULL,
	CONSTRAINT "specialist_conditions_specialist_id_condition_id_pk" PRIMARY KEY("specialist_id","condition_id")
);
--> statement-breakpoint
CREATE TABLE "specialist_specialties" (
	"specialist_id" text NOT NULL,
	"specialty_id" text NOT NULL,
	CONSTRAINT "specialist_specialties_specialist_id_specialty_id_pk" PRIMARY KEY("specialist_id","specialty_id")
);
--> statement-breakpoint
CREATE TABLE "specialist_treatments" (
	"specialist_id" text NOT NULL,
	"treatment_id" text NOT NULL,
	CONSTRAINT "specialist_treatments_specialist_id_treatment_id_pk" PRIMARY KEY("specialist_id","treatment_id")
);
--> statement-breakpoint
CREATE TABLE "specialists" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"slug" text NOT NULL,
	"full_name" text NOT NULL,
	"title" text,
	"photo_url" text,
	"bio" text,
	"primary_specialty_id" text,
	"regulator_id" text,
	"registration_number" text,
	"verification_status" "verification_status" DEFAULT 'pending' NOT NULL,
	"application" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"verification_history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"claimed" boolean DEFAULT false NOT NULL,
	"consultation_price_minor" integer,
	"currency" text DEFAULT 'GBP' NOT NULL,
	"languages" text[] DEFAULT '{"English"}' NOT NULL,
	"rating_avg" double precision DEFAULT 0 NOT NULL,
	"rating_count" integer DEFAULT 0 NOT NULL,
	"contact_email" text,
	"contact_phone" text,
	"years_experience" integer,
	"video_url" text,
	"video_thumbnail_url" text,
	"video_duration_seconds" integer,
	"next_available_at" timestamp with time zone,
	"plan" "plan_id" DEFAULT 'basic' NOT NULL,
	"plan_interval" "plan_interval" DEFAULT 'yearly' NOT NULL,
	"plan_status" "plan_status" DEFAULT 'active' NOT NULL,
	"plan_selected_at" timestamp with time zone,
	"plan_activated_at" timestamp with time zone,
	"plan_renews_at" timestamp with time zone,
	"clinwell_workspace_id" text,
	"cover_image_url" text,
	"gallery" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"website_url" text,
	"socials" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"booking_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "specialists_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "specialists_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "specialties" (
	"id" text PRIMARY KEY NOT NULL,
	"parent_id" text,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"seo_title" text,
	"description" text,
	CONSTRAINT "specialties_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "treatments" (
	"id" text PRIMARY KEY NOT NULL,
	"specialty_id" text,
	"condition_id" text,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	CONSTRAINT "treatments_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"full_name" text NOT NULL,
	"role" "user_role" DEFAULT 'specialist' NOT NULL,
	"last_login_at" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "cities" ADD CONSTRAINT "cities_country_id_countries_id_fk" FOREIGN KEY ("country_id") REFERENCES "public"."countries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_specialist_id_specialists_id_fk" FOREIGN KEY ("specialist_id") REFERENCES "public"."specialists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_locations" ADD CONSTRAINT "clinic_locations_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_locations" ADD CONSTRAINT "clinic_locations_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_locations" ADD CONSTRAINT "clinic_locations_owner_fk" FOREIGN KEY ("owned_by_specialist_id") REFERENCES "public"."specialists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conditions" ADD CONSTRAINT "conditions_specialty_id_specialties_id_fk" FOREIGN KEY ("specialty_id") REFERENCES "public"."specialties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facilities" ADD CONSTRAINT "facilities_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facility_categories" ADD CONSTRAINT "facility_categories_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."facility_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facility_category_links" ADD CONSTRAINT "facility_category_links_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facility_category_links" ADD CONSTRAINT "facility_category_links_category_id_facility_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."facility_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_specialist_id_specialists_id_fk" FOREIGN KEY ("specialist_id") REFERENCES "public"."specialists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_condition_id_conditions_id_fk" FOREIGN KEY ("condition_id") REFERENCES "public"."conditions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_specialist_id_specialists_id_fk" FOREIGN KEY ("specialist_id") REFERENCES "public"."specialists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regulators" ADD CONSTRAINT "regulators_country_id_countries_id_fk" FOREIGN KEY ("country_id") REFERENCES "public"."countries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_condition_id_conditions_id_fk" FOREIGN KEY ("condition_id") REFERENCES "public"."conditions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specialist_clinic_locations" ADD CONSTRAINT "specialist_clinic_locations_specialist_id_specialists_id_fk" FOREIGN KEY ("specialist_id") REFERENCES "public"."specialists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specialist_clinic_locations" ADD CONSTRAINT "specialist_clinic_locations_clinic_location_id_clinic_locations_id_fk" FOREIGN KEY ("clinic_location_id") REFERENCES "public"."clinic_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specialist_conditions" ADD CONSTRAINT "specialist_conditions_specialist_id_specialists_id_fk" FOREIGN KEY ("specialist_id") REFERENCES "public"."specialists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specialist_conditions" ADD CONSTRAINT "specialist_conditions_condition_id_conditions_id_fk" FOREIGN KEY ("condition_id") REFERENCES "public"."conditions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specialist_specialties" ADD CONSTRAINT "specialist_specialties_specialist_id_specialists_id_fk" FOREIGN KEY ("specialist_id") REFERENCES "public"."specialists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specialist_specialties" ADD CONSTRAINT "specialist_specialties_specialty_id_specialties_id_fk" FOREIGN KEY ("specialty_id") REFERENCES "public"."specialties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specialist_treatments" ADD CONSTRAINT "specialist_treatments_specialist_id_specialists_id_fk" FOREIGN KEY ("specialist_id") REFERENCES "public"."specialists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specialist_treatments" ADD CONSTRAINT "specialist_treatments_treatment_id_treatments_id_fk" FOREIGN KEY ("treatment_id") REFERENCES "public"."treatments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specialists" ADD CONSTRAINT "specialists_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specialists" ADD CONSTRAINT "specialists_primary_specialty_id_specialties_id_fk" FOREIGN KEY ("primary_specialty_id") REFERENCES "public"."specialties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specialists" ADD CONSTRAINT "specialists_regulator_id_regulators_id_fk" FOREIGN KEY ("regulator_id") REFERENCES "public"."regulators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specialties" ADD CONSTRAINT "specialties_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."specialties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatments" ADD CONSTRAINT "treatments_specialty_id_specialties_id_fk" FOREIGN KEY ("specialty_id") REFERENCES "public"."specialties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatments" ADD CONSTRAINT "treatments_condition_id_conditions_id_fk" FOREIGN KEY ("condition_id") REFERENCES "public"."conditions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cities_country_idx" ON "cities" USING btree ("country_id");--> statement-breakpoint
CREATE INDEX "claims_status_idx" ON "claims" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "claims_specialist_idx" ON "claims" USING btree ("specialist_id","status");--> statement-breakpoint
CREATE INDEX "clinic_locations_clinic_idx" ON "clinic_locations" USING btree ("clinic_id");--> statement-breakpoint
CREATE INDEX "clinic_locations_city_idx" ON "clinic_locations" USING btree ("city_id");--> statement-breakpoint
CREATE INDEX "clinic_locations_owner_idx" ON "clinic_locations" USING btree ("owned_by_specialist_id");--> statement-breakpoint
CREATE INDEX "conditions_specialty_idx" ON "conditions" USING btree ("specialty_id");--> statement-breakpoint
CREATE INDEX "contact_messages_status_idx" ON "contact_messages" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "facilities_city_idx" ON "facilities" USING btree ("city_id");--> statement-breakpoint
CREATE INDEX "facilities_type_idx" ON "facilities" USING btree ("facility_type");--> statement-breakpoint
CREATE INDEX "facility_categories_parent_idx" ON "facility_categories" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "facility_category_links_category_idx" ON "facility_category_links" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "leads_specialist_idx" ON "leads" USING btree ("specialist_id","created_at");--> statement-breakpoint
CREATE INDEX "leads_status_idx" ON "leads" USING btree ("status");--> statement-breakpoint
CREATE INDEX "leads_held_idx" ON "leads" USING btree ("held");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE INDEX "notifications_subject_idx" ON "notifications" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX "orders_specialist_idx" ON "orders" USING btree ("specialist_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "orders_provider_ref_idx" ON "orders" USING btree ("provider_ref");--> statement-breakpoint
CREATE INDEX "push_subscriptions_user_idx" ON "push_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "reviews_subject_idx" ON "reviews" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "specialist_clinic_locations_location_idx" ON "specialist_clinic_locations" USING btree ("clinic_location_id");--> statement-breakpoint
CREATE INDEX "specialist_conditions_condition_idx" ON "specialist_conditions" USING btree ("condition_id");--> statement-breakpoint
CREATE INDEX "specialist_specialties_specialty_idx" ON "specialist_specialties" USING btree ("specialty_id");--> statement-breakpoint
CREATE INDEX "specialist_treatments_treatment_idx" ON "specialist_treatments" USING btree ("treatment_id");--> statement-breakpoint
CREATE INDEX "specialists_verification_idx" ON "specialists" USING btree ("verification_status");--> statement-breakpoint
CREATE INDEX "specialists_primary_specialty_idx" ON "specialists" USING btree ("primary_specialty_id");--> statement-breakpoint
CREATE INDEX "specialists_plan_idx" ON "specialists" USING btree ("plan","plan_status");--> statement-breakpoint
CREATE INDEX "specialties_parent_idx" ON "specialties" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "treatments_specialty_idx" ON "treatments" USING btree ("specialty_id");--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role");