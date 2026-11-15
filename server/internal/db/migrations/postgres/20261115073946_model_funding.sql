-- Modify "team_configs" table
ALTER TABLE "team_configs" ADD COLUMN "route_owner" character varying NOT NULL DEFAULT '', ADD COLUMN "route_reference" character varying NOT NULL DEFAULT '';
-- Modify "usage_requests" table
ALTER TABLE "usage_requests" ADD COLUMN "route_owner" character varying NOT NULL DEFAULT '';
