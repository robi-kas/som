export interface PeriodReport {
  grossSales: string;
  discounts: string;
  refunds: string;
  netSales: string;
  cashSales: string;
  digitalSales: string;
  orderCount: number;
  averageOrderValue: string;
  serviceCharge: string;
  tax: string;
  totalBilled: string;
  takings: string;
  payments: { method: string; name?: string; count: number; total: string }[];
  voids: { orders: number; ordersValue: string; items: number; itemsValue: string };
  refundCount: number;
  topProducts: { name: string; quantity: number; revenue: string }[];
  slowProducts: { name: string; quantity: number; revenue: string }[];
  hourly: { hour: number; orders: number; sales: string }[];
  series?: { date: string; sales: string; orders: number }[];
}

export interface Dashboard {
  todaySales: string;
  ordersClosedToday: number;
  averageOrderValue: string;
  takingsByMethod: { method: string; name?: string; total: string }[];
  openOrdersCount: number;
  tablesTotal: number;
  occupiedTablesCount: number;
  tablesWaitingForPaymentCount: number;
  ordersWaitingTooLongCount: number;
  printerFailuresCount: number;
  printersOffline: number;
  activeEmployeesCount: number;
  needsAttention: { paymentVerifications: number; refundApprovals: number; drawerVariances: number; lateTickets: number; printerProblems: number };
}

export const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`;
