-- Create "budget_events" table
CREATE TABLE "budget_events" ("id" character varying NOT NULL, "created_at" timestamptz NOT NULL, "team_id" character varying NOT NULL, "window_id" character varying NOT NULL DEFAULT '', "request_id" character varying NOT NULL DEFAULT '', "policy_id" character varying NOT NULL DEFAULT '', "action_key" character varying NOT NULL, "actor_id" character varying NOT NULL DEFAULT '', "kind" character varying NOT NULL, "data" jsonb NOT NULL, PRIMARY KEY ("id"));
-- Create index "budget_events_action_key_key" to table: "budget_events"
CREATE UNIQUE INDEX "budget_events_action_key_key" ON "budget_events" ("action_key");
-- Create index "budgetevent_team_id_created_at" to table: "budget_events"
CREATE INDEX "budgetevent_team_id_created_at" ON "budget_events" ("team_id", "created_at");
-- Create index "budgetevent_window_id_created_at" to table: "budget_events"
CREATE INDEX "budgetevent_window_id_created_at" ON "budget_events" ("window_id", "created_at");
-- Create "budget_gates" table
CREATE TABLE "budget_gates" ("id" character varying NOT NULL, "created_at" timestamptz NOT NULL, "revision" bigint NOT NULL DEFAULT 0, PRIMARY KEY ("id"));
-- Create "budget_policies" table
CREATE TABLE "budget_policies" ("id" character varying NOT NULL, "created_at" timestamptz NOT NULL, "updated_at" timestamptz NOT NULL, "team_id" character varying NOT NULL, "scope" character varying NOT NULL, "subject_id" character varying NOT NULL DEFAULT '', "period" character varying NOT NULL, "timezone" character varying NOT NULL, "previous_timezone" character varying NOT NULL DEFAULT '', "timezone_effective_at" timestamptz NULL, "point_limit" bigint NULL, "input_limit" bigint NULL, "output_limit" bigint NULL, "total_limit" bigint NULL, "enabled" boolean NOT NULL DEFAULT true, "revision" bigint NOT NULL DEFAULT 1, PRIMARY KEY ("id"));
-- Create index "budgetpolicy_team_id_scope_subject_id_period" to table: "budget_policies"
CREATE UNIQUE INDEX "budgetpolicy_team_id_scope_subject_id_period" ON "budget_policies" ("team_id", "scope", "subject_id", "period");
-- Create "budget_reservations" table
CREATE TABLE "budget_reservations" ("id" character varying NOT NULL, "created_at" timestamptz NOT NULL, "request_id" character varying NOT NULL, "window_id" character varying NOT NULL, "policy_id" character varying NOT NULL, "policy_revision" bigint NOT NULL, "point_units" bigint NOT NULL DEFAULT 0, "input_tokens" bigint NOT NULL DEFAULT 0, "output_tokens" bigint NOT NULL DEFAULT 0, "unbounded" boolean NOT NULL DEFAULT false, "unpriced" boolean NOT NULL DEFAULT false, "settled" boolean NOT NULL DEFAULT false, PRIMARY KEY ("id"));
-- Create index "budgetreservation_request_id_window_id" to table: "budget_reservations"
CREATE UNIQUE INDEX "budgetreservation_request_id_window_id" ON "budget_reservations" ("request_id", "window_id");
-- Create index "budgetreservation_window_id_settled" to table: "budget_reservations"
CREATE INDEX "budgetreservation_window_id_settled" ON "budget_reservations" ("window_id", "settled");
-- Create "budget_windows" table
CREATE TABLE "budget_windows" ("id" character varying NOT NULL, "created_at" timestamptz NOT NULL, "team_id" character varying NOT NULL, "scope" character varying NOT NULL, "subject_id" character varying NOT NULL DEFAULT '', "period" character varying NOT NULL, "starts_at" timestamptz NOT NULL, "ends_at" timestamptz NOT NULL, "spent_units" bigint NOT NULL DEFAULT 0, "reserved_units" bigint NOT NULL DEFAULT 0, "spent_input" bigint NOT NULL DEFAULT 0, "reserved_input" bigint NOT NULL DEFAULT 0, "spent_output" bigint NOT NULL DEFAULT 0, "reserved_output" bigint NOT NULL DEFAULT 0, "unpriced_count" bigint NOT NULL DEFAULT 0, "unbounded_count" bigint NOT NULL DEFAULT 0, PRIMARY KEY ("id"));
-- Create index "budgetwindow_team_id_ends_at" to table: "budget_windows"
CREATE INDEX "budgetwindow_team_id_ends_at" ON "budget_windows" ("team_id", "ends_at");
-- Create index "budgetwindow_team_id_scope_subject_id_period_starts_at" to table: "budget_windows"
CREATE UNIQUE INDEX "budgetwindow_team_id_scope_subject_id_period_starts_at" ON "budget_windows" ("team_id", "scope", "subject_id", "period", "starts_at");
