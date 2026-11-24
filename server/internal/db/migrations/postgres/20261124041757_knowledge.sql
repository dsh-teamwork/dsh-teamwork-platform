-- Create "knowledge_documents" table
CREATE TABLE "knowledge_documents" ("id" character varying NOT NULL, "created_at" timestamptz NOT NULL, "team_id" character varying NOT NULL, "space_id" character varying NOT NULL, "folder_id" character varying NOT NULL DEFAULT '', "title" character varying NOT NULL, "current_version" bigint NOT NULL, "updated_at" timestamptz NOT NULL, PRIMARY KEY ("id"));
-- Create index "knowledgedocument_space_id_folder_id_title" to table: "knowledge_documents"
CREATE UNIQUE INDEX "knowledgedocument_space_id_folder_id_title" ON "knowledge_documents" ("space_id", "folder_id", "title");
-- Create index "knowledgedocument_team_id_updated_at" to table: "knowledge_documents"
CREATE INDEX "knowledgedocument_team_id_updated_at" ON "knowledge_documents" ("team_id", "updated_at");
-- Create "knowledge_folders" table
CREATE TABLE "knowledge_folders" ("id" character varying NOT NULL, "created_at" timestamptz NOT NULL, "space_id" character varying NOT NULL, "parent_id" character varying NOT NULL DEFAULT '', "name" character varying NOT NULL, PRIMARY KEY ("id"));
-- Create index "knowledgefolder_space_id_parent_id_name" to table: "knowledge_folders"
CREATE UNIQUE INDEX "knowledgefolder_space_id_parent_id_name" ON "knowledge_folders" ("space_id", "parent_id", "name");
-- Create "knowledge_proposals" table
CREATE TABLE "knowledge_proposals" ("id" character varying NOT NULL, "created_at" timestamptz NOT NULL, "team_id" character varying NOT NULL, "document_id" character varying NOT NULL, "base_version" bigint NOT NULL, "author_id" character varying NOT NULL, "source" character varying NOT NULL, "computer" character varying NOT NULL DEFAULT '', "session_id" character varying NOT NULL DEFAULT '', "note" character varying NOT NULL DEFAULT '', "text" text NOT NULL, "state" character varying NOT NULL DEFAULT 'pending', "decided_by" character varying NOT NULL DEFAULT '', "decided_at" timestamptz NULL, "reason" character varying NOT NULL DEFAULT '', "version" bigint NOT NULL DEFAULT 0, PRIMARY KEY ("id"));
-- Create index "knowledgeproposal_document_id_state" to table: "knowledge_proposals"
CREATE INDEX "knowledgeproposal_document_id_state" ON "knowledge_proposals" ("document_id", "state");
-- Create index "knowledgeproposal_team_id_state_created_at" to table: "knowledge_proposals"
CREATE INDEX "knowledgeproposal_team_id_state_created_at" ON "knowledge_proposals" ("team_id", "state", "created_at");
-- Create "knowledge_spaces" table
CREATE TABLE "knowledge_spaces" ("id" character varying NOT NULL, "created_at" timestamptz NOT NULL, "team_id" character varying NOT NULL, "name" character varying NOT NULL, "reading" character varying NOT NULL DEFAULT 'team', "created_by" character varying NOT NULL, PRIMARY KEY ("id"));
-- Create index "knowledgespace_team_id_name" to table: "knowledge_spaces"
CREATE UNIQUE INDEX "knowledgespace_team_id_name" ON "knowledge_spaces" ("team_id", "name");
-- Create "knowledge_space_members" table
CREATE TABLE "knowledge_space_members" ("id" character varying NOT NULL, "created_at" timestamptz NOT NULL, "space_id" character varying NOT NULL, "user_id" character varying NOT NULL, "role" character varying NOT NULL, PRIMARY KEY ("id"));
-- Create index "knowledgespacemember_space_id_user_id" to table: "knowledge_space_members"
CREATE UNIQUE INDEX "knowledgespacemember_space_id_user_id" ON "knowledge_space_members" ("space_id", "user_id");
-- Create index "knowledgespacemember_user_id" to table: "knowledge_space_members"
CREATE INDEX "knowledgespacemember_user_id" ON "knowledge_space_members" ("user_id");
-- Create "knowledge_versions" table
CREATE TABLE "knowledge_versions" ("id" character varying NOT NULL, "created_at" timestamptz NOT NULL, "document_id" character varying NOT NULL, "number" bigint NOT NULL, "author_id" character varying NOT NULL, "source" character varying NOT NULL, "computer" character varying NOT NULL DEFAULT '', "session_id" character varying NOT NULL DEFAULT '', "note" character varying NOT NULL DEFAULT '', "text" text NOT NULL, PRIMARY KEY ("id"));
-- Create index "knowledgeversion_document_id_number" to table: "knowledge_versions"
CREATE UNIQUE INDEX "knowledgeversion_document_id_number" ON "knowledge_versions" ("document_id", "number");
