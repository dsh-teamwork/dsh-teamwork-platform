-- Create "knowledge_attachments" table
CREATE TABLE "knowledge_attachments" ("id" character varying NOT NULL, "created_at" timestamptz NOT NULL, "team_id" character varying NOT NULL, "document_id" character varying NOT NULL, "name" character varying NOT NULL, "content_type" character varying NOT NULL, "size" bigint NOT NULL, "digest" character varying NOT NULL, "created_by" character varying NOT NULL, PRIMARY KEY ("id"));
-- Create index "knowledgeattachment_document_id_name" to table: "knowledge_attachments"
CREATE UNIQUE INDEX "knowledgeattachment_document_id_name" ON "knowledge_attachments" ("document_id", "name");
-- Create index "knowledgeattachment_team_id_digest" to table: "knowledge_attachments"
CREATE INDEX "knowledgeattachment_team_id_digest" ON "knowledge_attachments" ("team_id", "digest");
