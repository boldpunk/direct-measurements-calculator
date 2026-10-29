-- Client and server errors, grouped (see schema.prisma AppError).
CREATE TABLE "AppError" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "stack" TEXT NOT NULL DEFAULT '',
    "url" TEXT NOT NULL DEFAULT '',
    "userAgent" TEXT NOT NULL DEFAULT '',
    "employeeId" TEXT,
    "employeeName" TEXT NOT NULL DEFAULT '',
    "count" INTEGER NOT NULL DEFAULT 1,
    "firstAt" DOUBLE PRECISION NOT NULL,
    "lastAt" DOUBLE PRECISION NOT NULL,
    CONSTRAINT "AppError_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AppError_fingerprint_key" ON "AppError"("fingerprint");
CREATE INDEX "AppError_lastAt_idx" ON "AppError"("lastAt");
