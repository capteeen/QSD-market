-- CreateTable
CREATE TABLE "ChainKv" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChainKv_pkey" PRIMARY KEY ("key")
);

