-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "accessRole" TEXT NOT NULL DEFAULT 'Индивидуальная',
ADD COLUMN     "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "financialFlags" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "isBlocked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastActivityAt" DOUBLE PRECISION,
ADD COLUMN     "lockedUntil" DOUBLE PRECISION,
ADD COLUMN     "permissions" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "scopeFlags" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT,
    "employeeName" TEXT NOT NULL DEFAULT '',
    "timestamp" DOUBLE PRECISION NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "oldValue" JSONB,
    "newValue" JSONB,
    "ip" TEXT NOT NULL DEFAULT '',
    "userAgent" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditLog_timestamp_idx" ON "AuditLog"("timestamp");

-- CreateIndex
CREATE INDEX "AuditLog_employeeId_idx" ON "AuditLog"("employeeId");

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
