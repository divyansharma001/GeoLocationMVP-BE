-- Support public event discovery and merchant/service dashboards
CREATE INDEX IF NOT EXISTS "Event_status_startDate_cityId_idx"
ON "Event"("status", "startDate", "cityId");

CREATE INDEX IF NOT EXISTS "Event_merchantId_status_startDate_idx"
ON "Event"("merchantId", "status", "startDate");

CREATE INDEX IF NOT EXISTS "Service_status_publishedAt_idx"
ON "Service"("status", "publishedAt");

CREATE INDEX IF NOT EXISTS "ServiceBooking_merchantId_status_bookingDate_idx"
ON "ServiceBooking"("merchantId", "status", "bookingDate");
