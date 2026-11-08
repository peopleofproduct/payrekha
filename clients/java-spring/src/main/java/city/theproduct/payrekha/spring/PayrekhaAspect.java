// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Kapil — People of Product™
package city.theproduct.payrekha.spring;

import city.theproduct.payrekha.PayrekhaClient;
import city.theproduct.payrekha.PayrekhaClient.Verdict;
import java.util.Map;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.aspectj.lang.reflect.MethodSignature;
import org.springframework.core.DefaultParameterNameDiscoverer;
import org.springframework.expression.Expression;
import org.springframework.expression.spel.standard.SpelExpressionParser;
import org.springframework.expression.spel.support.StandardEvaluationContext;

/**
 * Runs PayRekha before a @PayrekhaCheck-annotated method. The payout map
 * comes from a SpEL over the method args; a non-ALLOW effectiveAction
 * throws {@link PayrekhaDeniedException} — the payout code never runs.
 */
@Aspect
public class PayrekhaAspect {
  private final PayrekhaClient client;
  private final SpelExpressionParser parser = new SpelExpressionParser();
  private final DefaultParameterNameDiscoverer names = new DefaultParameterNameDiscoverer();

  public PayrekhaAspect(PayrekhaClient client) {
    this.client = client;
  }

  @Around("@annotation(check)")
  public Object around(ProceedingJoinPoint pjp, PayrekhaCheck check) throws Throwable {
    StandardEvaluationContext ctx = new StandardEvaluationContext();
    MethodSignature sig = (MethodSignature) pjp.getSignature();
    String[] params = names.getParameterNames(sig.getMethod());
    Object[] args = pjp.getArgs();
    for (int i = 0; params != null && i < params.length; i++) ctx.setVariable(params[i], args[i]);

    Expression expr = parser.parseExpression(check.value());
    Object payout = expr.getValue(ctx);
    if (!(payout instanceof Map)) {
      throw new IllegalStateException("@PayrekhaCheck expression must produce a Map<String,Object>, got " + (payout == null ? "null" : payout.getClass().getName()));
    }
    @SuppressWarnings("unchecked")
    Verdict v = client.evaluate((Map<String, Object>) payout);
    if (!v.mayProceed()) throw new PayrekhaDeniedException(v);
    return pjp.proceed();
  }
}
