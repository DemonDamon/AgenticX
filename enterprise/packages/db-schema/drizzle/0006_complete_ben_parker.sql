CREATE TABLE "gateway_audit_events" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"event_time" timestamp with time zone NOT NULL,
	"event_type" varchar(64) NOT NULL,
	"user_id" varchar(128),
	"user_email" varchar(320),
	"department_id" varchar(128),
	"session_id" varchar(128),
	"client_type" varchar(32) DEFAULT 'web-portal' NOT NULL,
	"client_ip" varchar(128),
	"provider" varchar(128),
	"model" varchar(128),
	"route" varchar(32) NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"total_tokens" integer,
	"latency_ms" bigint,
	"digest" jsonb,
	"policies_hit" jsonb,
	"tools_called" jsonb,
	"prev_checksum" varchar(128) NOT NULL,
	"checksum" varchar(128) NOT NULL,
	"signature" varchar(256),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gateway_audit_events" ADD CONSTRAINT "gateway_audit_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gateway_audit_events_tenant_id_id_uq" ON "gateway_audit_events" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "gateway_audit_events_tenant_event_time_idx" ON "gateway_audit_events" USING btree ("tenant_id","event_time");--> statement-breakpoint
CREATE INDEX "gateway_audit_events_tenant_user_event_time_idx" ON "gateway_audit_events" USING btree ("tenant_id","user_id","event_time");--> statement-breakpoint
CREATE INDEX "gateway_audit_events_tenant_dept_event_time_idx" ON "gateway_audit_events" USING btree ("tenant_id","department_id","event_time");--> statement-breakpoint
CREATE INDEX "gateway_audit_events_tenant_model_event_time_idx" ON "gateway_audit_events" USING btree ("tenant_id","model","event_time");--> statement-breakpoint
CREATE INDEX "gateway_audit_events_policies_hit_gin" ON "gateway_audit_events" USING gin ("policies_hit");