-- AlterTable
ALTER TABLE "SalaryAccrual" ADD COLUMN     "orderId" TEXT;

-- CreateIndex
CREATE INDEX "SalaryAccrual_orderId_idx" ON "SalaryAccrual"("orderId");

-- AddForeignKey
ALTER TABLE "SalaryAccrual" ADD CONSTRAINT "SalaryAccrual_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
