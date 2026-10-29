-- Client link token (see schema.prisma Order.shareToken).
ALTER TABLE "Order" ADD COLUMN "shareToken" TEXT;
CREATE UNIQUE INDEX "Order_shareToken_key" ON "Order"("shareToken");
