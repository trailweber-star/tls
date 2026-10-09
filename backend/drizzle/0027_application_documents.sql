CREATE TABLE "application_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"specialist_id" text NOT NULL,
	"uploaded_by" text,
	"kind" text DEFAULT 'registration-certificate' NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "application_documents" ADD CONSTRAINT "application_documents_specialist_id_specialists_id_fk" FOREIGN KEY ("specialist_id") REFERENCES "public"."specialists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "application_documents_specialist_idx" ON "application_documents" USING btree ("specialist_id");