-- This is an empty migration.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_active_cashier_shift" 
ON "CashierShift"("cashierId") 
WHERE status IN ('OPEN', 'CLOSING');

CREATE UNIQUE INDEX IF NOT EXISTS "uq_active_order_per_table"
ON "Order"("tableId")
WHERE "status" IN ('DRAFT','SUBMITTED','CONFIRMED','PREPARING','READY','SERVED')
  AND "tableId" IS NOT NULL;
