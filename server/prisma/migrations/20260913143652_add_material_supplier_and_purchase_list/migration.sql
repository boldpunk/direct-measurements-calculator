-- AlterTable
ALTER TABLE "Material" ADD COLUMN     "supplier" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "enablePurchaseList" BOOLEAN NOT NULL DEFAULT false;
