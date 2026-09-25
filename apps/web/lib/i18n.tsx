'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

/**
 * English / Amharic. Floor screens (waiter, kitchen, cashier, login) are fully translated;
 * admin screens stay in English. Amharic strings should be reviewed by a native speaker
 * working in the cafe before launch — terms differ between cafes.
 */
const en = {
  'app.name': 'New Chapter POS',
  'common.cancel': 'Cancel',
  'common.confirm': 'Confirm',
  'common.save': 'Save',
  'common.close': 'Close',
  'common.back': 'Back',
  'common.retry': 'Try again',
  'common.loading': 'Loading…',
  'common.search': 'Search',
  'common.offline': 'Offline',
  'common.online': 'Live',
  'common.reconnecting': 'Reconnecting…',
  'common.logout': 'Log out',
  'common.language': 'አማርኛ',
  'common.items': '{n} items',
  'common.item': '1 item',
  'common.total': 'Total',
  'common.subtotal': 'Subtotal',
  'common.discount': 'Discount',
  'common.service': 'Service charge',
  'common.vat': 'VAT',
  'common.minutes': '{n} min',
  'common.takeaway': 'Takeaway',
  'common.note': 'Note',

  'login.title': 'Sign in',
  'login.username': 'Username',
  'login.password': 'Password',
  'login.submit': 'Sign in',
  'login.failed': 'Wrong username or password. After 5 tries the account locks for 15 minutes.',
  'login.cafe': 'Cafe code',

  'nav.floor': 'Floor',
  'nav.cashier': 'Cashier',
  'nav.payments': 'Payments',
  'nav.kitchen': 'Kitchen',
  'nav.admin': 'Manage',

  'table.free': 'Free',
  'table.seated': 'Seated',
  'table.ready': '{n} ready',
  'table.bill': 'Bill asked',
  'table.off': 'Closed',
  'table.inKitchen': 'In kitchen',
  'table.notSent': 'Not sent',
  'table.newTakeaway': 'New takeaway',
  'table.guests': '{n} seats',
  'table.mine': 'Mine',
  'table.all': 'All',
  'table.readyBanner': 'Food ready for {tables}',

  'order.searchMenu': 'Search menu…',
  'order.sendKitchen': 'Send order',
  'order.queued': 'Queued — sends when online',
  'order.review': 'Review',
  'order.noItems': 'Tap items on the menu to add them.',
  'order.outOfStock': 'Out of stock',
  'order.addNote': 'Add note (e.g. no onions)',
  'order.add': 'Add',
  'order.addWith': 'Add · {price}',
  'order.remove': 'Remove',
  'order.serve': 'Mark served',
  'order.serveAll': 'Serve all ready',
  'order.requestBill': 'Request bill',
  'order.moveTable': 'Move table',
  'order.voidOrder': 'Cancel order',
  'order.reason': 'Reason',
  'order.status.PENDING': 'Not sent',
  'order.status.SENT_TO_KITCHEN': 'Sent',
  'order.status.PREPARING': 'Cooking',
  'order.status.READY': 'Ready',
  'order.status.SERVED': 'Served',
  'order.status.CANCELLED': 'Removed',
  'order.sent': 'Sent — each station has its part',
  'order.billRequested': 'Cashier notified',
  'order.closed': 'This order is closed.',
  'order.pickTable': 'Move to which table?',
  'order.onTable': 'Order',

  'kds.title': 'Kitchen',
  'kds.allStations': 'All stations',
  'kds.start': 'Start',
  'kds.done': 'Done',
  'kds.dismiss': 'Seen',
  'kds.void': 'VOID',
  'kds.addition': 'ADDITION',
  'kds.empty': 'No open tickets. Nice.',
  'kds.recall': 'Recall',
  'kds.sound': 'Turn on sound',
  'kds.stock': 'Out of stock',
  'kds.stockHelp': 'Tap an item to mark it finished. Waiters see it greyed out immediately.',
  'kds.inStock': 'Available',
  'kds.finished': 'Finished',

  'cashier.openBills': 'Open bills',
  'cashier.noBills': 'No open bills.',
  'cashier.billAsked': 'Bill asked',
  'cashier.eating': 'Eating',
  'cashier.pending': 'Pending check',
  'cashier.partPaid': 'Part paid',
  'cashier.pay': 'Take payment',
  'cashier.amountDue': 'Due',
  'cashier.tendered': 'Customer gives',
  'cashier.change': 'Change due',
  'cashier.reference': 'Transaction reference',
  'cashier.referenceHint': 'From the customer’s SMS',
  'cashier.photo': 'Add screenshot',
  'cashier.split': 'Split',
  'cashier.splitEqual': 'Split equally',
  'cashier.payPart': 'Pay part',
  'cashier.printBill': 'Print bill',
  'cashier.reprint': 'Reprint receipt',
  'cashier.discount': 'Discount',
  'cashier.shiftClosed': 'Your cash drawer is closed',
  'cashier.openShift': 'Open drawer',
  'cashier.openingFloat': 'Cash in drawer now',
  'cashier.closeShift': 'Close drawer',
  'cashier.countDrawer': 'Count the drawer',
  'cashier.paid': 'Paid',
  'cashier.waitingVerify': 'Waiting for manager to verify',
  'cashier.selectBill': 'Pick a bill on the left.',

  'approval.title': 'Manager approval',
  'approval.why': 'This needs a manager: {what}',
  'approval.manager': 'Manager username',
  'approval.pin': 'PIN',
  'approval.approve': 'Approve',
  'approval.denied': 'Wrong username or PIN',
  'perm.order.void_item': 'remove an item the kitchen already has',
  'perm.order.void': 'cancel an order the kitchen already has',
  'perm.order.discount_large': 'a large discount',
  'perm.refund.approve': 'a refund above the cashier limit',
  'perm.receipt.reprint': 'reprint a receipt',
  'perm.shift.approve_variance': 'a drawer that doesn’t balance',
} as const;

