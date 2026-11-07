-- One ticker can belong to one coin. A second launch of the same ticker is a unique violation.
CREATE UNIQUE INDEX "Coin_ticker_key" ON "Coin"("ticker");
