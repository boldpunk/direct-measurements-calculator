-- Uploaded images, moved out of base64 data URIs (see schema.prisma StoredFile).
CREATE TABLE "StoredFile" (
    "id" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "thumb" BYTEA,
    "size" INTEGER NOT NULL,
    "createdAt" DOUBLE PRECISION NOT NULL,
    "createdById" TEXT,
    CONSTRAINT "StoredFile_pkey" PRIMARY KEY ("id")
);
