import { Prisma } from '@prisma/client';
import type { Order, OrderItem, KitchenTicket, Category, Product, Table, BranchConfiguration, KitchenStation, Payment, CashierShift, CashMovement } from '@prisma/client';

export interface OrderItemResponseDto {
  id: string;
  orderId: string;
  kitchenTicketId: string | null;
  stationId: string | null;
  productId: string;
  productNameSnapshot: string;
  unitPriceSnapshot: string;
  quantity: number;
  notes: string | null;
  status: string;
  version: number;
}

export interface KitchenTicketResponseDto {
  id: string;
  orderId: string;
  stationId: string;
  fireBatchNumber: number;
  ticketType: string;
  status: string;
  version: number;
  firedAt: Date;
}

export interface OrderResponseDto {
  paidAmount?: string;
  id: string;
  orderNumber: string;
  branchId: string;
  tableId: string | null;
  waiterId: string | null;
  type: string;
  status: string;
  paymentStatus: string;
  subtotal: string;
  discountAmount: string;
  serviceChargeAmount: string;
  taxAmount: string;
  totalAmount: string;
  currency: string;
  version: number;
  items?: OrderItemResponseDto[];
  tickets?: KitchenTicketResponseDto[];
}

export function toOrderItemResponse(entity: OrderItem): OrderItemResponseDto {
  return {
    id: entity.id,
    orderId: entity.orderId,
    kitchenTicketId: entity.kitchenTicketId,
    stationId: entity.stationId,
    productId: entity.productId,
    productNameSnapshot: entity.productNameSnapshot,
    unitPriceSnapshot: entity.unitPriceSnapshot.toString(),
    quantity: entity.quantity,
    notes: entity.notes,
    status: entity.status,
    version: entity.version,
  };
}

export function toKitchenTicketResponse(entity: KitchenTicket): KitchenTicketResponseDto {
  return {
    id: entity.id,
    orderId: entity.orderId,
    stationId: entity.stationId,
    fireBatchNumber: entity.fireBatchNumber,
    ticketType: entity.ticketType,
    status: entity.status,
    version: entity.version,
    firedAt: entity.firedAt,
  };
}

export function toOrderResponse(entity: Order & { items?: OrderItem[], tickets?: KitchenTicket[], payments?: import('@prisma/client').Payment[] }): OrderResponseDto {
  return {
    id: entity.id,
    orderNumber: entity.orderNumber,
    branchId: entity.branchId,
    tableId: entity.tableId,
    waiterId: entity.waiterId,
    type: entity.type,
    status: entity.status,
    paymentStatus: entity.paymentStatus,
    subtotal: entity.subtotal.toString(),
    discountAmount: entity.discountAmount.toString(),
    serviceChargeAmount: entity.serviceChargeAmount.toString(),
    taxAmount: entity.taxAmount.toString(),
    totalAmount: entity.totalAmount.toString(),
    currency: entity.currency,
    paidAmount: entity.payments
      ? entity.payments
          .filter(p => p.status === 'CONFIRMED')
          .reduce((acc, p) => acc.add(p.appliedAmount), new Prisma.Decimal(0))
          .toString()
      : undefined,
    version: entity.version,
    items: entity.items ? entity.items.map(toOrderItemResponse) : undefined,
    tickets: entity.tickets ? entity.tickets.map(toKitchenTicketResponse) : undefined,
  };
}

export interface CategoryResponseDto {
  id: string;
  name: string;
  branchId: string;
  displayOrder: number;
  isActive: boolean;
}

export function toCategoryResponse(entity: Category): CategoryResponseDto {
  return {
    id: entity.id,
    name: entity.name,
    branchId: entity.branchId,
    displayOrder: entity.displayOrder,
    isActive: entity.isActive,
  };
}

export interface ProductResponseDto {
  id: string;
  name: string;
  categoryId: string;
  branchId: string;
  sellingPrice: string;
  status: string;
  preparationStationId: string | null;
}

