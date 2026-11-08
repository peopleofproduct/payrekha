# Apigee — ServiceCallout to /ext_authz
> **The full step-by-step trial guide: `docs/integrations/apigee.md`** — this file is the config reference.


Apigee has no external-authz primitive; the integration is a
**ServiceCallout** in the PreFlow that POSTs the request to PayRekha's
`/ext_authz`, followed by a RaiseFault on a non-200 response.

## Policy: `callout-payrekha.xml`

```xml
<ServiceCallout name="SC-Payrekha-ExtAuthz">
  <Request clearPayload="false">
    <Set>
      <Verb>POST</Verb>
      <Payload contentType="application/json">{
        "path": "{request.uri}",
        "method": "{request.verb}",
        "headers": {"authorization": "{request.header.Authorization}",
                    "x-client-id": "{request.header.x-client-id}"},
        "query": {},
        "body": null
      }</Payload>
    </Set>
  </Request>
  <Response>payrekhaResponse</Response>
  <HTTPTargetConnection>
    <URL>{payrekha.baseurl}/ext_authz{request.uri}</URL>
    <Properties>
      <Property name="success.codes">200</Property>
    </Properties>
    <SSLInfo><Enabled>true</Enabled></SSLInfo>
    <Authentication>
      <Header name="x-payrekha-key" ref="payrekha.sharedkey"/>
    </Authentication>
  </HTTPTargetConnection>
  <Timeout>2000</Timeout>
</ServiceCallout>
```

Then in the proxy PreFlow:

```xml
<Step><Name>SC-Payrekha-ExtAuthz</Name></Step>
<Step><Name>RF-Payrekha-Deny</Name>
  <Condition>payrekhaResponse.status.code != 200</Condition></Step>
```

`RF-Payrekha-Deny` is a RaiseFault returning 403 — **fail closed**: a
timeout or 5xx also denies (`success.codes` is 200 only).

## Caveats (honest)

- Source identity must be Apigee-asserted (`x-client-id` from the verify
  policy), never body-supplied — same rule as every other integration.
- Body-bearing payout claims are not visible to the callout above unless
  the request JSON is inlined into the ServiceCallout payload — for
  body-claim enforcement put Envoy/nginx in front, or extract the mapped
  fields via AssignMessage into `query`-style fields first.
- `payrekha.baseurl` / `payrekha.sharedkey` belong in a KVM/TargetServer
  config, never hardcoded.
