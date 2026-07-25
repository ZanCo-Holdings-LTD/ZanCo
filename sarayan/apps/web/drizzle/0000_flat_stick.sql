CREATE TYPE "public"."alert_channel" AS ENUM('in_app', 'email', 'whatsapp', 'sms');--> statement-breakpoint
CREATE TYPE "public"."alert_status" AS ENUM('scheduled', 'sent', 'acknowledged', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."billing_status" AS ENUM('trialing', 'active', 'past_due', 'invoiced', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."extraction_status" AS ENUM('pending', 'confirmed', 'rejected', 'failed');--> statement-breakpoint
CREATE TYPE "public"."holder_kind" AS ENUM('person', 'vehicle', 'asset', 'entity');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('owner', 'admin', 'manager', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."plan_tier" AS ENUM('trial', 'starter', 'business', 'enterprise', 'agency');--> statement-breakpoint
CREATE TYPE "public"."record_status" AS ENUM('valid', 'due_soon', 'critical', 'expired', 'dormant');--> statement-breakpoint
CREATE TYPE "public"."renewal_status" AS ENUM('not_started', 'in_progress', 'blocked', 'submitted', 'completed', 'cancelled');--> statement-breakpoint
CREATE TABLE "alert_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"alert_id" uuid NOT NULL,
	"channel" "alert_channel" NOT NULL,
	"recipient" text NOT NULL,
	"provider_message_id" text,
	"succeeded" boolean DEFAULT false NOT NULL,
	"error" text,
	"cost_minor_units" integer DEFAULT 0 NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"record_id" uuid NOT NULL,
	"offset_days" integer NOT NULL,
	"due_on" date NOT NULL,
	"channels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"audience" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"escalate_if_unacknowledged" boolean DEFAULT false NOT NULL,
	"status" "alert_status" DEFAULT 'scheduled' NOT NULL,
	"sent_at" timestamp with time zone,
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by" uuid,
	"escalation_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"prefix" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid,
	"actor_user_id" uuid,
	"actor_label" text NOT NULL,
	"action" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_types" (
	"code" text PRIMARY KEY NOT NULL,
	"country" text NOT NULL,
	"jurisdiction" text NOT NULL,
	"category" text NOT NULL,
	"holder_kind" "holder_kind" NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text NOT NULL,
	"aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"issuing_authority" text NOT NULL,
	"issuing_authority_ar" text NOT NULL,
	"typical_validity_months" integer,
	"renewal_lead_days" integer DEFAULT 30 NOT NULL,
	"typical_renewal_cost" numeric(12, 2),
	"renewal_cost_currency" text,
	"penalties" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"blocks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"requires" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"consequences" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"seo_slug" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"legal_name" text,
	"name_ar" text,
	"country" text DEFAULT 'AE' NOT NULL,
	"jurisdiction" text,
	"registration_number" text,
	"tax_number" text,
	"client_reference" text,
	"contact_name" text,
	"contact_email" text,
	"contact_phone" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence_packs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"entity_id" uuid,
	"hash" text NOT NULL,
	"scope" text NOT NULL,
	"canonical_payload" text NOT NULL,
	"record_count" integer DEFAULT 0 NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"generated_by" uuid,
	"generated_by_name" text NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "extractions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"record_id" uuid,
	"file_id" uuid,
	"model" text NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"classified_type_code" text,
	"classification_confidence" numeric(4, 3),
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"corrections" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "extraction_status" DEFAULT 'pending' NOT NULL,
	"confirmed_by" uuid,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "holders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"kind" "holder_kind" DEFAULT 'person' NOT NULL,
	"name" text NOT NULL,
	"name_ar" text,
	"reference" text,
	"nationality" text,
	"department" text,
	"email" text,
	"phone" text,
	"identifier" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" "member_role" DEFAULT 'viewer' NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"tier" "plan_tier" NOT NULL,
	"amount_minor_units" integer NOT NULL,
	"currency" text DEFAULT 'GBP' NOT NULL,
	"period_months" integer DEFAULT 12 NOT NULL,
	"buyer_vat_number" text,
	"buyer_address" text,
	"issued_on" date NOT NULL,
	"due_on" date NOT NULL,
	"paid_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_time_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_type_code" text NOT NULL,
	"country" text NOT NULL,
	"observed_days" integer NOT NULL,
	"cost" numeric(12, 2),
	"currency" text,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"organisation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "member_role" DEFAULT 'viewer' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_organisation_id_user_id_pk" PRIMARY KEY("organisation_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "organisations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"country" text DEFAULT 'AE' NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"tier" "plan_tier" DEFAULT 'trial' NOT NULL,
	"billing_status" "billing_status" DEFAULT 'trialing' NOT NULL,
	"trial_ends_at" timestamp with time zone,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"is_agency" boolean DEFAULT false NOT NULL,
	"metadata_only_mode" boolean DEFAULT false NOT NULL,
	"storage_region" text DEFAULT 'me-central-1' NOT NULL,
	"wrapped_data_key" text,
	"alert_ladder" jsonb,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "record_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"record_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"holder_id" uuid NOT NULL,
	"document_type_code" text,
	"custom_type_name" text,
	"document_number" text,
	"issued_on" date,
	"expires_on" date,
	"no_expiry" boolean DEFAULT false NOT NULL,
	"issuing_authority" text,
	"owner_user_id" uuid,
	"status" "record_status" DEFAULT 'valid' NOT NULL,
	"notes" text,
	"extracted_fields" jsonb,
	"archived_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "renewal_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"record_id" uuid NOT NULL,
	"status" "renewal_status" DEFAULT 'not_started' NOT NULL,
	"assignee_user_id" uuid,
	"cost" numeric(12, 2),
	"currency" text,
	"started_on" date,
	"target_on" date,
	"completed_on" date,
	"new_expiry_date" date,
	"blocked_reason" text,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"user_agent" text,
	"ip_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text,
	"name" text NOT NULL,
	"phone" text,
	"locale" text DEFAULT 'en' NOT NULL,
	"email_verified_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alert_deliveries" ADD CONSTRAINT "alert_deliveries_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_deliveries" ADD CONSTRAINT "alert_deliveries_alert_id_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."alerts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_acknowledged_by_users_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_packs" ADD CONSTRAINT "evidence_packs_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_packs" ADD CONSTRAINT "evidence_packs_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_packs" ADD CONSTRAINT "evidence_packs_generated_by_users_id_fk" FOREIGN KEY ("generated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extractions" ADD CONSTRAINT "extractions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extractions" ADD CONSTRAINT "extractions_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extractions" ADD CONSTRAINT "extractions_file_id_record_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."record_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extractions" ADD CONSTRAINT "extractions_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holders" ADD CONSTRAINT "holders_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holders" ADD CONSTRAINT "holders_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_time_observations" ADD CONSTRAINT "lead_time_observations_document_type_code_document_types_code_fk" FOREIGN KEY ("document_type_code") REFERENCES "public"."document_types"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_files" ADD CONSTRAINT "record_files_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_files" ADD CONSTRAINT "record_files_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_files" ADD CONSTRAINT "record_files_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records" ADD CONSTRAINT "records_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records" ADD CONSTRAINT "records_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records" ADD CONSTRAINT "records_holder_id_holders_id_fk" FOREIGN KEY ("holder_id") REFERENCES "public"."holders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records" ADD CONSTRAINT "records_document_type_code_document_types_code_fk" FOREIGN KEY ("document_type_code") REFERENCES "public"."document_types"("code") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records" ADD CONSTRAINT "records_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records" ADD CONSTRAINT "records_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "renewal_tasks" ADD CONSTRAINT "renewal_tasks_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "renewal_tasks" ADD CONSTRAINT "renewal_tasks_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "renewal_tasks" ADD CONSTRAINT "renewal_tasks_assignee_user_id_users_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "renewal_tasks" ADD CONSTRAINT "renewal_tasks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alert_deliveries_org_idx" ON "alert_deliveries" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "alert_deliveries_alert_idx" ON "alert_deliveries" USING btree ("alert_id");--> statement-breakpoint
CREATE UNIQUE INDEX "alerts_record_offset_unique" ON "alerts" USING btree ("record_id","offset_days");--> statement-breakpoint
CREATE INDEX "alerts_due_idx" ON "alerts" USING btree ("due_on","status");--> statement-breakpoint
CREATE INDEX "alerts_org_idx" ON "alerts" USING btree ("organisation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_hash_unique" ON "api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "api_keys_org_idx" ON "api_keys" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "audit_log_org_idx" ON "audit_log" USING btree ("organisation_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_subject_idx" ON "audit_log" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "document_types_country_idx" ON "document_types" USING btree ("country");--> statement-breakpoint
CREATE INDEX "entities_org_idx" ON "entities" USING btree ("organisation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_packs_hash_unique" ON "evidence_packs" USING btree ("hash");--> statement-breakpoint
CREATE INDEX "evidence_packs_org_idx" ON "evidence_packs" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "extractions_org_idx" ON "extractions" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "holders_org_idx" ON "holders" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "holders_entity_idx" ON "holders" USING btree ("entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_token_hash_unique" ON "invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "invitations_org_idx" ON "invitations" USING btree ("organisation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_reference_unique" ON "invoices" USING btree ("reference");--> statement-breakpoint
CREATE INDEX "invoices_org_idx" ON "invoices" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "lead_time_type_idx" ON "lead_time_observations" USING btree ("document_type_code");--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organisations_slug_unique" ON "organisations" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "record_files_record_idx" ON "record_files" USING btree ("record_id");--> statement-breakpoint
CREATE INDEX "record_files_org_idx" ON "record_files" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "records_org_idx" ON "records" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "records_entity_idx" ON "records" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "records_holder_idx" ON "records" USING btree ("holder_id");--> statement-breakpoint
CREATE INDEX "records_org_expiry_idx" ON "records" USING btree ("organisation_id","expires_on");--> statement-breakpoint
CREATE INDEX "records_status_idx" ON "records" USING btree ("organisation_id","status");--> statement-breakpoint
CREATE INDEX "renewal_tasks_org_idx" ON "renewal_tasks" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "renewal_tasks_record_idx" ON "renewal_tasks" USING btree ("record_id");--> statement-breakpoint
CREATE INDEX "renewal_tasks_status_idx" ON "renewal_tasks" USING btree ("organisation_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_unique" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree (lower("email"));