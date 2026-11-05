// esbuild --inject file: makes `Buffer` resolvable in the bundle.
// The `buffer` package (devDependency) provides the implementation; we add
// the base64url encode/decode that Node's Buffer has and the browser build
// lacks — @payrekha/core uses base64url for hb1_ refs and HMAC signatures.
import { Buffer } from 'buffer';

const origToString = Buffer.prototype.toString;
Buffer.prototype.toString = function (enc, ...rest) {
  if (enc === 'base64url') {
    return origToString.call(this, 'base64', ...rest).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  return origToString.call(this, enc, ...rest);
};

const origFrom = Buffer.from.bind(Buffer);
Buffer.from = function (data, enc, ...rest) {
  if (enc === 'base64url' && typeof data === 'string') {
    const b64 = data.replace(/-/g, '+').replace(/_/g, '/');
    return origFrom(b64, 'base64', ...rest);
  }
  return origFrom(data, enc, ...rest);
};

export { Buffer };
