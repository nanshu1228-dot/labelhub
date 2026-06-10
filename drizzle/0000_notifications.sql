CREATE TYPE "public"."task_status" AS ENUM('draft', 'open', 'paused', 'closed', 'archived');--> statement-breakpoint
CREATE TYPE "public"."workflow_stage" AS ENUM('drafting', 'revising', 'submitted', 'reviewing', 'awaiting_acceptance', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "ai_call_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"feature" text NOT NULL,
	"model" text NOT NULL,
	"tokens_in" integer NOT NULL,
	"tokens_out" integer NOT NULL,
	"cost_usd" real,
	"workspace_id" uuid,
	"ts" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "annotations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"topic_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"claude_proposal" jsonb,
	"delta_summary" text,
	"reasoning_text" text,
	"submitted_at" timestamp,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_request_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"api_key_id" uuid,
	"user_id" uuid,
	"endpoint" text NOT NULL,
	"method" text NOT NULL,
	"status" integer NOT NULL,
	"duration_ms" integer,
	"ip_hash" text,
	"user_agent" text,
	"payload_bytes" integer,
	"response_bytes" integer,
	"error_code" text,
	"ts" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"workspace_id" uuid NOT NULL,
	"actor_id" uuid,
	"payload" jsonb NOT NULL,
	"ts" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gold_standards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"item_data" jsonb NOT NULL,
	"correct_answer" jsonb NOT NULL,
	"explanation" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guideline_patches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guideline_id" uuid NOT NULL,
	"proposed_by" text NOT NULL,
	"patch_content" text NOT NULL,
	"rationale" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"vote_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guidelines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"content" text NOT NULL,
	"parent_version_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"link_url" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actor_id" uuid,
	"read_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_methods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"destination" text NOT NULL,
	"label" text,
	"verified_at" timestamp,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payout_line_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payout_period_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"annotation_id" uuid NOT NULL,
	"economy_type" text NOT NULL,
	"currency" text NOT NULL,
	"base_amount_minor" integer NOT NULL,
	"quality_multiplier_bp" integer NOT NULL,
	"bonus_amount_minor" integer DEFAULT 0 NOT NULL,
	"penalty_amount_minor" integer DEFAULT 0 NOT NULL,
	"total_amount_minor" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payout_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"closed_at" timestamp,
	"paid_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payout_period_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"payment_method_id" uuid,
	"external_ref" text,
	"paid_at" timestamp,
	"failed_at" timestamp,
	"failure_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"provider_kind" text NOT NULL,
	"display_name" text NOT NULL,
	"base_url" text,
	"vault_ref" text NOT NULL,
	"key_display" text,
	"rate_limit_rpm" integer,
	"rate_limit_tpm" integer,
	"enabled" text DEFAULT 'true' NOT NULL,
	"rotated_at" timestamp,
	"last_used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "provider_rate_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"api_key_id" uuid,
	"ts" timestamp DEFAULT now() NOT NULL,
	"tokens_used" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "step_annotations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"annotation_id" uuid NOT NULL,
	"trajectory_step_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"rating" integer,
	"reasoning" text NOT NULL,
	"payload" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_topic_scopes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"task_id" uuid,
	"in_scope" jsonb NOT NULL,
	"out_of_scope" jsonb NOT NULL,
	"suffix" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"generated_by" text NOT NULL,
	"generated_at" timestamp DEFAULT now() NOT NULL,
	"manually_edited_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"phase" integer DEFAULT 1 NOT NULL,
	"description" text,
	"guidelines_markdown" text,
	"template_mode" text NOT NULL,
	"reward_config" jsonb NOT NULL,
	"template_config" jsonb,
	"status" "task_status" DEFAULT 'draft' NOT NULL,
	"deadline" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"identifier" text NOT NULL,
	"name" text NOT NULL,
	"manifest" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source" text DEFAULT 'inferred' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"first_seen_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"item_data" jsonb NOT NULL,
	"status" "workflow_stage" DEFAULT 'drafting' NOT NULL,
	"assigned_to" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trajectories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"task_id" uuid,
	"source" text NOT NULL,
	"agent_name" text NOT NULL,
	"root_prompt" text NOT NULL,
	"final_response" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"schema_version" text DEFAULT '1.0' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"claude_hints" jsonb,
	"claude_hints_at" timestamp,
	"claude_hints_model" text,
	"features" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"summary" text,
	"summary_at" timestamp,
	"summary_model" text
);
--> statement-breakpoint
CREATE TABLE "trajectory_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trajectory_id" uuid NOT NULL,
	"parent_step_id" uuid,
	"sequence" integer NOT NULL,
	"kind" text NOT NULL,
	"content" jsonb NOT NULL,
	"tool_provider_id" uuid,
	"tool_call_id" text,
	"latency_ms" integer,
	"tokens_in" integer,
	"tokens_out" integer,
	"model_name" text,
	"ts" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"workspace_id" uuid,
	"ref_table" text,
	"ref_id" uuid,
	"memo" text,
	"ts" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trust_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"task_type" text NOT NULL,
	"score" real DEFAULT 0.5 NOT NULL,
	"sample_count" integer DEFAULT 0 NOT NULL,
	"last_updated" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"display_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "wallet_balance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"workspace_id" uuid,
	"currency" text NOT NULL,
	"balance_minor" integer DEFAULT 0 NOT NULL,
	"last_settled_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"prefix" text NOT NULL,
	"created_by" uuid NOT NULL,
	"rate_limit_rpm" integer,
	"last_used_at" timestamp,
	"expires_at" timestamp,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "workspace_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"invited_by" uuid NOT NULL,
	"token" text NOT NULL,
	"accepted_at" timestamp,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"invited_by" uuid,
	"joined_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_webhooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"url" text NOT NULL,
	"secret" text NOT NULL,
	"event_types" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_delivery_at" timestamp,
	"last_delivery_status" integer,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"revoked_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"template_mode" text NOT NULL,
	"admin_id" uuid NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_call_log" ADD CONSTRAINT "ai_call_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annotations" ADD CONSTRAINT "annotations_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annotations" ADD CONSTRAINT "annotations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_request_log" ADD CONSTRAINT "api_request_log_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_request_log" ADD CONSTRAINT "api_request_log_api_key_id_workspace_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."workspace_api_keys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_request_log" ADD CONSTRAINT "api_request_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gold_standards" ADD CONSTRAINT "gold_standards_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guideline_patches" ADD CONSTRAINT "guideline_patches_guideline_id_guidelines_id_fk" FOREIGN KEY ("guideline_id") REFERENCES "public"."guidelines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guidelines" ADD CONSTRAINT "guidelines_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_line_items" ADD CONSTRAINT "payout_line_items_payout_period_id_payout_periods_id_fk" FOREIGN KEY ("payout_period_id") REFERENCES "public"."payout_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_line_items" ADD CONSTRAINT "payout_line_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_line_items" ADD CONSTRAINT "payout_line_items_annotation_id_annotations_id_fk" FOREIGN KEY ("annotation_id") REFERENCES "public"."annotations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_periods" ADD CONSTRAINT "payout_periods_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_payout_period_id_payout_periods_id_fk" FOREIGN KEY ("payout_period_id") REFERENCES "public"."payout_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_payment_method_id_payment_methods_id_fk" FOREIGN KEY ("payment_method_id") REFERENCES "public"."payment_methods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_connections" ADD CONSTRAINT "provider_connections_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_connections" ADD CONSTRAINT "provider_connections_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_rate_log" ADD CONSTRAINT "provider_rate_log_connection_id_provider_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."provider_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_rate_log" ADD CONSTRAINT "provider_rate_log_api_key_id_workspace_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."workspace_api_keys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_annotations" ADD CONSTRAINT "step_annotations_annotation_id_annotations_id_fk" FOREIGN KEY ("annotation_id") REFERENCES "public"."annotations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_annotations" ADD CONSTRAINT "step_annotations_trajectory_step_id_trajectory_steps_id_fk" FOREIGN KEY ("trajectory_step_id") REFERENCES "public"."trajectory_steps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_topic_scopes" ADD CONSTRAINT "task_topic_scopes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_topic_scopes" ADD CONSTRAINT "task_topic_scopes_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_providers" ADD CONSTRAINT "tool_providers_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topics" ADD CONSTRAINT "topics_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topics" ADD CONSTRAINT "topics_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trajectories" ADD CONSTRAINT "trajectories_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trajectories" ADD CONSTRAINT "trajectories_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trajectory_steps" ADD CONSTRAINT "trajectory_steps_trajectory_id_trajectories_id_fk" FOREIGN KEY ("trajectory_id") REFERENCES "public"."trajectories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trajectory_steps" ADD CONSTRAINT "trajectory_steps_tool_provider_id_tool_providers_id_fk" FOREIGN KEY ("tool_provider_id") REFERENCES "public"."tool_providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trust_scores" ADD CONSTRAINT "trust_scores_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_balance" ADD CONSTRAINT "wallet_balance_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_balance" ADD CONSTRAINT "wallet_balance_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_api_keys" ADD CONSTRAINT "workspace_api_keys_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_api_keys" ADD CONSTRAINT "workspace_api_keys_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_invites" ADD CONSTRAINT "workspace_invites_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_invites" ADD CONSTRAINT "workspace_invites_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_webhooks" ADD CONSTRAINT "workspace_webhooks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_webhooks" ADD CONSTRAINT "workspace_webhooks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_admin_id_users_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_call_user_ts_idx" ON "ai_call_log" USING btree ("user_id","ts");--> statement-breakpoint
