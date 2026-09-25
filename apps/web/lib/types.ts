// Shapes returned by the API (apps/api). Money is always a string like "847.55".

export interface Me {
  user: { id: string; username: string; displayName: string; forcePasswordChange: boolean; hasPin: boolean };
  organization: { id: string; name: string; logoUrl: string | null };
  branches: {
    id: string;
    name: string;
    currency: string;
    ticketWarnMinutes: number;
    ticketLateMinutes: number;
    waiterPayments?: boolean;
    waiterPhotoRequired?: boolean;
  }[];
  permissions: string[];
  roleNames: string[];
  /** Prep stations this person works at (barista → Coffee). */
  stations: { id: string; name: string; branchId: string }[];
}

export interface Modifier {
  id: string;
  name: string;
  priceDelta: string;
}

export interface Product {
  id: string;
  name: string;
  description: string | null;
  sellingPrice: string;
  status: 'AVAILABLE' | 'OUT_OF_STOCK' | 'INACTIVE';
  categoryId: string;
  category?: { name: string };
  isActive: boolean;
  preparationStationId: string | null;
  imageReference: string | null;
  version: number;
  modifiers: Modifier[];
}

export interface Category {
  id: string;
  name: string;
  displayOrder: number;
  isActive: boolean;
}

export type TableStatus = 'AVAILABLE' | 'OCCUPIED' | 'WAITING_FOR_PAYMENT' | 'OUT_OF_SERVICE';

export interface FloorTable {
  id: string;
  branchId: string;
  name: string;
  capacity: number;
  status: TableStatus;
  version: number;
  activeOrderId: string | null;
  order: null | {
    id: string;
    orderNumber: string;
    status: string;
    paymentStatus: string;
    totalAmount: string;
    openedAt: string;
    waiterId: string | null;
    waiterName: string | null;
    itemCount: number;
    pendingCount: number;
    inKitchenCount: number;
    readyCount: number;
  };
}

export type ItemStatus = 'PENDING' | 'SENT_TO_KITCHEN' | 'PREPARING' | 'READY' | 'SERVED' | 'CANCELLED' | 'VOIDED';

export interface OrderItem {
  id: string;
  productId: string;
  productNameSnapshot: string;
  unitPriceSnapshot: string;
  quantity: number;
  notes: string | null;
  status: ItemStatus;
  version: number;
  modifiers: { id: string | null; name: string; priceDelta: string }[];
  lineTotal: string;
}

export interface PaymentSummary {
  id: string;
  method: string;
  methodName: string | null;
  payerBank: string | null;
  status: string;
  appliedAmount: string;
  tenderedAmount: string;
  changeAmount: string;
  referenceNumber: string | null;
  receivedById: string;
  /** What can still be given back (confirmed payments only). */
  refundableAmount?: string;
  receivedByName?: string | null;
  /** Recorded on a waiter's phone at the table. */
  reportedByWaiter?: boolean;
  hasEvidence?: boolean;
  rejectedReason?: string | null;
  createdAt: string;
}

export interface OrderDetail {
  id: string;
  orderNumber: string;
  branchId: string;
  tableId: string | null;
  tableName: string | null;
  tableStatus: TableStatus | null;
  waiterId: string | null;
  waiterName: string | null;
  type: string;
  status: string;
  paymentStatus: string;
  subtotal: string;
  discountAmount: string;
  discountType: 'PERCENT' | 'FIXED' | null;
  discountValue: string | null;
  discountReason: string | null;
  serviceChargeAmount: string;
  taxAmount: string;
  totalAmount: string;
  paidAmount: string;
  balanceDue: string;
  currency: string;
  version: number;
  createdAt: string;
  closedAt: string | null;
  items: OrderItem[];
  payments: PaymentSummary[];
  canEdit: boolean;
}

export interface OrderListRow {
  id: string;
  orderNumber: string;
  tableId: string | null;
  tableName: string;
  tableStatus: TableStatus | null;
  type: string;
  status: string;
  paymentStatus: string;
  totalAmount: string;
  paidAmount: string;
  balanceDue: string;
  hasPendingVerification: boolean;
  currency: string;
  itemCount: number;
  readyCount: number;
  createdAt: string;
  updatedAt: string;
  waiterName: string;
}

export interface KdsTicket {
  id: string;
  orderId: string;
  orderNumber: string;
  tableName: string;
  waiterName: string;
  stationId: string;
  stationName: string;
  ticketType: 'NEW_ORDER' | 'ADDITION' | 'CANCELLATION';
  status: 'PENDING' | 'PREPARING';
  firedAt: string;
  minutesAgo: number;
  items: { id: string; productNameSnapshot: string; quantity: number; notes: string | null; status: string; modifiers: string[] }[];
}

export interface Shift {
  id: string;
  branchId: string;
  cashierId: string;
  status: string;
  openingFloat: string;
  openedAt: string;
}

export type MethodKind = 'CASH' | 'CARD' | 'MOBILE_MONEY' | 'BANK_APP' | 'OTHER';

export interface PaymentMethodConfig {
  id: string;
  code: string;
  name: string;
  kind: MethodKind;
  requiresReference: boolean;
  requiresProof: boolean;
  requiresVerification: boolean;
  askPayerBank: boolean;
  accountInfo: string | null;
  isActive: boolean;
  displayOrder: number;
}

export interface RefundRow {
  id: string;
  orderId: string;
  paymentId: string;
  amount: string;
  method: string;
  status: 'PENDING' | 'APPROVED' | 'CONFIRMED' | string;
  reason: string;
  createdAt: string;
  confirmedAt: string | null;
}
