-- SPDX-License-Identifier: Apache-2.0
-- Copyright 2026 Kapil — People of Product™
--
-- PayRekha payout-firewall plugin for Kong. In `access`, each matched
-- request is authorized against /ext_authz before reaching the upstream —
-- the same call Envoy's ext_authz filter makes. 200 proceeds; anything
-- else (403 verdict, timeout, error) stops the request. Fail closed.
local http = require "resty.http"

local Payrekha = {
  PRIORITY = 1000,
  VERSION = "0.1.0",
}

local function deny(code, body)
  return kong.response.exit(code, body, { ["content-type"] = "application/json" })
end

function Payrekha:access(conf)
  if kong.request.get_method() ~= "POST" then return end -- reads don't move money

  local body = conf.forward == "body" and kong.request.get_raw_body() or nil

  local headers = {
    ["x-payrekha-key"] = conf.ext_authz_key,
    ["x-client-id"] = conf.source_key_id,
    ["x-forwarded-for"] = kong.client.get_forwarded_ip(),
    ["user-agent"] = kong.request.get_header("user-agent") or "-",
  }
  if conf.forward == "headers" then
    for _, h in ipairs({ "x-payrekha-intent", "x-payout-kind", "x-payout-amount", "x-payout-id", "x-beneficiary-ref" }) do
      local v = kong.request.get_header(h)
      if v then headers[h] = v end
    end
    headers["content-length"] = "0"
  else
    headers["content-type"] = "application/json"
  end

  local client = http.new()
  client:set_timeout(conf.timeout_ms)
  local res, err = client:request_uri(conf.payrekha_url .. "/ext_authz" .. conf.payout_path, {
    method = "POST",
    body = body,
    headers = headers,
  })

  if not res then
    kong.log.err("payrekha unreachable: ", err, " — denying (fail closed)")
    return deny(403, { error = "payrekha unavailable", verdict = "BLOCK", degraded = true })
  end

  local decision = res.headers["x-payrekha-decision-id"]
  if res.status == 200 then
    -- let the upstream ledger join on the decision id
    kong.service.request.set_header("x-payrekha-decision-id", decision or "-")
    kong.service.request.set_header("x-client-id", conf.source_key_id)
    return
  end

  kong.log.notice("payrekha denied ", conf.payout_path, " decision=", decision, " verdict=", res.headers["x-payrekha-verdict"])
  return deny(403, {
    error = "declined by payout firewall",
    verdict = res.headers["x-payrekha-verdict"],
    action = res.headers["x-payrekha-action"],
    decisionId = decision,
    rules = res.headers["x-payrekha-rules"],
  })
end

return Payrekha