CREATE INDEX "annotations_topic_idx" ON "annotations" USING btree ("topic_id");--> statement-breakpoint
CREATE INDEX "annotations_user_idx" ON "annotations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "api_log_ws_ts_idx" ON "api_request_log" USING btree ("workspace_id","ts");--> statement-breakpoint
CREATE INDEX "api_log_key_ts_idx" ON "api_request_log" USING btree ("api_key_id","ts");--> statement-breakpoint
CREATE INDEX "api_log_endpoint_ts_idx" ON "api_request_log" USING btree ("endpoint","ts");--> statement-breakpoint
CREATE INDEX "events_workspace_idx" ON "events" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "events_type_idx" ON "events" USING btree ("type");--> statement-breakpoint
CREATE INDEX "events_ts_idx" ON "events" USING btree ("ts");--> statement-breakpoint
CREATE INDEX "gold_task_idx" ON "gold_standards" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "guidelines_task_version_idx" ON "guidelines" USING btree ("task_id","version");--> statement-breakpoint
CREATE INDEX "notifications_user_unread_idx" ON "notifications" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE INDEX "notifications_user_created_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "payment_methods_user_idx" ON "payment_methods" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "payout_line_items_period_idx" ON "payout_line_items" USING btree ("payout_period_id");--> statement-breakpoint
CREATE INDEX "payout_line_items_user_idx" ON "payout_line_items" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payout_line_items_annotation_uniq" ON "payout_line_items" USING btree ("annotation_id");--> statement-breakpoint
CREATE INDEX "payout_periods_ws_idx" ON "payout_periods" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payout_periods_ws_open_uniq" ON "payout_periods" USING btree ("workspace_id") WHERE status = 'open';--> statement-breakpoint
CREATE INDEX "payouts_period_idx" ON "payouts" USING btree ("payout_period_id");--> statement-breakpoint
CREATE INDEX "payouts_user_idx" ON "payouts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payouts_period_user_uniq" ON "payouts" USING btree ("payout_period_id","user_id");--> statement-breakpoint
CREATE INDEX "prov_conn_ws_kind_idx" ON "provider_connections" USING btree ("workspace_id","provider_kind");--> statement-breakpoint
CREATE UNIQUE INDEX "prov_conn_ws_name_uniq" ON "provider_connections" USING btree ("workspace_id","display_name");--> statement-breakpoint
CREATE INDEX "rate_log_conn_ts_idx" ON "provider_rate_log" USING btree ("connection_id","ts");--> statement-breakpoint
CREATE INDEX "step_ann_ann_idx" ON "step_annotations" USING btree ("annotation_id");--> statement-breakpoint
CREATE INDEX "step_ann_step_idx" ON "step_annotations" USING btree ("trajectory_step_id");--> statement-breakpoint
CREATE UNIQUE INDEX "topic_scopes_ws_fallback_uniq" ON "task_topic_scopes" USING btree ("workspace_id") WHERE task_id IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "topic_scopes_ws_task_uniq" ON "task_topic_scopes" USING btree ("workspace_id","task_id");--> statement-breakpoint
CREATE INDEX "tasks_workspace_idx" ON "tasks" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "tasks_status_idx" ON "tasks" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "tool_providers_ws_id_uniq" ON "tool_providers" USING btree ("workspace_id","identifier");--> statement-breakpoint
CREATE INDEX "tool_providers_ws_kind_idx" ON "tool_providers" USING btree ("workspace_id","kind");--> statement-breakpoint
CREATE INDEX "topics_task_idx" ON "topics" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "topics_assigned_idx" ON "topics" USING btree ("assigned_to");--> statement-breakpoint
CREATE INDEX "topics_status_idx" ON "topics" USING btree ("status");--> statement-breakpoint
CREATE INDEX "trajectories_ws_idx" ON "trajectories" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "trajectories_task_idx" ON "trajectories" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "trajectories_agent_idx" ON "trajectories" USING btree ("agent_name");--> statement-breakpoint
CREATE INDEX "trajectories_ws_created_active_idx" ON "trajectories" USING btree ("workspace_id","deleted_at","created_at");--> statement-breakpoint
CREATE INDEX "steps_traj_seq_idx" ON "trajectory_steps" USING btree ("trajectory_id","sequence");--> statement-breakpoint
CREATE INDEX "steps_traj_toolcall_idx" ON "trajectory_steps" USING btree ("trajectory_id","tool_call_id");--> statement-breakpoint
CREATE INDEX "steps_provider_idx" ON "trajectory_steps" USING btree ("tool_provider_id");--> statement-breakpoint
CREATE INDEX "transactions_user_idx" ON "transactions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "transactions_ws_idx" ON "transactions" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "transactions_user_ts_idx" ON "transactions" USING btree ("user_id","ts");--> statement-breakpoint
CREATE INDEX "trust_user_task_idx" ON "trust_scores" USING btree ("user_id","task_type");--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_balance_uniq" ON "wallet_balance" USING btree ("user_id","workspace_id","currency");--> statement-breakpoint
CREATE INDEX "api_keys_workspace_idx" ON "workspace_api_keys" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ws_invites_token_uniq" ON "workspace_invites" USING btree ("token");--> statement-breakpoint
CREATE INDEX "ws_invites_ws_email_idx" ON "workspace_invites" USING btree ("workspace_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "ws_members_ws_user_uniq" ON "workspace_members" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE INDEX "ws_members_user_idx" ON "workspace_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ws_members_role_idx" ON "workspace_members" USING btree ("workspace_id","role");--> statement-breakpoint
CREATE INDEX "webhooks_workspace_idx" ON "workspace_webhooks" USING btree ("workspace_id");