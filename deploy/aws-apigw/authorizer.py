# AWS API Gateway REQUEST authorizer → PayRekha /ext_authz
# Env: PAYREKHA_URL (https://payrekha.internal), PAYREKHA_KEY (x-payrekha-key),
#      optional PAYREKHA_TIMEOUT_S (default 2)
import json, os, urllib.request

URL = os.environ["PAYREKHA_URL"].rstrip("/")
KEY = os.environ["PAYREKHA_KEY"]
TIMEOUT = float(os.environ.get("PAYREKHA_TIMEOUT_S", "2"))


def _policy(allow, method_arn, ctx=None):
    effect = "Allow" if allow else "Deny"
    return {
        "principalId": ctx.get("decisionId", "-") if ctx else "-",
        "policyDocument": {
            "Version": "2012-10-17",
            "Statement": [{"Action": "execute-api:Invoke", "Effect": effect, "Resource": method_arn}],
        },
        "context": ctx or {},
    }


def handler(event, _ctx):
    # /ext_authz sees the request shape PayRekha's FieldMapping expects:
    # methodArn suffix is the payout path; headers/query pass through.
    body = {
        "path": event.get("path", "/"),
        "method": event.get("httpMethod", "POST"),
        "headers": event.get("headers") or {},
        "query": event.get("queryStringParameters") or {},
    }
    req = urllib.request.Request(
        URL + "/ext_authz" + body["path"],
        data=json.dumps(body).encode(),
        headers={"content-type": "application/json", "x-payrekha-key": KEY},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            verdict = {
                "verdict": r.headers.get("x-payrekha-verdict", "ALLOW"),
                "action": r.headers.get("x-payrekha-action", "ALLOW"),
                "decisionId": r.headers.get("x-payrekha-decision-id", ""),
                "rules": r.headers.get("x-payrekha-rules", "-"),
            }
            return _policy(r.status == 200, event["methodArn"], verdict)
    except Exception:
        # Fail closed — same semantic as failure_mode_allow: false.
        return _policy(False, event["methodArn"])
