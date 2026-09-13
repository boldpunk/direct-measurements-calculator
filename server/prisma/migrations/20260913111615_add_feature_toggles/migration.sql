-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "enableProductType" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "enableStages" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "enableWeight" BOOLEAN NOT NULL DEFAULT true;