type Key = keyof typeof en;

const am: Partial<Record<Key, string>> = {
  'common.cancel': 'ሰርዝ',
  'common.confirm': 'አረጋግጥ',
  'common.save': 'አስቀምጥ',
  'common.close': 'ዝጋ',
  'common.back': 'ተመለስ',
  'common.retry': 'እንደገና ሞክር',
  'common.loading': 'በመጫን ላይ…',
  'common.search': 'ፈልግ',
  'common.offline': 'ከመስመር ውጭ',
  'common.online': 'በቀጥታ',
  'common.reconnecting': 'እንደገና በመገናኘት ላይ…',
  'common.logout': 'ውጣ',
  'common.language': 'English',
  'common.items': '{n} ዕቃዎች',
  'common.item': '1 ዕቃ',
  'common.total': 'ጠቅላላ',
  'common.subtotal': 'ንዑስ ድምር',
  'common.discount': 'ቅናሽ',
  'common.service': 'የአገልግሎት ክፍያ',
  'common.vat': 'ተ.እ.ታ',
  'common.minutes': '{n} ደቂቃ',
  'common.takeaway': 'ለመውሰድ',
  'common.note': 'ማስታወሻ',

  'login.title': 'ግባ',
  'login.username': 'የተጠቃሚ ስም',
  'login.password': 'የይለፍ ቃል',
  'login.submit': 'ግባ',
  'login.failed': 'የተጠቃሚ ስም ወይም የይለፍ ቃል ተሳስቷል። ከ5 ሙከራ በኋላ መለያው ለ15 ደቂቃ ይቆለፋል።',
  'login.cafe': 'የካፌ ኮድ',

  'nav.floor': 'ጠረጴዛዎች',
  'nav.cashier': 'ገንዘብ ተቀባይ',
  'nav.payments': 'ክፍያዎች',
  'nav.kitchen': 'ማብሰያ ቤት',
  'nav.admin': 'አስተዳደር',

  'table.free': 'ነፃ',
  'table.seated': 'ተይዟል',
  'table.ready': '{n} ዝግጁ',
  'table.bill': 'ሂሳብ ተጠይቋል',
  'table.off': 'ዝግ',
  'table.inKitchen': 'በማብሰያ ቤት',
  'table.notSent': 'ያልተላከ',
  'table.newTakeaway': 'አዲስ ለመውሰድ',
  'table.guests': '{n} ወንበር',
  'table.mine': 'የእኔ',
  'table.all': 'ሁሉም',
  'table.readyBanner': 'ምግብ ዝግጁ ነው፦ {tables}',

  'order.searchMenu': 'ምናሌ ፈልግ…',
  'order.sendKitchen': 'ትዕዛዝ ላክ',
  'order.queued': 'ተሰልፏል — መስመር ሲመለስ ይላካል',
  'order.review': 'ተመልከት',
  'order.noItems': 'ለመጨመር ከምናሌው ይንኩ።',
  'order.outOfStock': 'አልቋል',
  'order.addNote': 'ማስታወሻ (ለምሳሌ ሽንኩርት አይጨመር)',
  'order.add': 'ጨምር',
  'order.addWith': 'ጨምር · {price}',
  'order.remove': 'አስወግድ',
  'order.serve': 'ቀርቧል',
  'order.serveAll': 'ዝግጁዎቹን አቅርብ',
  'order.requestBill': 'ሂሳብ ጠይቅ',
  'order.moveTable': 'ጠረጴዛ ቀይር',
  'order.voidOrder': 'ትዕዛዝ ሰርዝ',
  'order.reason': 'ምክንያት',
  'order.status.PENDING': 'ያልተላከ',
  'order.status.SENT_TO_KITCHEN': 'ተልኳል',
  'order.status.PREPARING': 'እየተሰራ',
  'order.status.READY': 'ዝግጁ',
  'order.status.SERVED': 'ቀርቧል',
  'order.status.CANCELLED': 'ተሰርዟል',
  'order.sent': 'ተልኳል',
  'order.billRequested': 'ገንዘብ ተቀባዩ ተነግሯል',
  'order.closed': 'ይህ ትዕዛዝ ተዘግቷል።',
  'order.pickTable': 'ወደ የትኛው ጠረጴዛ?',
  'order.onTable': 'ትዕዛዝ',

  'kds.title': 'ማብሰያ ቤት',
  'kds.allStations': 'ሁሉም ክፍሎች',
  'kds.start': 'ጀምር',
  'kds.done': 'ተጠናቀቀ',
  'kds.dismiss': 'ታይቷል',
  'kds.void': 'ተሰርዟል',
  'kds.addition': 'ተጨማሪ',
  'kds.empty': 'ክፍት ትዕዛዝ የለም።',
  'kds.recall': 'መልስ',
  'kds.sound': 'ድምፅ አብራ',
  'kds.stock': 'ያለቁ',
  'kds.stockHelp': 'ያለቀውን ይንኩ። አስተናጋጆች ወዲያውኑ ያዩታል።',
  'kds.inStock': 'አለ',
  'kds.finished': 'አልቋል',

  'cashier.openBills': 'ክፍት ሂሳቦች',
  'cashier.noBills': 'ክፍት ሂሳብ የለም።',
  'cashier.billAsked': 'ሂሳብ ተጠይቋል',
  'cashier.eating': 'እየበሉ',
  'cashier.pending': 'ማረጋገጫ በመጠበቅ',
  'cashier.partPaid': 'በከፊል ተከፍሏል',
  'cashier.pay': 'ክፍያ ተቀበል',
  'cashier.amountDue': 'ቀሪ',
  'cashier.tendered': 'ደንበኛው የሰጠው',
  'cashier.change': 'መልስ',
  'cashier.reference': 'የግብይት ቁጥር',
  'cashier.referenceHint': 'ከደንበኛው መልዕክት',
  'cashier.photo': 'ስክሪንሾት ጨምር',
  'cashier.split': 'ከፋፍል',
  'cashier.splitEqual': 'እኩል ከፋፍል',
  'cashier.payPart': 'በከፊል ክፈል',
  'cashier.printBill': 'ሂሳብ አትም',
  'cashier.reprint': 'ደረሰኝ እንደገና አትም',
  'cashier.discount': 'ቅናሽ',
  'cashier.shiftClosed': 'የገንዘብ መሳቢያዎ ዝግ ነው',
  'cashier.openShift': 'መሳቢያ ክፈት',
  'cashier.openingFloat': 'አሁን በመሳቢያ ያለ ገንዘብ',
  'cashier.closeShift': 'መሳቢያ ዝጋ',
  'cashier.countDrawer': 'መሳቢያውን ቁጠር',
  'cashier.paid': 'ተከፍሏል',
  'cashier.waitingVerify': 'ሥራ አስኪያጁ እስኪያረጋግጥ',
  'cashier.selectBill': 'በግራ በኩል ሂሳብ ይምረጡ።',

  'approval.title': 'የሥራ አስኪያጅ ፈቃድ',
  'approval.why': 'ይህ የሥራ አስኪያጅ ፈቃድ ያስፈልገዋል፦ {what}',
  'approval.manager': 'የሥራ አስኪያጅ የተጠቃሚ ስም',
  'approval.pin': 'ፒን',
  'approval.approve': 'ፍቀድ',
  'approval.denied': 'የተጠቃሚ ስም ወይም ፒን ተሳስቷል',
};

export type Lang = 'en' | 'am';
type Vars = Record<string, string | number>;

interface I18nValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: Key, vars?: Vars) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

function interpolate(s: string, vars?: Vars) {
  return vars ? s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`)) : s;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>('en');

  useEffect(() => {
    try {
      const saved = localStorage.getItem('lang');
      if (saved === 'am' || saved === 'en') setLangState(saved);
    } catch {
      /* storage unavailable */
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem('lang', l);
    } catch {
      /* ignore */
    }
  }, []);

  const t = useCallback((key: Key, vars?: Vars) => interpolate((lang === 'am' ? am[key] : undefined) ?? en[key] ?? key, vars), [lang]);

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useT() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useT must be used inside I18nProvider');
  return ctx;
}

export type { Key as I18nKey };
