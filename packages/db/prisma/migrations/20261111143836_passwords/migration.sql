-- CreateTable
CREATE TABLE "passwords" (
    "user_id" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "must_change" BOOLEAN NOT NULL,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "failures_since" TIMESTAMPTZ,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "passwords_pkey" PRIMARY KEY ("user_id")
);

-- AddForeignKey
ALTER TABLE "passwords" ADD CONSTRAINT "passwords_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
