import { Prisma } from '@prisma/client';

/**
 * The one place the API calculates money.
 *
 * Why a single function: totals used to be computed in four services with slightly different
 * rules (no rounding, tax-inclusive ignored, floats in shift close). A bill must come out the
 * same everywhere — on the waiter's phone, on the receipt, and in the Z-report — so every
 * caller goes through computeOrderTotals().
 *
 * All values are Prisma.Decimal (decimal.js). Never use JS numbers for money: 0.1 + 0.2 !== 0.3.
 */

const D = Prisma.Decimal;
type Dec = Prisma.Decimal;
export type RoundingMode = 'HALF_UP' | 'HALF_EVEN' | 'FLOOR' | 'CEIL';
export type DiscountType = 'PERCENT' | 'FIXED';

const ROUNDING: Record<RoundingMode, Prisma.Decimal.Rounding> = {
  HALF_UP: D.ROUND_HALF_UP,
  HALF_EVEN: D.ROUND_HALF_EVEN,
  FLOOR: D.ROUND_FLOOR,
  CEIL: D.ROUND_CEIL,
};

export function roundMoney(value: Dec, mode: RoundingMode = 'HALF_UP'): Dec {
  return value.toDecimalPlaces(2, ROUNDING[mode] ?? D.ROUND_HALF_UP);
}

/** Parses a money string ("12.50") strictly. Throws on anything that isn't a non-negative 2dp amount. */
export function parseMoney(input: string | number): Dec {
  const text = typeof input === 'number' ? input.toString() : input.trim();
  if (!/^\d{1,16}(\.\d{1,2})?$/.test(text)) {
    throw new Error(`Invalid money amount: ${text}`);
  }
  return new D(text);
}

export interface PricedLine {
  unitPrice: Dec;
  modifierDeltas: Dec[];
  quantity: number;
}

export interface PricingConfig {
  taxRatePercent: Dec;
  isTaxInclusive: boolean;
  serviceChargePercent: Dec;
  roundingMode: RoundingMode;
}

export interface OrderDiscount {
  type: DiscountType;
  value: Dec;
}

export interface OrderTotals {
  subtotal: Dec;
  discountAmount: Dec;
  serviceChargeAmount: Dec;
  taxAmount: Dec;
  totalAmount: Dec;
}

export function lineTotal(line: PricedLine): Dec {
  const unit = line.modifierDeltas.reduce((acc, d) => acc.add(d), line.unitPrice);
  return unit.mul(line.quantity);
}

/**
 * subtotal  = Σ (unit price + add-ons) × qty
 * discount  = % of subtotal (rounded) or fixed amount (capped at subtotal)
 * service   = service% × (subtotal − discount), rounded
 * Exclusive: VAT = VAT% × (net + service), rounded; total = net + service + VAT
 * Inclusive: menu prices already contain VAT; VAT is the part of (net + service) that is tax.
 */
export function computeOrderTotals(lines: PricedLine[], config: PricingConfig, discount?: OrderDiscount | null): OrderTotals {
  const mode = config.roundingMode;
  const subtotal = lines.reduce((acc, l) => acc.add(lineTotal(l)), new D(0));

  let discountAmount = new D(0);
  if (discount) {
    discountAmount =
      discount.type === 'PERCENT'
        ? roundMoney(subtotal.mul(D.min(discount.value, 100)).div(100), mode)
        : D.min(discount.value, subtotal);
  }

  const net = subtotal.sub(discountAmount);
  const serviceChargeAmount = roundMoney(net.mul(config.serviceChargePercent).div(100), mode);
  const gross = net.add(serviceChargeAmount);

  let taxAmount: Dec;
  let totalAmount: Dec;
  if (config.isTaxInclusive) {
    const base = gross.div(new D(1).add(config.taxRatePercent.div(100)));
    taxAmount = roundMoney(gross.sub(base), mode);
    totalAmount = gross;
  } else {
    taxAmount = roundMoney(gross.mul(config.taxRatePercent).div(100), mode);
    totalAmount = gross.add(taxAmount);
  }

  return { subtotal, discountAmount, serviceChargeAmount, taxAmount, totalAmount };
}

/** Reads the tax / service / rounding snapshot stored on an order when it was opened. */
export function pricingConfigFromOrder(order: {
  taxConfigSnapshot: Prisma.JsonValue | null;
  serviceChargeConfigSnapshot: Prisma.JsonValue | null;
  roundingModeSnapshot: string | null;
}): PricingConfig {
  const tax = (order.taxConfigSnapshot ?? {}) as Record<string, unknown>;
  const service = (order.serviceChargeConfigSnapshot ?? {}) as Record<string, unknown>;
  const mode = (order.roundingModeSnapshot ?? 'HALF_UP') as RoundingMode;
  return {
    taxRatePercent: new D(typeof tax.taxRate === 'string' || typeof tax.taxRate === 'number' ? tax.taxRate : 0),
    isTaxInclusive: tax.isTaxInclusive === true,
    serviceChargePercent: new D(typeof service.rate === 'string' || typeof service.rate === 'number' ? service.rate : 0),
    roundingMode: mode in ROUNDING ? mode : 'HALF_UP',
  };
}

/**
 * Recomputes and returns an order's totals from its live (non-cancelled) items.
 * Call inside the same transaction that changed the items.
 */
export async function recalculateOrderTotals(tx: Prisma.TransactionClient, orderId: string): Promise<OrderTotals> {
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
  const items = await tx.orderItem.findMany({
    where: { orderId, status: { notIn: ['CANCELLED', 'VOIDED'] } },
    include: { modifiers: true },
  });
  const lines: PricedLine[] = items.map((i) => ({
    unitPrice: i.unitPriceSnapshot,
    modifierDeltas: i.modifiers.map((m) => m.priceDeltaSnapshot),
    quantity: i.quantity,
  }));
  const discount =
    order.discountType && order.discountValue
      ? { type: order.discountType as DiscountType, value: order.discountValue }
      : null;
  return computeOrderTotals(lines, pricingConfigFromOrder(order), discount);
}
