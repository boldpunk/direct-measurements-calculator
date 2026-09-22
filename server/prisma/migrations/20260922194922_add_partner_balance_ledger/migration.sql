-- CreateTable
CREATE TABLE "PartnerBalanceTransaction" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT '$',
    "date" TEXT NOT NULL,
    "comment" TEXT NOT NULL DEFAULT '',
    "previousBalance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "balanceAfter" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isInitial" BOOLEAN NOT NULL DEFAULT false,
    "reversalOfId" TEXT,
    "outsourceExpenseId" TEXT,
    "createdById" TEXT,
    "createdAt" DOUBLE PRECISION NOT NULL,
    "updatedAt" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "PartnerBalanceTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PartnerBalanceTransaction_reversalOfId_key" ON "PartnerBalanceTransaction"("reversalOfId");

-- CreateIndex
CREATE INDEX "PartnerBalanceTransaction_partnerId_idx" ON "PartnerBalanceTransaction"("partnerId");

-- CreateIndex
CREATE INDEX "PartnerBalanceTransaction_partnerId_currency_idx" ON "PartnerBalanceTransaction"("partnerId", "currency");

-- CreateIndex
CREATE INDEX "PartnerBalanceTransaction_createdAt_idx" ON "PartnerBalanceTransaction"("createdAt");

-- AddForeignKey
ALTER TABLE "PartnerBalanceTransaction" ADD CONSTRAINT "PartnerBalanceTransaction_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerBalanceTransaction" ADD CONSTRAINT "PartnerBalanceTransaction_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "PartnerBalanceTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerBalanceTransaction" ADD CONSTRAINT "PartnerBalanceTransaction_outsourceExpenseId_fkey" FOREIGN KEY ("outsourceExpenseId") REFERENCES "OutsourceExpense"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerBalanceTransaction" ADD CONSTRAINT "PartnerBalanceTransaction_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
