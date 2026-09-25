-- Waiter "change money" was simplified away: change for an over-paid transfer taken at a
-- table is now handed out from the cashier's drawer when the transfer is confirmed.
DROP TABLE IF EXISTS "WaiterFloat";
ALTER TABLE "Payment" DROP COLUMN IF EXISTS "floatId";
ALTER TABLE "BranchConfiguration" DROP COLUMN IF EXISTS "waiterFloatDefault";
