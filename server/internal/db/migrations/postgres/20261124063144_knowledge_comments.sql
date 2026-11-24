-- Create "knowledge_comments" table
CREATE TABLE "knowledge_comments" ("id" character varying NOT NULL, "created_at" timestamptz NOT NULL, "team_id" character varying NOT NULL, "document_id" character varying NOT NULL, "parent_id" character varying NOT NULL DEFAULT '', "author_id" character varying NOT NULL, "version" bigint NOT NULL, "quote" character varying NOT NULL DEFAULT '', "anchor" character varying NOT NULL DEFAULT '', "body" text NOT NULL, "resolved_by" character varying NOT NULL DEFAULT '', "resolved_at" timestamptz NULL, PRIMARY KEY ("id"));
-- Create index "knowledgecomment_author_id" to table: "knowledge_comments"
CREATE INDEX "knowledgecomment_author_id" ON "knowledge_comments" ("author_id");
-- Create index "knowledgecomment_document_id_created_at" to table: "knowledge_comments"
CREATE INDEX "knowledgecomment_document_id_created_at" ON "knowledge_comments" ("document_id", "created_at");
