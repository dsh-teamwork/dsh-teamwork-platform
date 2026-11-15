-- Create "model_rates" table
CREATE TABLE "model_rates" ("id" character varying NOT NULL, "created_at" timestamptz NOT NULL, "team_id" character varying NOT NULL, "config_id" character varying NOT NULL, "provider" character varying NOT NULL, "model" character varying NOT NULL, "revision" bigint NOT NULL, "basis" character varying NOT NULL, "input_rate" bigint NOT NULL, "cache_read_rate" bigint NOT NULL, "cache_write_rate" bigint NOT NULL, "output_rate" bigint NOT NULL, "actor_id" character varying NOT NULL, PRIMARY KEY ("id"));
-- Create index "modelrate_team_id_config_id_revision" to table: "model_rates"
CREATE UNIQUE INDEX "modelrate_team_id_config_id_revision" ON "model_rates" ("team_id", "config_id", "revision");
-- Create "usage_requests" table
CREATE TABLE "usage_requests" ("id" character varying NOT NULL, "created_at" timestamptz NOT NULL, "team_id" character varying NOT NULL, "user_id" character varying NOT NULL, "submitted_config_id" character varying NOT NULL, "config_id" character varying NOT NULL, "provider" character varying NOT NULL, "model" character varying NOT NULL, "stream" boolean NOT NULL, "state" character varying NOT NULL DEFAULT 'running', "rate_id" character varying NOT NULL DEFAULT '', "rates" jsonb NULL, "point_units" bigint NULL, "input_tokens" bigint NULL, "cache_read_tokens" bigint NULL, "cache_write_tokens" bigint NULL, "output_tokens" bigint NULL, "reasoning_tokens" bigint NULL, "provider_request_id" character varying NOT NULL DEFAULT '', "error_code" character varying NOT NULL DEFAULT '', "finished_at" timestamptz NULL, PRIMARY KEY ("id"));
-- Create index "usagerequest_state_created_at" to table: "usage_requests"
CREATE INDEX "usagerequest_state_created_at" ON "usage_requests" ("state", "created_at");
-- Create index "usagerequest_team_id_config_id_created_at" to table: "usage_requests"
CREATE INDEX "usagerequest_team_id_config_id_created_at" ON "usage_requests" ("team_id", "config_id", "created_at");
-- Create index "usagerequest_team_id_created_at" to table: "usage_requests"
CREATE INDEX "usagerequest_team_id_created_at" ON "usage_requests" ("team_id", "created_at");
-- Create index "usagerequest_team_id_user_id_created_at" to table: "usage_requests"
CREATE INDEX "usagerequest_team_id_user_id_created_at" ON "usage_requests" ("team_id", "user_id", "created_at");
