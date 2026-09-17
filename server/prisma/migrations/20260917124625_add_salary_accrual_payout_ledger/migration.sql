-- CreateTable
CREATE TABLE "SalaryAccrual" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "period" TEXT NOT NULL DEFAULT '',
    "type" TEXT NOT NULL DEFAULT 'Другое',
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "comment" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT,
    "createdAt" DOUBLE PRECISION NOT NULL,
    "updatedAt" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "SalaryAccrual_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalaryPayout" (
    "id" TEXT NOT NULL,
    "accrualId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "paymentDate" TEXT NOT NULL,
    "paymentMethod" TEXT NOT NULL DEFAULT '',
    "comment" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT,
    "createdAt" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "SalaryPayout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SalaryAccrual_employeeId_idx" ON "SalaryAccrual"("employeeId");

-- CreateIndex
CREATE INDEX "SalaryPayout_accrualId_idx" ON "SalaryPayout"("accrualId");

-- CreateIndex
CREATE INDEX "SalaryPayout_employeeId_idx" ON "SalaryPayout"("employeeId");

-- CreateIndex
CREATE INDEX "SalaryPayout_paymentDate_idx" ON "SalaryPayout"("paymentDate");

-- AddForeignKey
ALTER TABLE "SalaryAccrual" ADD CONSTRAINT "SalaryAccrual_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryAccrual" ADD CONSTRAINT "SalaryAccrual_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryPayout" ADD CONSTRAINT "SalaryPayout_accrualId_fkey" FOREIGN KEY ("accrualId") REFERENCES "SalaryAccrual"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryPayout" ADD CONSTRAINT "SalaryPayout_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryPayout" ADD CONSTRAINT "SalaryPayout_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
