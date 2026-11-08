# PayRekha intent signing — Ruby. Byte-conformant with clients/vectors/intent-v1.json.
# Deps: rbnacl (libsodium) for Ed25519; json; base64.
#   require './payrekha'; sign_intent(unsigned, pkcs8_der_base64) -> intent + 'signature'
require 'rbnacl'
require 'json'
require 'base64'

module Payrekha
  DOMAIN = "payrekha-intent-v1\n"

  # Deterministic JSON: sorted keys, no whitespace, safe integers only —
  # floats raise (a Java/Python signer must never disagree on formatting).
  def self.canonical_json(v, depth = 0)
    raise TypeError, 'canonicalJson: nests deeper than 64' if depth > 64
    case v
    when NilClass then 'null'
    when String then v.to_json
    when TrueClass then 'true'
    when FalseClass then 'false'
    when Integer then v.to_s
    when Float then raise TypeError, "canonicalJson: non-integer #{v}"
    when Array then '[' + v.map { |e| canonical_json(e, depth + 1) }.join(',') + ']'
    when Hash
      '{' + v.keys.map(&:to_s).sort.map { |k| "#{k.to_json}:#{canonical_json(v[k] || v[k.to_sym], depth + 1)}" }.join(',') + '}'
    else raise TypeError, "canonicalJson: unsupported #{v.class}"
    end
  end

  # Sign an unsigned intent (Hash, symbol keys) with a base64 PKCS8 Ed25519
  # private key. Returns the intent Hash with 'signature' (base64url) added.
  def self.sign_intent(unsigned, pkcs8_b64)
    der = Base64.decode64(pkcs8_b64)
    seed = der[-32, 32] # PKCS8 Ed25519: trailing 32 bytes are the seed
    intent = unsigned.transform_keys(&:to_s)
    payload = DOMAIN + canonical_json(intent.reject { |k, _| k == 'signature' })
    sig = RbNaCl::SigningKey.new(seed).sign(payload)
    intent.merge('signature' => Base64.urlsafe_encode64(sig, padding: false))
  end
end
