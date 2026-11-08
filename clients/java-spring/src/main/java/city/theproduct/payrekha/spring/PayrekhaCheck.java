// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Kapil — People of Product™
package city.theproduct.payrekha.spring;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * "Evaluate before this method runs." Place on the service method that
 * executes the payout; the SpEL expression must produce the
 * {@code Map<String,Object>} payout payload (same shape as
 * {@code PayrekhaClient.evaluate}).
 *
 *   @PayrekhaCheck("#payout")
 *   public Disbursal disburse(Map<String,Object> payout, Loan loan) { … }
 *
 * A non-ALLOW effectiveAction throws {@link PayrekhaDeniedException} —
 * HOLD and DECLINE both stop the method. The decision id rides the
 * exception for the ledger join.
 */
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface PayrekhaCheck {
  /** SpEL over the method arguments producing the payout map. */
  String value();
}
