-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "enablePdfExtras" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "enablePurchaseSaleSplit" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "enableServicesFinanceReport" BOOLEAN NOT NULL DEFAULT false;
