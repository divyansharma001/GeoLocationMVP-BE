-- Food truck scheduling: ScheduledStop table + enum
-- Additive only; no changes to existing tables.

CREATE TYPE "ScheduledStopStatus" AS ENUM ('SCHEDULED', 'LIVE', 'COMPLETED', 'CANCELLED');

CREATE TABLE "ScheduledStop" (
    "id" SERIAL NOT NULL,
    "storeId" INTEGER NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "address" TEXT NOT NULL,
    "notes" TEXT,
    "radiusMeters" INTEGER,
    "status" "ScheduledStopStatus" NOT NULL DEFAULT 'SCHEDULED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledStop_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ScheduledStop_storeId_idx" ON "ScheduledStop"("storeId");
CREATE INDEX "ScheduledStop_startsAt_idx" ON "ScheduledStop"("startsAt");
CREATE INDEX "ScheduledStop_storeId_startsAt_idx" ON "ScheduledStop"("storeId", "startsAt");
CREATE INDEX "ScheduledStop_endsAt_idx" ON "ScheduledStop"("endsAt");

ALTER TABLE "ScheduledStop"
    ADD CONSTRAINT "ScheduledStop_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
