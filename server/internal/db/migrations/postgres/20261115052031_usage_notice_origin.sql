-- Modify "usage_requests" table
ALTER TABLE "usage_requests" ADD COLUMN "app_url" character varying NOT NULL DEFAULT '';
