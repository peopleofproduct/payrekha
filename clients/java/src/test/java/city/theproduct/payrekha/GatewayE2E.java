// SPDX-License-Identifier: Apache-2.0
package city.theproduct.payrekha;

import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;

/** Against a running reference gateway: java GatewayE2E <url> <apiKey> <beneficiaryRef>. */
public final class GatewayE2E {
  public static void main(String[] a) throws Exception {
    PayrekhaClient c = new PayrekhaClient(a[0], a[1]);
    Map<String, Object> p = new LinkedHashMap<>();
    p.put("payoutId", "java-" + System.nanoTime());
    p.put("kind", "LOAN_DISBURSAL");
    p.put("amountPaise", 24000000L);
    p.put("beneficiaryRef", a[2]);
    p.put("channel", "IMPS");
    PayrekhaClient.Verdict v = c.evaluate(p);
    System.out.println("live " + v.verdict + " " + v.effectiveAction + " " + v.rules);
    PayrekhaClient down = new PayrekhaClient("http://127.0.0.1:1", a[1], PayrekhaClient.DEFAULT_ON_UNAVAILABLE, Duration.ofMillis(200));
    PayrekhaClient.Verdict d = down.evaluate(p);
    System.out.println("down " + d.verdict + " " + d.effectiveAction + " unavailable=" + d.unavailable);
    p.put("amountPaise", 100000L);
    System.out.println("down-small " + down.evaluate(p).effectiveAction);
  }
}
