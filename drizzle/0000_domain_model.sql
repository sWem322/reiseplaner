CREATE TYPE "public"."message_role" AS ENUM('user', 'assistant', 'system');--> statement-breakpoint
CREATE TYPE "public"."tool_call_outcome" AS ENUM('ok', 'validation_error', 'upstream_error');--> statement-breakpoint
CREATE TYPE "public"."trip_draft_status" AS ENUM('collecting', 'searching', 'proposed', 'confirmed');--> statement-breakpoint
CREATE TABLE "conversation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"summary" text,
	"summarized_until_seq" integer,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigserial NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" "message_role" NOT NULL,
	"blocks" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_call_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"tool_name" text NOT NULL,
	"input" jsonb NOT NULL,
	"outcome" "tool_call_outcome" NOT NULL,
	"error_message" text,
	"duration_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trip_draft" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"status" "trip_draft_status" DEFAULT 'collecting' NOT NULL,
	"origin_name" text,
	"origin_iata" text,
	"origin_latitude" double precision,
	"origin_longitude" double precision,
	"destination_name" text,
	"destination_iata" text,
	"destination_latitude" double precision,
	"destination_longitude" double precision,
	"departure_date" text,
	"return_date" text,
	"adults" integer,
	"child_ages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"budget_euros" integer,
	"preferences" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trip_draft_conversation_id_unique" UNIQUE("conversation_id")
);
--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_call_log" ADD CONSTRAINT "tool_call_log_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_draft" ADD CONSTRAINT "trip_draft_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "message_conversation_seq_idx" ON "message" USING btree ("conversation_id","seq");--> statement-breakpoint
CREATE INDEX "tool_call_log_conversation_idx" ON "tool_call_log" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "tool_call_log_tool_outcome_idx" ON "tool_call_log" USING btree ("tool_name","outcome");--> statement-breakpoint
CREATE INDEX "trip_draft_status_idx" ON "trip_draft" USING btree ("status");