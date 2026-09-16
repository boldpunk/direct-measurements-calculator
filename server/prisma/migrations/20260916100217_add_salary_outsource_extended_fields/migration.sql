-- AlterTable
ALTER TABLE "OutsourceExpense" ADD COLUMN     "partnerId" TEXT;

-- AlterTable
ALTER TABLE "SalaryExpense" ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "date" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "employeeId" TEXT;

-- CreateIndex
CREATE INDEX "OutsourceExpense_partnerId_idx" ON "OutsourceExpense"("partnerId");

-- CreateIndex
CREATE INDEX "SalaryExpense_employeeId_idx" ON "SalaryExpense"("employeeId");

-- AddForeignKey
ALTER TABLE "OutsourceExpense" ADD CONSTRAINT "OutsourceExpense_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryExpense" ADD CONSTRAINT "SalaryExpense_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryExpense" ADD CONSTRAINT "SalaryExpense_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
