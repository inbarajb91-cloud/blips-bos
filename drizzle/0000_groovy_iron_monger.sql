CREATE TYPE "public"."agent_log_status" AS ENUM('success', 'error', 'retry');--> statement-breakpoint
CREATE TYPE "public"."agent_name" AS ENUM('ORC', 'BUNKER', 'STOKER', 'FURNACE', 'BOILER', 'ENGINE', 'PROPELLER');--> statement-breakpoint
CREATE TYPE "public"."agent_output_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'REVISION_REQUESTED');--> statement-breakpoint
CREATE TYPE "public"."candidate_status" AS ENUM('PENDING_REVIEW', 'APPROVED', 'DISMISSED');--> statement-breakpoint
CREATE TYPE "public"."decade_lens" AS ENUM('RCK', 'RCL', 'RCD');--> statement-breakpoint
CREATE TYPE "public"."signal_source" AS ENUM('direct', 'reddit', 'rss', 'trends', 'newsapi', 'upload');--> statement-breakpoint
CREATE TYPE "public"."signal_status" AS ENUM('IN_BUNKER', 'IN_STOKER', 'IN_FURNACE', 'IN_BOILER', 'IN_ENGINE', 'AT_PROPELLER', 'DOCKED', 'COLD_BUNKER', 'DISMISSED', 'BUNKER_FAILED', 'EXTRACTION_FAILED');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('FOUNDER', 'EMPLOYEE', 'PARTNER', 'VENDOR');--> statement-breakpoint
CREATE TABLE "agent_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"signal_id" uuid NOT NULL,
	"agent_name" "agent_name" NOT NULL,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"signal_id" uuid,
	"agent_name" "agent_name" NOT NULL,
	"action" text NOT NULL,
	"model" text,
	"tokens_input" integer,
	"tokens_output" integer,
	"cost_usd" numeric(10, 6),
	"duration_ms" integer,
	"status" "agent_log_status" NOT NULL,
	"error_message" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_outputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"signal_id" uuid NOT NULL,
	"agent_name" "agent_name" NOT NULL,
	"output_type" text NOT NULL,
	"content" jsonb NOT NULL,
	"status" "agent_output_status" DEFAULT 'PENDING' NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bunker_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"shortcode" text NOT NULL,
	"working_title" text NOT NULL,
	"concept" text,
	"source" "signal_source" NOT NULL,
	"raw_text" text,
	"raw_metadata" jsonb,
	"content_hash" text NOT NULL,
	"status" "candidate_status" DEFAULT 'PENDING_REVIEW' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "config_agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"agent_name" "agent_name" NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "config_bos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "config_engine_room" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "decision_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"signal_id" uuid NOT NULL,
	"agent_name" "agent_name" NOT NULL,
	"decision" text NOT NULL,
	"reason" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orgs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orgs_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "signal_decades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"signal_id" uuid NOT NULL,
	"decade_lens" "decade_lens" NOT NULL,
	"manifestation" text,
	"evolution_order" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signal_locks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"signal_id" uuid NOT NULL,
	"locked_by" uuid NOT NULL,
	"locked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "signal_locks_signal_id_unique" UNIQUE("signal_id")
);
--> statement-breakpoint
CREATE TABLE "signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"shortcode" text NOT NULL,
	"working_title" text NOT NULL,
	"concept" text,
	"status" "signal_status" DEFAULT 'IN_BUNKER' NOT NULL,
	"source" "signal_source" NOT NULL,
	"raw_text" text,
	"raw_metadata" jsonb,
	"batch_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" "user_role" DEFAULT 'FOUNDER' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_sign_in_at" timestamp with time zone,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "agent_conversations" ADD CONSTRAINT "agent_conversations_signal_id_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_logs" ADD CONSTRAINT "agent_logs_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_logs" ADD CONSTRAINT "agent_logs_signal_id_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_outputs" ADD CONSTRAINT "agent_outputs_signal_id_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_outputs" ADD CONSTRAINT "agent_outputs_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bunker_candidates" ADD CONSTRAINT "bunker_candidates_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "config_agents" ADD CONSTRAINT "config_agents_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "config_bos" ADD CONSTRAINT "config_bos_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "config_engine_room" ADD CONSTRAINT "config_engine_room_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_history" ADD CONSTRAINT "decision_history_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_history" ADD CONSTRAINT "decision_history_signal_id_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_history" ADD CONSTRAINT "decision_history_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_decades" ADD CONSTRAINT "signal_decades_signal_id_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_locks" ADD CONSTRAINT "signal_locks_signal_id_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_locks" ADD CONSTRAINT "signal_locks_locked_by_users_id_fk" FOREIGN KEY ("locked_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signals" ADD CONSTRAINT "signals_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signals" ADD CONSTRAINT "signals_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_conversations_signal_idx" ON "agent_conversations" USING btree ("signal_id");--> statement-breakpoint
CREATE INDEX "agent_logs_org_created_idx" ON "agent_logs" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_logs_signal_idx" ON "agent_logs" USING btree ("signal_id");--> statement-breakpoint
CREATE INDEX "agent_logs_agent_idx" ON "agent_logs" USING btree ("agent_name");--> statement-breakpoint
CREATE INDEX "agent_outputs_signal_idx" ON "agent_outputs" USING btree ("signal_id");--> statement-breakpoint
CREATE INDEX "agent_outputs_signal_agent_idx" ON "agent_outputs" USING btree ("signal_id","agent_name");--> statement-breakpoint
CREATE INDEX "batches_org_idx" ON "batches" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bunker_candidates_org_hash_uq" ON "bunker_candidates" USING btree ("org_id","content_hash");--> statement-breakpoint
CREATE INDEX "bunker_candidates_org_status_idx" ON "bunker_candidates" USING btree ("org_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "config_agents_org_agent_key_uq" ON "config_agents" USING btree ("org_id","agent_name","key");--> statement-breakpoint
CREATE UNIQUE INDEX "config_bos_org_key_uq" ON "config_bos" USING btree ("org_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "config_engine_room_org_key_uq" ON "config_engine_room" USING btree ("org_id","key");--> statement-breakpoint
CREATE INDEX "decision_history_org_idx" ON "decision_history" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "decision_history_signal_idx" ON "decision_history" USING btree ("signal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "signal_decades_signal_lens_uq" ON "signal_decades" USING btree ("signal_id","decade_lens");--> statement-breakpoint
CREATE UNIQUE INDEX "signals_org_shortcode_uq" ON "signals" USING btree ("org_id","shortcode");--> statement-breakpoint
CREATE INDEX "signals_org_status_idx" ON "signals" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "signals_org_batch_idx" ON "signals" USING btree ("org_id","batch_id");--> statement-breakpoint
CREATE INDEX "signals_org_created_idx" ON "signals" USING btree ("org_id","created_at");