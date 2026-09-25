export type OrderStatus = "DRAFT" | "SUBMITTED" | "CONFIRMED" | "PREPARING" | "READY" | "SERVED" | "COMPLETED" | "CANCELLED" | "VOIDED";
export type PaymentStatus = "INITIATED" | "PENDING_VERIFICATION" | "CONFIRMED" | "FAILED" | "CANCELLED" | "PARTIALLY_REFUNDED" | "FULLY_REFUNDED";
export type PrinterJobStatus = "PENDING" | "QUEUED" | "PRINTING" | "PRINTED" | "FAILED" | "RETRYING" | "CANCELLED";
export type ShiftStatus = "OPEN" | "CLOSING" | "CLOSED";
export type PaymentMethod = "CASH" | "DIGITAL";
export type PermissionCode = "order.create" | "order.submit" | "order.cancel" | "payment.collect" | "payment.confirm" | "discount.approve" | "shift.open" | "shift.close";
