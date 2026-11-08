// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Kapil — People of Product™
package city.theproduct.payrekha.spring;

import city.theproduct.payrekha.PayrekhaClient.Verdict;

/** Thrown when @PayrekhaCheck's evaluation comes back HOLD or DECLINE. */
public class PayrekhaDeniedException extends RuntimeException {
  private final Verdict verdict;

  public PayrekhaDeniedException(Verdict verdict) {
    super("payrekha " + verdict.effectiveAction + " (verdict=" + verdict.verdict + ", rules=" + verdict.rules + ")");
    this.verdict = verdict;
  }

  public Verdict getVerdict() { return verdict; }
  public String getDecisionId() { return verdict.decisionId; }
  public boolean isUnavailable() { return verdict.unavailable; }
}
