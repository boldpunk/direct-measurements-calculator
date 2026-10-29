-- Web Push: per-company VAPID keys and per-device subscriptions.
ALTER TABLE "Settings" ADD COLUMN "vapidPublicKey" TEXT, ADD COLUMN "vapidPrivateKey" TEXT;
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "keys" JSONB NOT NULL,
    "userAgent" TEXT NOT NULL DEFAULT '',
    "createdAt" DOUBLE PRECISION NOT NULL,
    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");
CREATE INDEX "PushSubscription_employeeId_idx" ON "PushSubscription"("employeeId");
