-- CreateTable
CREATE TABLE "Service" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT '',
    "unit" TEXT NOT NULL DEFAULT 'шт.',
    "price" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "comment" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "Service_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderService" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "serviceId" TEXT,
    "name" TEXT NOT NULL,
    "qty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unit" TEXT NOT NULL DEFAULT 'шт.',
    "unitPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "OrderService_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderService_orderId_idx" ON "OrderService"("orderId");

-- AddForeignKey
ALTER TABLE "OrderService" ADD CONSTRAINT "OrderService_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderService" ADD CONSTRAINT "OrderService_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE;
