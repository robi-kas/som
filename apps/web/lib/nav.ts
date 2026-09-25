import type { IconName } from '@/components/ui/Icon';

/** Manage sections, grouped the way the desktop sidebar shows them. */
export interface AdminSection {
  href: string;
  label: string;
  icon: IconName;
  permission: string;
  group: 'Today' | 'Money' | 'Setup';
  /** Extra words the Ctrl+K search should match. */
  keywords?: string;
}

export const ADMIN_SECTIONS: AdminSection[] = [
  { href: '/admin', label: 'Today', icon: 'chart', permission: 'report.view', group: 'Today', keywords: 'dashboard home sales' },
  { href: '/admin/approvals', label: 'Needs attention', icon: 'flag', permission: 'report.view', group: 'Today', keywords: 'approve verify refund drawer difference' },
  { href: '/admin/reports', label: 'Reports', icon: 'receipt', permission: 'report.view_financial', group: 'Money', keywords: 'sales z report items waiters hours' },
  { href: '/admin/prints', label: 'Printed bills', icon: 'receipt', permission: 'receipt.view', group: 'Money', keywords: 'receipts print log reprint copy' },
  { href: '/admin/activity', label: 'Activity log', icon: 'log', permission: 'report.view', group: 'Money', keywords: 'audit history who did' },
  { href: '/admin/menu', label: 'Menu', icon: 'menu', permission: 'product.update', group: 'Setup', keywords: 'items products prices photos categories stock' },
  { href: '/admin/tables', label: 'Tables', icon: 'tables', permission: 'table.update', group: 'Setup', keywords: 'floor seats' },
  { href: '/admin/staff', label: 'Staff', icon: 'users', permission: 'user.manage', group: 'Setup', keywords: 'people users waiters roles password' },
  { href: '/admin/printers', label: 'Kitchen & printers', icon: 'printer', permission: 'printer.view', group: 'Setup', keywords: 'stations printer ip test' },
  { href: '/admin/settings', label: 'Settings', icon: 'settings', permission: 'report.view', group: 'Setup', keywords: 'vat tax logo name payment methods telebirr bank reset' },
];
