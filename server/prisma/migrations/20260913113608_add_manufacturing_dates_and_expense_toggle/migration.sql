-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "enableExpenses" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "enableManufacturingDates" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ManufacturingEntry" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "createdAt" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "ManufacturingEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ManufacturingEntry_orderId_idx" ON "ManufacturingEntry"("orderId");

-- AddForeignKey
ALTER TABLE "ManufacturingEntry" ADD CONSTRAINT "ManufacturingEntry_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
