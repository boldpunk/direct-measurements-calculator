-- Display-only exchange rate (see schema.prisma Settings.fxRate).
ALTER TABLE "Settings" ADD COLUMN "fxRate" JSONB;
