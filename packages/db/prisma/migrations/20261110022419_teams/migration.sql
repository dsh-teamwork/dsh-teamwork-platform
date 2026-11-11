-- CreateEnum
CREATE TYPE "team_role" AS ENUM ('admin', 'member');

-- CreateEnum
CREATE TYPE "config_kind" AS ENUM ('model', 'preset', 'plugin');

-- CreateTable
CREATE TABLE "teams" (
    "id" TEXT NOT NULL DEFAULT nanoid(),
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "user_id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "role" "team_role" NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "team_configs" (
    "id" TEXT NOT NULL DEFAULT nanoid(),
    "team_id" TEXT NOT NULL,
    "kind" "config_kind" NOT NULL,
    "name" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "team_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invites" (
    "id" TEXT NOT NULL DEFAULT nanoid(),
    "team_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "used_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "memberships_team_id_idx" ON "memberships"("team_id");

-- CreateIndex
CREATE UNIQUE INDEX "team_configs_team_id_kind_name_key" ON "team_configs"("team_id", "kind", "name");

-- CreateIndex
CREATE UNIQUE INDEX "invites_token_hash_key" ON "invites"("token_hash");

-- CreateIndex
CREATE INDEX "invites_team_id_idx" ON "invites"("team_id");

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_configs" ADD CONSTRAINT "team_configs_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invites" ADD CONSTRAINT "invites_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
