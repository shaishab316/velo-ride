-- AlterTable
ALTER TABLE "parcels" ADD COLUMN     "admin_earning" DOUBLE PRECISION NOT NULL DEFAULT 0.00,
ADD COLUMN     "driver_earning" DOUBLE PRECISION NOT NULL DEFAULT 0.00;

-- AlterTable
ALTER TABLE "trips" ADD COLUMN     "admin_earning" DOUBLE PRECISION DEFAULT 0.00,
ADD COLUMN     "driver_earning" DOUBLE PRECISION DEFAULT 0.00;

-- CreateTable
CREATE TABLE "online_logs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "data" DATE NOT NULL,
    "online_seconds" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3) NOT NULL,
    "ended_at" TIMESTAMP(3),

    CONSTRAINT "online_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_date_idx" ON "online_logs"("user_id", "data");

-- AddForeignKey
ALTER TABLE "online_logs" ADD CONSTRAINT "online_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
