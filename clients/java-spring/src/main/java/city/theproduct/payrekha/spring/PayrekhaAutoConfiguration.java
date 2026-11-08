// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Kapil — People of Product™
package city.theproduct.payrekha.spring;

import city.theproduct.payrekha.IntentSigner;
import city.theproduct.payrekha.PayrekhaClient;
import java.security.PrivateKey;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;

/**
 * Wires PayRekha into a Spring Boot app when {@code payrekha.url} +
 * {@code payrekha.api-key} are set. The client bean is the payout-service
 * side; the signer bean appears only when issuer key material is present
 * (a payout service that never signs doesn't get one — least privilege by
 * default, matching the "no mint on the call path" posture).
 */
@AutoConfiguration
@ConditionalOnClass(PayrekhaClient.class)
@EnableConfigurationProperties(PayrekhaProperties.class)
public class PayrekhaAutoConfiguration {

  @Bean
  @ConditionalOnMissingBean
  @ConditionalOnProperty({"payrekha.url", "payrekha.api-key"})
  PayrekhaClient payrekhaClient(PayrekhaProperties props) {
    return new PayrekhaClient(props.getUrl(), props.getApiKey(), props.getOnUnavailable(), props.getTimeout());
  }

  /** Ed25519 signing key — present only in the system of record's context. */
  @Bean
  @ConditionalOnMissingBean(name = "payrekhaIssuerKey")
  @ConditionalOnProperty("payrekha.issuer-private-key")
  PrivateKey payrekhaIssuerKey(PayrekhaProperties props) {
    String k = props.getIssuerPrivateKey();
    return k.contains("BEGIN") ? IntentSigner.ed25519FromPem(k) : IntentSigner.ed25519FromPkcs8(k);
  }

  @Bean
  @ConditionalOnMissingBean
  @ConditionalOnProperty({"payrekha.url", "payrekha.api-key"})
  PayrekhaAspect payrekhaAspect(PayrekhaClient client) {
    return new PayrekhaAspect(client);
  }
}