export function toProductResponse(entity: Product): ProductResponseDto {
  return {
    id: entity.id,
    name: entity.name,
    categoryId: entity.categoryId,
    branchId: entity.branchId,
    sellingPrice: entity.sellingPrice.toString(),
    status: entity.status,
    preparationStationId: entity.preparationStationId,
  };
}

export interface TableResponseDto {
  id: string;
  name: string;
  branchId: string;
  capacity: number;
  status: string;
}

export function toTableResponse(entity: Table): TableResponseDto {
  return {
    id: entity.id,
    name: entity.name,
    branchId: entity.branchId,
    capacity: entity.capacity,
    status: entity.status,
  };
}

export interface KitchenStationResponseDto {
  id: string;
  name: string;
  branchId: string;
  displayOrder: number;
  isActive: boolean;
}

export function toKitchenStationResponse(entity: KitchenStation): KitchenStationResponseDto {
  return {
    id: entity.id,
    name: entity.name,
    branchId: entity.branchId,
    displayOrder: entity.displayOrder,
    isActive: entity.isActive,
  };
}


export interface PaymentResponseDto {
  id: string;
  orderId: string;
  method: string;
  currency: string;
  tenderedAmount: string;
  appliedAmount: string;
  changeAmount: string;
  status: string;
  referenceNumber: string | null;
  confirmedAt: Date | null;
  createdAt: Date;
}

export function toPaymentResponse(entity: Payment): PaymentResponseDto {
  return {
    id: entity.id,
    orderId: entity.orderId,
    method: entity.method,
    currency: entity.currency,
    tenderedAmount: entity.tenderedAmount.toString(),
    appliedAmount: entity.appliedAmount.toString(),
    changeAmount: entity.changeAmount.toString(),
    status: entity.status,
    referenceNumber: entity.referenceNumber,
    confirmedAt: entity.confirmedAt,
    createdAt: entity.createdAt,
  };
}

export interface ShiftResponseDto {
  id: string;
  branchId: string;
  cashierId: string;
  status: string;
  openingFloat: string;
  openedAt: Date;
}

export function toShiftResponse(entity: CashierShift): ShiftResponseDto {
  return {
    id: entity.id,
    branchId: entity.branchId,
    cashierId: entity.cashierId,
    status: entity.status,
    openingFloat: entity.openingFloat.toString(),
    openedAt: entity.openedAt,
  };
}

export interface CashMovementResponseDto {
  id: string;
  shiftId: string;
  type: string;
  amount: string;
  reason: string | null;
  createdAt: Date;
}

export function toCashMovementResponse(entity: CashMovement): CashMovementResponseDto {
  return {
    id: entity.id,
    shiftId: entity.shiftId,
    type: entity.type,
    amount: entity.amount.toString(),
    reason: entity.reason,
    createdAt: entity.createdAt,
  };
}


import { Refund, RefundItem } from '@prisma/client';


export interface RefundResponseDto {
  id: string;
  orderId: string;
  paymentId: string;
  amount: string;
  method: string;
  status: string;
  reason: string;
  initiatedById: string;
  approvedById: string | null;
  createdAt: Date;
  confirmedAt: Date | null;
  items?: {
    id: string;
    orderItemId: string;
    quantity: string;
    refundedAmount: string;
  }[];
}

type RefundWithItems = Refund & { items?: RefundItem[] };

export function toRefundResponse(entity: RefundWithItems): RefundResponseDto {
  return {
    id: entity.id,
    orderId: entity.orderId,
    paymentId: entity.paymentId,
    amount: entity.amount.toString(),
    method: entity.method,
    status: entity.status,
    reason: entity.reason,
    initiatedById: entity.initiatedById,
    approvedById: entity.approvedById,
    createdAt: entity.createdAt,
    confirmedAt: entity.confirmedAt,
    items: entity.items?.map((item: RefundItem) => ({
      id: item.id,
      orderItemId: item.orderItemId,
      quantity: item.quantity.toString(),
      refundedAmount: item.refundedAmount.toString(),
    })),
  };
}
