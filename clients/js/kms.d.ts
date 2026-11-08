// SPDX-License-Identifier: Apache-2.0
// KMS signer adapters for @payrekha/client.

import type { IntentSignerFn } from './index.js';

export interface AwsKmsSignerOptions {
  /** KMS key ARN or alias — must be SIGN_VERIFY, KeySpec ED25519. */
  readonly keyId: string;
  readonly region: string;
  readonly credentials: {
    readonly accessKeyId: string;
    readonly secretAccessKey: string;
    readonly sessionToken?: string;
  };
  /** Override for LocalStack/tests; default kms.{region}.amazonaws.com */
  readonly endpoint?: string;
  readonly fetchImpl?: typeof fetch;
}
export function awsKmsSigner(opts: AwsKmsSignerOptions): IntentSignerFn;

export interface GcpKmsSignerOptions {
  /** projects/P/locations/L/keyRings/R/cryptoKeys/K/cryptoKeyVersions/1 */
  readonly keyName: string;
  /** Bearer token with cloudkms.asymmetricSign scope. */
  readonly accessToken: string;
  readonly fetchImpl?: typeof fetch;
}
export function gcpKmsSigner(opts: GcpKmsSignerOptions): IntentSignerFn;

/** Wrap any HSM/vendor binding that can Ed25519-sign a payload. */
export function pkcs11Signer(opts: { sign: IntentSignerFn }): IntentSignerFn;

export const _sigv4: {
  sha256Hex(data: string | Buffer): string;
  hmac(key: string | Buffer, data: string, enc?: 'hex'): string | Buffer;
};
