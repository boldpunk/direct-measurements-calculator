-- Tokens issued before this moment are rejected (password change / reset).
ALTER TABLE "Employee" ADD COLUMN "passwordChangedAt" DOUBLE PRECISION;
