import { Money } from "./money";

export interface PaymentCalculation {
  appliedAmount: Money;
  changeAmount: Money;
  remainingBalance: Money;
}

export function calculatePayment(orderTotal: Money, previouslyPaid: Money, tenderedAmount: Money): PaymentCalculation {
  orderTotal.assertSameCurrency(previouslyPaid);
  orderTotal.assertSameCurrency(tenderedAmount);

  if (previouslyPaid.amount.greaterThan(orderTotal.amount)) {
    throw new Error("Previously paid amount exceeds order total");
  }

  const remaining = new Money(orderTotal.amount.minus(previouslyPaid.amount), orderTotal.currency);

  if (tenderedAmount.amount.greaterThanOrEqualTo(remaining.amount)) {
    const change = tenderedAmount.amount.minus(remaining.amount);
    return {
      appliedAmount: remaining,
      changeAmount: new Money(change, orderTotal.currency),
      remainingBalance: new Money(0, orderTotal.currency)
    };
  } else {
    const newRemaining = remaining.amount.minus(tenderedAmount.amount);
    return {
      appliedAmount: tenderedAmount,
      changeAmount: new Money(0, orderTotal.currency),
      remainingBalance: new Money(newRemaining, orderTotal.currency)
    };
  }
}
