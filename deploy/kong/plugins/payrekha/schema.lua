-- SPDX-License-Identifier: Apache-2.0
-- Copyright 2026 Kapil — People of Product™
return {
  name = "payrekha",
  fields = {
    { protocols = { default = { "http", "https" } } },
    { config = {
        type = "record",
        fields = {
          { payrekha_url = { type = "string", required = true, description = "http://payrekha:8080" } },
          { ext_authz_key = { type = "string", required = true, description = "shared key sent as x-payrekha-key (keep in Kong secrets/vault)" } },
          { source_key_id = { type = "string", required = true, description = "asserted caller id — Kong asserts it, never forwarded from the client" } },
          { timeout_ms = { type = "integer", default = 250, between = { 50, 5000 } } },
          { payout_path = { type = "string", default = "/payouts" } },
          -- What PayRekha gets: "headers" (stock-nginx parity — service
          -- asserts x-payrekha-intent/x-payout-*/x-beneficiary-ref) or
          -- "body" (forward the JSON body like Envoy does).
          { forward = { type = "string", default = "body", one_of = { "body", "headers" } } },
          -- fail closed. A PayRekha silence must never let money move.
          { on_unavailable = { type = "string", default = "deny", one_of = { "deny" } } },
        },
      },
    },
  },
}
