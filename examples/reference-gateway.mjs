// Reference PayRekha gateway. All settings come from environment variables:
//   PAYREKHA_API_KEYS      id:prod|nonprod:token,…   (required)
//   PAYREKHA_ADMIN_KEY     admin bearer (mode changes, HIGH_ALERT reset, canaries)
//   PAYREKHA_HASH_KEY      keyed-hash secret for raw beneficiary fields
//   PAYREKHA_CONFIG        payrekha.json (issuers, rules, calendar, ext_authz mapping)
//   PAYREKHA_STATE_FILE    JSON snapshot (HIGH_ALERT survives restarts)
//   PAYREKHA_DECISION_LOG  JSONL path;  PAYREKHA_LOG_FORMAT=cef for QRadar/ArcSight
//   PAYREKHA_WEBHOOK_URL / PAYREKHA_WEBHOOK_SECRET   SOAR webhook (optional)
//   PAYREKHA_EXT_AUTHZ_KEY shared key Envoy sends in x-payrekha-key
//   PAYREKHA_TLS_KEY_FILE / PAYREKHA_TLS_CERT_FILE   serve HTTPS (optional —
//   PAYREKHA_TLS_CA_FILE / PAYREKHA_TLS_CLIENT_AUTH=required   …or mTLS)
//   PORT (8080), HOST (0.0.0.0)
import '../packages/gateway/dist/bin.js';
