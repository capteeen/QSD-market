-- CreateEnum
CREATE TYPE "CoinState" AS ENUM ('superposed', 'measured_alive', 'collapsed', 'tunnelled');

-- CreateEnum
CREATE TYPE "MeasurementOutcomeKind" AS ENUM ('survive', 'tunnel', 'collapse');

-- CreateTable
CREATE TABLE "Coin" (
    "ca" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "imageUri" TEXT NOT NULL,
    "imageHash" TEXT NOT NULL,
    "imageLineage" TEXT NOT NULL,
    "lineageId" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "motherCa" TEXT,
    "daughterCa" TEXT,
    "identityRoot" TEXT NOT NULL,
    "halfLifeSec" INTEGER NOT NULL,
    "decayProgress" DOUBLE PRECISION NOT NULL,
    "supplyMin" BIGINT NOT NULL,
    "supplyMax" BIGINT NOT NULL,
    "totalUnits" BIGINT NOT NULL,
    "remainingUnits" BIGINT NOT NULL,
    "decimals" INTEGER NOT NULL,
    "state" "CoinState" NOT NULL,
    "lastActivityAt" INTEGER NOT NULL,
    "bornAt" INTEGER NOT NULL,
    "collapsedAt" INTEGER,
    "launchPath" TEXT NOT NULL,
    "launchTx" TEXT NOT NULL,
    "launchBundle" JSONB,
    "createdBy" TEXT,
    "paymentTx" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Coin_pkey" PRIMARY KEY ("ca")
);

