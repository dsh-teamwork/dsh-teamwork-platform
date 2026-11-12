-- CreateTable
CREATE TABLE "team_providers" (
    "id" TEXT NOT NULL DEFAULT nanoid(),
    "team_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "base_url" TEXT NOT NULL,
    "key_cipher" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "team_providers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "team_providers_team_id_name_key" ON "team_providers"("team_id", "name");

-- AddForeignKey
ALTER TABLE "team_providers" ADD CONSTRAINT "team_providers_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