-- CreateTable
CREATE TABLE "Channel" (
    "id" TEXT NOT NULL,
    "coinCa" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "probabilityPpm" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "halfLifeMinSec" INTEGER NOT NULL,
    "halfLifeMaxSec" INTEGER NOT NULL,
    "poolUnitsMin" BIGINT NOT NULL,
    "poolUnitsMax" BIGINT NOT NULL,

    CONSTRAINT "Channel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Measurement" (
    "id" TEXT NOT NULL,
    "coinCa" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "at" INTEGER NOT NULL,
    "by" TEXT NOT NULL,
    "proofBundle" JSONB NOT NULL,
    "outcomeKind" "MeasurementOutcomeKind" NOT NULL,
    "outcome" JSONB NOT NULL,
    "decayBefore" DOUBLE PRECISION NOT NULL,
    "decayAfter" DOUBLE PRECISION NOT NULL,
    "precommitTx" TEXT,
    "proofTx" TEXT,
    "proofSlot" INTEGER,
    "attestationKind" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Measurement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lineage" (
    "id" TEXT NOT NULL,
    "genesisCa" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Lineage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AllocationTable" (
    "id" TEXT NOT NULL,
    "motherCa" TEXT NOT NULL,
    "daughterCa" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "totalUnits" BIGINT NOT NULL,
    "allocatedUnits" BIGINT NOT NULL,
    "dustUnits" BIGINT NOT NULL,
    "merkleRoot" TEXT NOT NULL,
    "leafCount" INTEGER NOT NULL,
    "rootAnchorTx" TEXT,
    "collapseAt" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AllocationTable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AllocationEntry" (
    "id" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "bagUnits" BIGINT NOT NULL,
    "bagFractionPpb" INTEGER NOT NULL,
    "weightBps" INTEGER NOT NULL,
    "sharePpb" INTEGER NOT NULL,
    "units" BIGINT NOT NULL,
    "leaf" TEXT NOT NULL,

    CONSTRAINT "AllocationEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AirdropEntry" (
    "id" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "units" BIGINT NOT NULL,
    "status" TEXT NOT NULL,
    "txSignature" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AirdropEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Burn" (
    "id" TEXT NOT NULL,
    "tx" TEXT NOT NULL,
    "swapTx" TEXT,
    "lamportsIn" BIGINT NOT NULL,
    "qsdBurned" BIGINT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Burn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trade" (
    "id" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "mint" TEXT NOT NULL,
    "buyer" TEXT NOT NULL,
    "lamports" BIGINT NOT NULL,
    "tokenUnits" BIGINT,
    "tokenUiAmount" DOUBLE PRECISION NOT NULL,
    "slot" INTEGER NOT NULL,
    "at" INTEGER NOT NULL,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Trade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BalanceChange" (
    "id" TEXT NOT NULL,
    "mint" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "deltaUnits" BIGINT,
    "deltaUi" DOUBLE PRECISION NOT NULL,
    "kind" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "at" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BalanceChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Identity" (
    "coinCa" TEXT NOT NULL,
    "root" TEXT NOT NULL,
    "pubSeed" TEXT NOT NULL,
    "nextIndex" INTEGER NOT NULL,
    "usedBitmap" TEXT NOT NULL,
    "remaining" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Identity_pkey" PRIMARY KEY ("coinCa")
);

-- CreateTable
CREATE TABLE "EventLog" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "coinCa" TEXT,
    "refId" TEXT,
    "tx" TEXT,
    "summary" TEXT NOT NULL,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthChallenge" (
    "nonce" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthChallenge_pkey" PRIMARY KEY ("nonce")
);

-- CreateTable
CREATE TABLE "CoinImage" (
    "coinCa" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,

    CONSTRAINT "CoinImage_pkey" PRIMARY KEY ("coinCa")
);

-- CreateIndex
CREATE UNIQUE INDEX "Coin_paymentTx_key" ON "Coin"("paymentTx");

-- CreateIndex
CREATE INDEX "Coin_state_idx" ON "Coin"("state");

-- CreateIndex
CREATE INDEX "Coin_lineageId_idx" ON "Coin"("lineageId");

-- CreateIndex
CREATE INDEX "Coin_createdBy_idx" ON "Coin"("createdBy");

-- CreateIndex
CREATE INDEX "Channel_coinCa_position_idx" ON "Channel"("coinCa", "position");

-- CreateIndex
CREATE UNIQUE INDEX "Channel_coinCa_channelId_key" ON "Channel"("coinCa", "channelId");

-- CreateIndex
CREATE INDEX "Measurement_at_idx" ON "Measurement"("at");

-- CreateIndex
CREATE UNIQUE INDEX "Measurement_coinCa_index_key" ON "Measurement"("coinCa", "index");

-- CreateIndex
CREATE UNIQUE INDEX "AllocationTable_daughterCa_key" ON "AllocationTable"("daughterCa");

-- CreateIndex
CREATE INDEX "AllocationTable_motherCa_idx" ON "AllocationTable"("motherCa");

-- CreateIndex
CREATE INDEX "AllocationEntry_wallet_idx" ON "AllocationEntry"("wallet");

-- CreateIndex
CREATE UNIQUE INDEX "AllocationEntry_tableId_wallet_key" ON "AllocationEntry"("tableId", "wallet");

-- CreateIndex
CREATE UNIQUE INDEX "AirdropEntry_tableId_wallet_key" ON "AirdropEntry"("tableId", "wallet");

-- CreateIndex
CREATE UNIQUE INDEX "Burn_tx_key" ON "Burn"("tx");

-- CreateIndex
CREATE INDEX "Burn_at_idx" ON "Burn"("at");

-- CreateIndex
CREATE INDEX "Trade_mint_buyer_at_idx" ON "Trade"("mint", "buyer", "at");

-- CreateIndex
CREATE INDEX "Trade_mint_at_idx" ON "Trade"("mint", "at");

-- CreateIndex
CREATE UNIQUE INDEX "Trade_signature_mint_buyer_key" ON "Trade"("signature", "mint", "buyer");

-- CreateIndex
CREATE INDEX "BalanceChange_mint_wallet_at_idx" ON "BalanceChange"("mint", "wallet", "at");

-- CreateIndex
CREATE UNIQUE INDEX "BalanceChange_signature_mint_wallet_kind_key" ON "BalanceChange"("signature", "mint", "wallet", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "Identity_root_key" ON "Identity"("root");

-- CreateIndex
CREATE INDEX "EventLog_at_idx" ON "EventLog"("at");

-- CreateIndex
CREATE INDEX "EventLog_type_at_idx" ON "EventLog"("type", "at");

-- CreateIndex
CREATE INDEX "AuthChallenge_wallet_purpose_idx" ON "AuthChallenge"("wallet", "purpose");

-- AddForeignKey
ALTER TABLE "Coin" ADD CONSTRAINT "Coin_lineageId_fkey" FOREIGN KEY ("lineageId") REFERENCES "Lineage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Channel" ADD CONSTRAINT "Channel_coinCa_fkey" FOREIGN KEY ("coinCa") REFERENCES "Coin"("ca") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Measurement" ADD CONSTRAINT "Measurement_coinCa_fkey" FOREIGN KEY ("coinCa") REFERENCES "Coin"("ca") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllocationTable" ADD CONSTRAINT "AllocationTable_daughterCa_fkey" FOREIGN KEY ("daughterCa") REFERENCES "Coin"("ca") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllocationEntry" ADD CONSTRAINT "AllocationEntry_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "AllocationTable"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AirdropEntry" ADD CONSTRAINT "AirdropEntry_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "AllocationTable"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_mint_fkey" FOREIGN KEY ("mint") REFERENCES "Coin"("ca") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Identity" ADD CONSTRAINT "Identity_coinCa_fkey" FOREIGN KEY ("coinCa") REFERENCES "Coin"("ca") ON DELETE CASCADE ON UPDATE CASCADE;

