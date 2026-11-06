var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/base64-js/index.js
var require_base64_js = __commonJS({
  "node_modules/base64-js/index.js"(exports) {
    "use strict";
    init_buffer();
    exports.byteLength = byteLength;
    exports.toByteArray = toByteArray;
    exports.fromByteArray = fromByteArray;
    var lookup = [];
    var revLookup = [];
    var Arr = typeof Uint8Array !== "undefined" ? Uint8Array : Array;
    var code = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    for (i = 0, len = code.length; i < len; ++i) {
      lookup[i] = code[i];
      revLookup[code.charCodeAt(i)] = i;
    }
    var i;
    var len;
    revLookup["-".charCodeAt(0)] = 62;
    revLookup["_".charCodeAt(0)] = 63;
    function getLens(b64) {
      var len2 = b64.length;
      if (len2 % 4 > 0) {
        throw new Error("Invalid string. Length must be a multiple of 4");
      }
      var validLen = b64.indexOf("=");
      if (validLen === -1) validLen = len2;
      var placeHoldersLen = validLen === len2 ? 0 : 4 - validLen % 4;
      return [validLen, placeHoldersLen];
    }
    function byteLength(b64) {
      var lens = getLens(b64);
      var validLen = lens[0];
      var placeHoldersLen = lens[1];
      return (validLen + placeHoldersLen) * 3 / 4 - placeHoldersLen;
    }
    function _byteLength(b64, validLen, placeHoldersLen) {
      return (validLen + placeHoldersLen) * 3 / 4 - placeHoldersLen;
    }
    function toByteArray(b64) {
      var tmp;
      var lens = getLens(b64);
      var validLen = lens[0];
      var placeHoldersLen = lens[1];
      var arr = new Arr(_byteLength(b64, validLen, placeHoldersLen));
      var curByte = 0;
      var len2 = placeHoldersLen > 0 ? validLen - 4 : validLen;
      var i2;
      for (i2 = 0; i2 < len2; i2 += 4) {
        tmp = revLookup[b64.charCodeAt(i2)] << 18 | revLookup[b64.charCodeAt(i2 + 1)] << 12 | revLookup[b64.charCodeAt(i2 + 2)] << 6 | revLookup[b64.charCodeAt(i2 + 3)];
        arr[curByte++] = tmp >> 16 & 255;
        arr[curByte++] = tmp >> 8 & 255;
        arr[curByte++] = tmp & 255;
      }
      if (placeHoldersLen === 2) {
        tmp = revLookup[b64.charCodeAt(i2)] << 2 | revLookup[b64.charCodeAt(i2 + 1)] >> 4;
        arr[curByte++] = tmp & 255;
      }
      if (placeHoldersLen === 1) {
        tmp = revLookup[b64.charCodeAt(i2)] << 10 | revLookup[b64.charCodeAt(i2 + 1)] << 4 | revLookup[b64.charCodeAt(i2 + 2)] >> 2;
        arr[curByte++] = tmp >> 8 & 255;
        arr[curByte++] = tmp & 255;
      }
      return arr;
    }
    function tripletToBase64(num) {
      return lookup[num >> 18 & 63] + lookup[num >> 12 & 63] + lookup[num >> 6 & 63] + lookup[num & 63];
    }
    function encodeChunk(uint8, start, end) {
      var tmp;
      var output = [];
      for (var i2 = start; i2 < end; i2 += 3) {
        tmp = (uint8[i2] << 16 & 16711680) + (uint8[i2 + 1] << 8 & 65280) + (uint8[i2 + 2] & 255);
        output.push(tripletToBase64(tmp));
      }
      return output.join("");
    }
    function fromByteArray(uint8) {
      var tmp;
      var len2 = uint8.length;
      var extraBytes = len2 % 3;
      var parts = [];
      var maxChunkLength = 16383;
      for (var i2 = 0, len22 = len2 - extraBytes; i2 < len22; i2 += maxChunkLength) {
        parts.push(encodeChunk(uint8, i2, i2 + maxChunkLength > len22 ? len22 : i2 + maxChunkLength));
      }
      if (extraBytes === 1) {
        tmp = uint8[len2 - 1];
        parts.push(
          lookup[tmp >> 2] + lookup[tmp << 4 & 63] + "=="
        );
      } else if (extraBytes === 2) {
        tmp = (uint8[len2 - 2] << 8) + uint8[len2 - 1];
        parts.push(
          lookup[tmp >> 10] + lookup[tmp >> 4 & 63] + lookup[tmp << 2 & 63] + "="
        );
      }
      return parts.join("");
    }
  }
});

// node_modules/ieee754/index.js
var require_ieee754 = __commonJS({
  "node_modules/ieee754/index.js"(exports) {
    init_buffer();
    exports.read = function(buffer, offset, isLE, mLen, nBytes) {
      var e, m;
      var eLen = nBytes * 8 - mLen - 1;
      var eMax = (1 << eLen) - 1;
      var eBias = eMax >> 1;
      var nBits = -7;
      var i = isLE ? nBytes - 1 : 0;
      var d = isLE ? -1 : 1;
      var s = buffer[offset + i];
      i += d;
      e = s & (1 << -nBits) - 1;
      s >>= -nBits;
      nBits += eLen;
      for (; nBits > 0; e = e * 256 + buffer[offset + i], i += d, nBits -= 8) {
      }
      m = e & (1 << -nBits) - 1;
      e >>= -nBits;
      nBits += mLen;
      for (; nBits > 0; m = m * 256 + buffer[offset + i], i += d, nBits -= 8) {
      }
      if (e === 0) {
        e = 1 - eBias;
      } else if (e === eMax) {
        return m ? NaN : (s ? -1 : 1) * Infinity;
      } else {
        m = m + Math.pow(2, mLen);
        e = e - eBias;
      }
      return (s ? -1 : 1) * m * Math.pow(2, e - mLen);
    };
    exports.write = function(buffer, value, offset, isLE, mLen, nBytes) {
      var e, m, c;
      var eLen = nBytes * 8 - mLen - 1;
      var eMax = (1 << eLen) - 1;
      var eBias = eMax >> 1;
      var rt = mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0;
      var i = isLE ? 0 : nBytes - 1;
      var d = isLE ? 1 : -1;
      var s = value < 0 || value === 0 && 1 / value < 0 ? 1 : 0;
      value = Math.abs(value);
      if (isNaN(value) || value === Infinity) {
        m = isNaN(value) ? 1 : 0;
        e = eMax;
      } else {
        e = Math.floor(Math.log(value) / Math.LN2);
        if (value * (c = Math.pow(2, -e)) < 1) {
          e--;
          c *= 2;
        }
        if (e + eBias >= 1) {
          value += rt / c;
        } else {
          value += rt * Math.pow(2, 1 - eBias);
        }
        if (value * c >= 2) {
          e++;
          c /= 2;
        }
        if (e + eBias >= eMax) {
          m = 0;
          e = eMax;
        } else if (e + eBias >= 1) {
          m = (value * c - 1) * Math.pow(2, mLen);
          e = e + eBias;
        } else {
          m = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen);
          e = 0;
        }
      }
      for (; mLen >= 8; buffer[offset + i] = m & 255, i += d, m /= 256, mLen -= 8) {
      }
      e = e << mLen | m;
      eLen += mLen;
      for (; eLen > 0; buffer[offset + i] = e & 255, i += d, e /= 256, eLen -= 8) {
      }
      buffer[offset + i - d] |= s * 128;
    };
  }
});

// node_modules/buffer/index.js
var require_buffer = __commonJS({
  "node_modules/buffer/index.js"(exports) {
    "use strict";
    init_buffer();
    var base64 = require_base64_js();
    var ieee754 = require_ieee754();
    var customInspectSymbol = typeof Symbol === "function" && typeof Symbol["for"] === "function" ? Symbol["for"]("nodejs.util.inspect.custom") : null;
    exports.Buffer = Buffer3;
    exports.SlowBuffer = SlowBuffer;
    exports.INSPECT_MAX_BYTES = 50;
    var K_MAX_LENGTH = 2147483647;
    exports.kMaxLength = K_MAX_LENGTH;
    Buffer3.TYPED_ARRAY_SUPPORT = typedArraySupport();
    if (!Buffer3.TYPED_ARRAY_SUPPORT && typeof console !== "undefined" && typeof console.error === "function") {
      console.error(
        "This browser lacks typed array (Uint8Array) support which is required by `buffer` v5.x. Use `buffer` v4.x if you require old browser support."
      );
    }
    function typedArraySupport() {
      try {
        const arr = new Uint8Array(1);
        const proto = { foo: function() {
          return 42;
        } };
        Object.setPrototypeOf(proto, Uint8Array.prototype);
        Object.setPrototypeOf(arr, proto);
        return arr.foo() === 42;
      } catch (e) {
        return false;
      }
    }
    Object.defineProperty(Buffer3.prototype, "parent", {
      enumerable: true,
      get: function() {
        if (!Buffer3.isBuffer(this)) return void 0;
        return this.buffer;
      }
    });
    Object.defineProperty(Buffer3.prototype, "offset", {
      enumerable: true,
      get: function() {
        if (!Buffer3.isBuffer(this)) return void 0;
        return this.byteOffset;
      }
    });
    function createBuffer(length) {
      if (length > K_MAX_LENGTH) {
        throw new RangeError('The value "' + length + '" is invalid for option "size"');
      }
      const buf = new Uint8Array(length);
      Object.setPrototypeOf(buf, Buffer3.prototype);
      return buf;
    }
    function Buffer3(arg, encodingOrOffset, length) {
      if (typeof arg === "number") {
        if (typeof encodingOrOffset === "string") {
          throw new TypeError(
            'The "string" argument must be of type string. Received type number'
          );
        }
        return allocUnsafe(arg);
      }
      return from(arg, encodingOrOffset, length);
    }
    Buffer3.poolSize = 8192;
    function from(value, encodingOrOffset, length) {
      if (typeof value === "string") {
        return fromString(value, encodingOrOffset);
      }
      if (ArrayBuffer.isView(value)) {
        return fromArrayView(value);
      }
      if (value == null) {
        throw new TypeError(
          "The first argument must be one of type string, Buffer, ArrayBuffer, Array, or Array-like Object. Received type " + typeof value
        );
      }
      if (isInstance(value, ArrayBuffer) || value && isInstance(value.buffer, ArrayBuffer)) {
        return fromArrayBuffer(value, encodingOrOffset, length);
      }
      if (typeof SharedArrayBuffer !== "undefined" && (isInstance(value, SharedArrayBuffer) || value && isInstance(value.buffer, SharedArrayBuffer))) {
        return fromArrayBuffer(value, encodingOrOffset, length);
      }
      if (typeof value === "number") {
        throw new TypeError(
          'The "value" argument must not be of type number. Received type number'
        );
      }
      const valueOf = value.valueOf && value.valueOf();
      if (valueOf != null && valueOf !== value) {
        return Buffer3.from(valueOf, encodingOrOffset, length);
      }
      const b = fromObject(value);
      if (b) return b;
      if (typeof Symbol !== "undefined" && Symbol.toPrimitive != null && typeof value[Symbol.toPrimitive] === "function") {
        return Buffer3.from(value[Symbol.toPrimitive]("string"), encodingOrOffset, length);
      }
      throw new TypeError(
        "The first argument must be one of type string, Buffer, ArrayBuffer, Array, or Array-like Object. Received type " + typeof value
      );
    }
    Buffer3.from = function(value, encodingOrOffset, length) {
      return from(value, encodingOrOffset, length);
    };
    Object.setPrototypeOf(Buffer3.prototype, Uint8Array.prototype);
    Object.setPrototypeOf(Buffer3, Uint8Array);
    function assertSize(size) {
      if (typeof size !== "number") {
        throw new TypeError('"size" argument must be of type number');
      } else if (size < 0) {
        throw new RangeError('The value "' + size + '" is invalid for option "size"');
      }
    }
    function alloc(size, fill, encoding) {
      assertSize(size);
      if (size <= 0) {
        return createBuffer(size);
      }
      if (fill !== void 0) {
        return typeof encoding === "string" ? createBuffer(size).fill(fill, encoding) : createBuffer(size).fill(fill);
      }
      return createBuffer(size);
    }
    Buffer3.alloc = function(size, fill, encoding) {
      return alloc(size, fill, encoding);
    };
    function allocUnsafe(size) {
      assertSize(size);
      return createBuffer(size < 0 ? 0 : checked(size) | 0);
    }
    Buffer3.allocUnsafe = function(size) {
      return allocUnsafe(size);
    };
    Buffer3.allocUnsafeSlow = function(size) {
      return allocUnsafe(size);
    };
    function fromString(string, encoding) {
      if (typeof encoding !== "string" || encoding === "") {
        encoding = "utf8";
      }
      if (!Buffer3.isEncoding(encoding)) {
        throw new TypeError("Unknown encoding: " + encoding);
      }
      const length = byteLength(string, encoding) | 0;
      let buf = createBuffer(length);
      const actual = buf.write(string, encoding);
      if (actual !== length) {
        buf = buf.slice(0, actual);
      }
      return buf;
    }
    function fromArrayLike(array) {
      const length = array.length < 0 ? 0 : checked(array.length) | 0;
      const buf = createBuffer(length);
      for (let i = 0; i < length; i += 1) {
        buf[i] = array[i] & 255;
      }
      return buf;
    }
    function fromArrayView(arrayView) {
      if (isInstance(arrayView, Uint8Array)) {
        const copy = new Uint8Array(arrayView);
        return fromArrayBuffer(copy.buffer, copy.byteOffset, copy.byteLength);
      }
      return fromArrayLike(arrayView);
    }
    function fromArrayBuffer(array, byteOffset, length) {
      if (byteOffset < 0 || array.byteLength < byteOffset) {
        throw new RangeError('"offset" is outside of buffer bounds');
      }
      if (array.byteLength < byteOffset + (length || 0)) {
        throw new RangeError('"length" is outside of buffer bounds');
      }
      let buf;
      if (byteOffset === void 0 && length === void 0) {
        buf = new Uint8Array(array);
      } else if (length === void 0) {
        buf = new Uint8Array(array, byteOffset);
      } else {
        buf = new Uint8Array(array, byteOffset, length);
      }
      Object.setPrototypeOf(buf, Buffer3.prototype);
      return buf;
    }
    function fromObject(obj) {
      if (Buffer3.isBuffer(obj)) {
        const len = checked(obj.length) | 0;
        const buf = createBuffer(len);
        if (buf.length === 0) {
          return buf;
        }
        obj.copy(buf, 0, 0, len);
        return buf;
      }
      if (obj.length !== void 0) {
        if (typeof obj.length !== "number" || numberIsNaN(obj.length)) {
          return createBuffer(0);
        }
        return fromArrayLike(obj);
      }
      if (obj.type === "Buffer" && Array.isArray(obj.data)) {
        return fromArrayLike(obj.data);
      }
    }
    function checked(length) {
      if (length >= K_MAX_LENGTH) {
        throw new RangeError("Attempt to allocate Buffer larger than maximum size: 0x" + K_MAX_LENGTH.toString(16) + " bytes");
      }
      return length | 0;
    }
    function SlowBuffer(length) {
      if (+length != length) {
        length = 0;
      }
      return Buffer3.alloc(+length);
    }
    Buffer3.isBuffer = function isBuffer(b) {
      return b != null && b._isBuffer === true && b !== Buffer3.prototype;
    };
    Buffer3.compare = function compare(a, b) {
      if (isInstance(a, Uint8Array)) a = Buffer3.from(a, a.offset, a.byteLength);
      if (isInstance(b, Uint8Array)) b = Buffer3.from(b, b.offset, b.byteLength);
      if (!Buffer3.isBuffer(a) || !Buffer3.isBuffer(b)) {
        throw new TypeError(
          'The "buf1", "buf2" arguments must be one of type Buffer or Uint8Array'
        );
      }
      if (a === b) return 0;
      let x = a.length;
      let y = b.length;
      for (let i = 0, len = Math.min(x, y); i < len; ++i) {
        if (a[i] !== b[i]) {
          x = a[i];
          y = b[i];
          break;
        }
      }
      if (x < y) return -1;
      if (y < x) return 1;
      return 0;
    };
    Buffer3.isEncoding = function isEncoding(encoding) {
      switch (String(encoding).toLowerCase()) {
        case "hex":
        case "utf8":
        case "utf-8":
        case "ascii":
        case "latin1":
        case "binary":
        case "base64":
        case "ucs2":
        case "ucs-2":
        case "utf16le":
        case "utf-16le":
          return true;
        default:
          return false;
      }
    };
    Buffer3.concat = function concat(list, length) {
      if (!Array.isArray(list)) {
        throw new TypeError('"list" argument must be an Array of Buffers');
      }
      if (list.length === 0) {
        return Buffer3.alloc(0);
      }
      let i;
      if (length === void 0) {
        length = 0;
        for (i = 0; i < list.length; ++i) {
          length += list[i].length;
        }
      }
      const buffer = Buffer3.allocUnsafe(length);
      let pos = 0;
      for (i = 0; i < list.length; ++i) {
        let buf = list[i];
        if (isInstance(buf, Uint8Array)) {
          if (pos + buf.length > buffer.length) {
            if (!Buffer3.isBuffer(buf)) buf = Buffer3.from(buf);
            buf.copy(buffer, pos);
          } else {
            Uint8Array.prototype.set.call(
              buffer,
              buf,
              pos
            );
          }
        } else if (!Buffer3.isBuffer(buf)) {
          throw new TypeError('"list" argument must be an Array of Buffers');
        } else {
          buf.copy(buffer, pos);
        }
        pos += buf.length;
      }
      return buffer;
    };
    function byteLength(string, encoding) {
      if (Buffer3.isBuffer(string)) {
        return string.length;
      }
      if (ArrayBuffer.isView(string) || isInstance(string, ArrayBuffer)) {
        return string.byteLength;
      }
      if (typeof string !== "string") {
        throw new TypeError(
          'The "string" argument must be one of type string, Buffer, or ArrayBuffer. Received type ' + typeof string
        );
      }
      const len = string.length;
      const mustMatch = arguments.length > 2 && arguments[2] === true;
      if (!mustMatch && len === 0) return 0;
      let loweredCase = false;
      for (; ; ) {
        switch (encoding) {
          case "ascii":
          case "latin1":
          case "binary":
            return len;
          case "utf8":
          case "utf-8":
            return utf8ToBytes(string).length;
          case "ucs2":
          case "ucs-2":
          case "utf16le":
          case "utf-16le":
            return len * 2;
          case "hex":
            return len >>> 1;
          case "base64":
            return base64ToBytes(string).length;
          default:
            if (loweredCase) {
              return mustMatch ? -1 : utf8ToBytes(string).length;
            }
            encoding = ("" + encoding).toLowerCase();
            loweredCase = true;
        }
      }
    }
    Buffer3.byteLength = byteLength;
    function slowToString(encoding, start, end) {
      let loweredCase = false;
      if (start === void 0 || start < 0) {
        start = 0;
      }
      if (start > this.length) {
        return "";
      }
      if (end === void 0 || end > this.length) {
        end = this.length;
      }
      if (end <= 0) {
        return "";
      }
      end >>>= 0;
      start >>>= 0;
      if (end <= start) {
        return "";
      }
      if (!encoding) encoding = "utf8";
      while (true) {
        switch (encoding) {
          case "hex":
            return hexSlice(this, start, end);
          case "utf8":
          case "utf-8":
            return utf8Slice(this, start, end);
          case "ascii":
            return asciiSlice(this, start, end);
          case "latin1":
          case "binary":
            return latin1Slice(this, start, end);
          case "base64":
            return base64Slice(this, start, end);
          case "ucs2":
          case "ucs-2":
          case "utf16le":
          case "utf-16le":
            return utf16leSlice(this, start, end);
          default:
            if (loweredCase) throw new TypeError("Unknown encoding: " + encoding);
            encoding = (encoding + "").toLowerCase();
            loweredCase = true;
        }
      }
    }
    Buffer3.prototype._isBuffer = true;
    function swap(b, n, m) {
      const i = b[n];
      b[n] = b[m];
      b[m] = i;
    }
    Buffer3.prototype.swap16 = function swap16() {
      const len = this.length;
      if (len % 2 !== 0) {
        throw new RangeError("Buffer size must be a multiple of 16-bits");
      }
      for (let i = 0; i < len; i += 2) {
        swap(this, i, i + 1);
      }
      return this;
    };
    Buffer3.prototype.swap32 = function swap32() {
      const len = this.length;
      if (len % 4 !== 0) {
        throw new RangeError("Buffer size must be a multiple of 32-bits");
      }
      for (let i = 0; i < len; i += 4) {
        swap(this, i, i + 3);
        swap(this, i + 1, i + 2);
      }
      return this;
    };
    Buffer3.prototype.swap64 = function swap64() {
      const len = this.length;
      if (len % 8 !== 0) {
        throw new RangeError("Buffer size must be a multiple of 64-bits");
      }
      for (let i = 0; i < len; i += 8) {
        swap(this, i, i + 7);
        swap(this, i + 1, i + 6);
        swap(this, i + 2, i + 5);
        swap(this, i + 3, i + 4);
      }
      return this;
    };
    Buffer3.prototype.toString = function toString() {
      const length = this.length;
      if (length === 0) return "";
      if (arguments.length === 0) return utf8Slice(this, 0, length);
      return slowToString.apply(this, arguments);
    };
    Buffer3.prototype.toLocaleString = Buffer3.prototype.toString;
    Buffer3.prototype.equals = function equals(b) {
      if (!Buffer3.isBuffer(b)) throw new TypeError("Argument must be a Buffer");
      if (this === b) return true;
      return Buffer3.compare(this, b) === 0;
    };
    Buffer3.prototype.inspect = function inspect() {
      let str = "";
      const max = exports.INSPECT_MAX_BYTES;
      str = this.toString("hex", 0, max).replace(/(.{2})/g, "$1 ").trim();
      if (this.length > max) str += " ... ";
      return "<Buffer " + str + ">";
    };
    if (customInspectSymbol) {
      Buffer3.prototype[customInspectSymbol] = Buffer3.prototype.inspect;
    }
    Buffer3.prototype.compare = function compare(target, start, end, thisStart, thisEnd) {
      if (isInstance(target, Uint8Array)) {
        target = Buffer3.from(target, target.offset, target.byteLength);
      }
      if (!Buffer3.isBuffer(target)) {
        throw new TypeError(
          'The "target" argument must be one of type Buffer or Uint8Array. Received type ' + typeof target
        );
      }
      if (start === void 0) {
        start = 0;
      }
      if (end === void 0) {
        end = target ? target.length : 0;
      }
      if (thisStart === void 0) {
        thisStart = 0;
      }
      if (thisEnd === void 0) {
        thisEnd = this.length;
      }
      if (start < 0 || end > target.length || thisStart < 0 || thisEnd > this.length) {
        throw new RangeError("out of range index");
      }
      if (thisStart >= thisEnd && start >= end) {
        return 0;
      }
      if (thisStart >= thisEnd) {
        return -1;
      }
      if (start >= end) {
        return 1;
      }
      start >>>= 0;
      end >>>= 0;
      thisStart >>>= 0;
      thisEnd >>>= 0;
      if (this === target) return 0;
      let x = thisEnd - thisStart;
      let y = end - start;
      const len = Math.min(x, y);
      const thisCopy = this.slice(thisStart, thisEnd);
      const targetCopy = target.slice(start, end);
      for (let i = 0; i < len; ++i) {
        if (thisCopy[i] !== targetCopy[i]) {
          x = thisCopy[i];
          y = targetCopy[i];
          break;
        }
      }
      if (x < y) return -1;
      if (y < x) return 1;
      return 0;
    };
    function bidirectionalIndexOf(buffer, val, byteOffset, encoding, dir) {
      if (buffer.length === 0) return -1;
      if (typeof byteOffset === "string") {
        encoding = byteOffset;
        byteOffset = 0;
      } else if (byteOffset > 2147483647) {
        byteOffset = 2147483647;
      } else if (byteOffset < -2147483648) {
        byteOffset = -2147483648;
      }
      byteOffset = +byteOffset;
      if (numberIsNaN(byteOffset)) {
        byteOffset = dir ? 0 : buffer.length - 1;
      }
      if (byteOffset < 0) byteOffset = buffer.length + byteOffset;
      if (byteOffset >= buffer.length) {
        if (dir) return -1;
        else byteOffset = buffer.length - 1;
      } else if (byteOffset < 0) {
        if (dir) byteOffset = 0;
        else return -1;
      }
      if (typeof val === "string") {
        val = Buffer3.from(val, encoding);
      }
      if (Buffer3.isBuffer(val)) {
        if (val.length === 0) {
          return -1;
        }
        return arrayIndexOf(buffer, val, byteOffset, encoding, dir);
      } else if (typeof val === "number") {
        val = val & 255;
        if (typeof Uint8Array.prototype.indexOf === "function") {
          if (dir) {
            return Uint8Array.prototype.indexOf.call(buffer, val, byteOffset);
          } else {
            return Uint8Array.prototype.lastIndexOf.call(buffer, val, byteOffset);
          }
        }
        return arrayIndexOf(buffer, [val], byteOffset, encoding, dir);
      }
      throw new TypeError("val must be string, number or Buffer");
    }
    function arrayIndexOf(arr, val, byteOffset, encoding, dir) {
      let indexSize = 1;
      let arrLength = arr.length;
      let valLength = val.length;
      if (encoding !== void 0) {
        encoding = String(encoding).toLowerCase();
        if (encoding === "ucs2" || encoding === "ucs-2" || encoding === "utf16le" || encoding === "utf-16le") {
          if (arr.length < 2 || val.length < 2) {
            return -1;
          }
          indexSize = 2;
          arrLength /= 2;
          valLength /= 2;
          byteOffset /= 2;
        }
      }
      function read(buf, i2) {
        if (indexSize === 1) {
          return buf[i2];
        } else {
          return buf.readUInt16BE(i2 * indexSize);
        }
      }
      let i;
      if (dir) {
        let foundIndex = -1;
        for (i = byteOffset; i < arrLength; i++) {
          if (read(arr, i) === read(val, foundIndex === -1 ? 0 : i - foundIndex)) {
            if (foundIndex === -1) foundIndex = i;
            if (i - foundIndex + 1 === valLength) return foundIndex * indexSize;
          } else {
            if (foundIndex !== -1) i -= i - foundIndex;
            foundIndex = -1;
          }
        }
      } else {
        if (byteOffset + valLength > arrLength) byteOffset = arrLength - valLength;
        for (i = byteOffset; i >= 0; i--) {
          let found = true;
          for (let j = 0; j < valLength; j++) {
            if (read(arr, i + j) !== read(val, j)) {
              found = false;
              break;
            }
          }
          if (found) return i;
        }
      }
      return -1;
    }
    Buffer3.prototype.includes = function includes(val, byteOffset, encoding) {
      return this.indexOf(val, byteOffset, encoding) !== -1;
    };
    Buffer3.prototype.indexOf = function indexOf(val, byteOffset, encoding) {
      return bidirectionalIndexOf(this, val, byteOffset, encoding, true);
    };
    Buffer3.prototype.lastIndexOf = function lastIndexOf(val, byteOffset, encoding) {
      return bidirectionalIndexOf(this, val, byteOffset, encoding, false);
    };
    function hexWrite(buf, string, offset, length) {
      offset = Number(offset) || 0;
      const remaining = buf.length - offset;
      if (!length) {
        length = remaining;
      } else {
        length = Number(length);
        if (length > remaining) {
          length = remaining;
        }
      }
      const strLen = string.length;
      if (length > strLen / 2) {
        length = strLen / 2;
      }
      let i;
      for (i = 0; i < length; ++i) {
        const parsed = parseInt(string.substr(i * 2, 2), 16);
        if (numberIsNaN(parsed)) return i;
        buf[offset + i] = parsed;
      }
      return i;
    }
    function utf8Write(buf, string, offset, length) {
      return blitBuffer(utf8ToBytes(string, buf.length - offset), buf, offset, length);
    }
    function asciiWrite(buf, string, offset, length) {
      return blitBuffer(asciiToBytes(string), buf, offset, length);
    }
    function base64Write(buf, string, offset, length) {
      return blitBuffer(base64ToBytes(string), buf, offset, length);
    }
    function ucs2Write(buf, string, offset, length) {
      return blitBuffer(utf16leToBytes(string, buf.length - offset), buf, offset, length);
    }
    Buffer3.prototype.write = function write(string, offset, length, encoding) {
      if (offset === void 0) {
        encoding = "utf8";
        length = this.length;
        offset = 0;
      } else if (length === void 0 && typeof offset === "string") {
        encoding = offset;
        length = this.length;
        offset = 0;
      } else if (isFinite(offset)) {
        offset = offset >>> 0;
        if (isFinite(length)) {
          length = length >>> 0;
          if (encoding === void 0) encoding = "utf8";
        } else {
          encoding = length;
          length = void 0;
        }
      } else {
        throw new Error(
          "Buffer.write(string, encoding, offset[, length]) is no longer supported"
        );
      }
      const remaining = this.length - offset;
      if (length === void 0 || length > remaining) length = remaining;
      if (string.length > 0 && (length < 0 || offset < 0) || offset > this.length) {
        throw new RangeError("Attempt to write outside buffer bounds");
      }
      if (!encoding) encoding = "utf8";
      let loweredCase = false;
      for (; ; ) {
        switch (encoding) {
          case "hex":
            return hexWrite(this, string, offset, length);
          case "utf8":
          case "utf-8":
            return utf8Write(this, string, offset, length);
          case "ascii":
          case "latin1":
          case "binary":
            return asciiWrite(this, string, offset, length);
          case "base64":
            return base64Write(this, string, offset, length);
          case "ucs2":
          case "ucs-2":
          case "utf16le":
          case "utf-16le":
            return ucs2Write(this, string, offset, length);
          default:
            if (loweredCase) throw new TypeError("Unknown encoding: " + encoding);
            encoding = ("" + encoding).toLowerCase();
            loweredCase = true;
        }
      }
    };
    Buffer3.prototype.toJSON = function toJSON() {
      return {
        type: "Buffer",
        data: Array.prototype.slice.call(this._arr || this, 0)
      };
    };
    function base64Slice(buf, start, end) {
      if (start === 0 && end === buf.length) {
        return base64.fromByteArray(buf);
      } else {
        return base64.fromByteArray(buf.slice(start, end));
      }
    }
    function utf8Slice(buf, start, end) {
      end = Math.min(buf.length, end);
      const res = [];
      let i = start;
      while (i < end) {
        const firstByte = buf[i];
        let codePoint = null;
        let bytesPerSequence = firstByte > 239 ? 4 : firstByte > 223 ? 3 : firstByte > 191 ? 2 : 1;
        if (i + bytesPerSequence <= end) {
          let secondByte, thirdByte, fourthByte, tempCodePoint;
          switch (bytesPerSequence) {
            case 1:
              if (firstByte < 128) {
                codePoint = firstByte;
              }
              break;
            case 2:
              secondByte = buf[i + 1];
              if ((secondByte & 192) === 128) {
                tempCodePoint = (firstByte & 31) << 6 | secondByte & 63;
                if (tempCodePoint > 127) {
                  codePoint = tempCodePoint;
                }
              }
              break;
            case 3:
              secondByte = buf[i + 1];
              thirdByte = buf[i + 2];
              if ((secondByte & 192) === 128 && (thirdByte & 192) === 128) {
                tempCodePoint = (firstByte & 15) << 12 | (secondByte & 63) << 6 | thirdByte & 63;
                if (tempCodePoint > 2047 && (tempCodePoint < 55296 || tempCodePoint > 57343)) {
                  codePoint = tempCodePoint;
                }
              }
              break;
            case 4:
              secondByte = buf[i + 1];
              thirdByte = buf[i + 2];
              fourthByte = buf[i + 3];
              if ((secondByte & 192) === 128 && (thirdByte & 192) === 128 && (fourthByte & 192) === 128) {
                tempCodePoint = (firstByte & 15) << 18 | (secondByte & 63) << 12 | (thirdByte & 63) << 6 | fourthByte & 63;
                if (tempCodePoint > 65535 && tempCodePoint < 1114112) {
                  codePoint = tempCodePoint;
                }
              }
          }
        }
        if (codePoint === null) {
          codePoint = 65533;
          bytesPerSequence = 1;
        } else if (codePoint > 65535) {
          codePoint -= 65536;
          res.push(codePoint >>> 10 & 1023 | 55296);
          codePoint = 56320 | codePoint & 1023;
        }
        res.push(codePoint);
        i += bytesPerSequence;
      }
      return decodeCodePointsArray(res);
    }
    var MAX_ARGUMENTS_LENGTH = 4096;
    function decodeCodePointsArray(codePoints) {
      const len = codePoints.length;
      if (len <= MAX_ARGUMENTS_LENGTH) {
        return String.fromCharCode.apply(String, codePoints);
      }
      let res = "";
      let i = 0;
      while (i < len) {
        res += String.fromCharCode.apply(
          String,
          codePoints.slice(i, i += MAX_ARGUMENTS_LENGTH)
        );
      }
      return res;
    }
    function asciiSlice(buf, start, end) {
      let ret = "";
      end = Math.min(buf.length, end);
      for (let i = start; i < end; ++i) {
        ret += String.fromCharCode(buf[i] & 127);
      }
      return ret;
    }
    function latin1Slice(buf, start, end) {
      let ret = "";
      end = Math.min(buf.length, end);
      for (let i = start; i < end; ++i) {
        ret += String.fromCharCode(buf[i]);
      }
      return ret;
    }
    function hexSlice(buf, start, end) {
      const len = buf.length;
      if (!start || start < 0) start = 0;
      if (!end || end < 0 || end > len) end = len;
      let out = "";
      for (let i = start; i < end; ++i) {
        out += hexSliceLookupTable[buf[i]];
      }
      return out;
    }
    function utf16leSlice(buf, start, end) {
      const bytes = buf.slice(start, end);
      let res = "";
      for (let i = 0; i < bytes.length - 1; i += 2) {
        res += String.fromCharCode(bytes[i] + bytes[i + 1] * 256);
      }
      return res;
    }
    Buffer3.prototype.slice = function slice(start, end) {
      const len = this.length;
      start = ~~start;
      end = end === void 0 ? len : ~~end;
      if (start < 0) {
        start += len;
        if (start < 0) start = 0;
      } else if (start > len) {
        start = len;
      }
      if (end < 0) {
        end += len;
        if (end < 0) end = 0;
      } else if (end > len) {
        end = len;
      }
      if (end < start) end = start;
      const newBuf = this.subarray(start, end);
      Object.setPrototypeOf(newBuf, Buffer3.prototype);
      return newBuf;
    };
    function checkOffset(offset, ext, length) {
      if (offset % 1 !== 0 || offset < 0) throw new RangeError("offset is not uint");
      if (offset + ext > length) throw new RangeError("Trying to access beyond buffer length");
    }
    Buffer3.prototype.readUintLE = Buffer3.prototype.readUIntLE = function readUIntLE(offset, byteLength2, noAssert) {
      offset = offset >>> 0;
      byteLength2 = byteLength2 >>> 0;
      if (!noAssert) checkOffset(offset, byteLength2, this.length);
      let val = this[offset];
      let mul = 1;
      let i = 0;
      while (++i < byteLength2 && (mul *= 256)) {
        val += this[offset + i] * mul;
      }
      return val;
    };
    Buffer3.prototype.readUintBE = Buffer3.prototype.readUIntBE = function readUIntBE(offset, byteLength2, noAssert) {
      offset = offset >>> 0;
      byteLength2 = byteLength2 >>> 0;
      if (!noAssert) {
        checkOffset(offset, byteLength2, this.length);
      }
      let val = this[offset + --byteLength2];
      let mul = 1;
      while (byteLength2 > 0 && (mul *= 256)) {
        val += this[offset + --byteLength2] * mul;
      }
      return val;
    };
    Buffer3.prototype.readUint8 = Buffer3.prototype.readUInt8 = function readUInt8(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 1, this.length);
      return this[offset];
    };
    Buffer3.prototype.readUint16LE = Buffer3.prototype.readUInt16LE = function readUInt16LE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 2, this.length);
      return this[offset] | this[offset + 1] << 8;
    };
    Buffer3.prototype.readUint16BE = Buffer3.prototype.readUInt16BE = function readUInt16BE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 2, this.length);
      return this[offset] << 8 | this[offset + 1];
    };
    Buffer3.prototype.readUint32LE = Buffer3.prototype.readUInt32LE = function readUInt32LE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 4, this.length);
      return (this[offset] | this[offset + 1] << 8 | this[offset + 2] << 16) + this[offset + 3] * 16777216;
    };
    Buffer3.prototype.readUint32BE = Buffer3.prototype.readUInt32BE = function readUInt32BE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 4, this.length);
      return this[offset] * 16777216 + (this[offset + 1] << 16 | this[offset + 2] << 8 | this[offset + 3]);
    };
    Buffer3.prototype.readBigUInt64LE = defineBigIntMethod(function readBigUInt64LE(offset) {
      offset = offset >>> 0;
      validateNumber(offset, "offset");
      const first = this[offset];
      const last = this[offset + 7];
      if (first === void 0 || last === void 0) {
        boundsError(offset, this.length - 8);
      }
      const lo = first + this[++offset] * 2 ** 8 + this[++offset] * 2 ** 16 + this[++offset] * 2 ** 24;
      const hi = this[++offset] + this[++offset] * 2 ** 8 + this[++offset] * 2 ** 16 + last * 2 ** 24;
      return BigInt(lo) + (BigInt(hi) << BigInt(32));
    });
    Buffer3.prototype.readBigUInt64BE = defineBigIntMethod(function readBigUInt64BE(offset) {
      offset = offset >>> 0;
      validateNumber(offset, "offset");
      const first = this[offset];
      const last = this[offset + 7];
      if (first === void 0 || last === void 0) {
        boundsError(offset, this.length - 8);
      }
      const hi = first * 2 ** 24 + this[++offset] * 2 ** 16 + this[++offset] * 2 ** 8 + this[++offset];
      const lo = this[++offset] * 2 ** 24 + this[++offset] * 2 ** 16 + this[++offset] * 2 ** 8 + last;
      return (BigInt(hi) << BigInt(32)) + BigInt(lo);
    });
    Buffer3.prototype.readIntLE = function readIntLE(offset, byteLength2, noAssert) {
      offset = offset >>> 0;
      byteLength2 = byteLength2 >>> 0;
      if (!noAssert) checkOffset(offset, byteLength2, this.length);
      let val = this[offset];
      let mul = 1;
      let i = 0;
      while (++i < byteLength2 && (mul *= 256)) {
        val += this[offset + i] * mul;
      }
      mul *= 128;
      if (val >= mul) val -= Math.pow(2, 8 * byteLength2);
      return val;
    };
    Buffer3.prototype.readIntBE = function readIntBE(offset, byteLength2, noAssert) {
      offset = offset >>> 0;
      byteLength2 = byteLength2 >>> 0;
      if (!noAssert) checkOffset(offset, byteLength2, this.length);
      let i = byteLength2;
      let mul = 1;
      let val = this[offset + --i];
      while (i > 0 && (mul *= 256)) {
        val += this[offset + --i] * mul;
      }
      mul *= 128;
      if (val >= mul) val -= Math.pow(2, 8 * byteLength2);
      return val;
    };
    Buffer3.prototype.readInt8 = function readInt8(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 1, this.length);
      if (!(this[offset] & 128)) return this[offset];
      return (255 - this[offset] + 1) * -1;
    };
    Buffer3.prototype.readInt16LE = function readInt16LE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 2, this.length);
      const val = this[offset] | this[offset + 1] << 8;
      return val & 32768 ? val | 4294901760 : val;
    };
    Buffer3.prototype.readInt16BE = function readInt16BE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 2, this.length);
      const val = this[offset + 1] | this[offset] << 8;
      return val & 32768 ? val | 4294901760 : val;
    };
    Buffer3.prototype.readInt32LE = function readInt32LE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 4, this.length);
      return this[offset] | this[offset + 1] << 8 | this[offset + 2] << 16 | this[offset + 3] << 24;
    };
    Buffer3.prototype.readInt32BE = function readInt32BE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 4, this.length);
      return this[offset] << 24 | this[offset + 1] << 16 | this[offset + 2] << 8 | this[offset + 3];
    };
    Buffer3.prototype.readBigInt64LE = defineBigIntMethod(function readBigInt64LE(offset) {
      offset = offset >>> 0;
      validateNumber(offset, "offset");
      const first = this[offset];
      const last = this[offset + 7];
      if (first === void 0 || last === void 0) {
        boundsError(offset, this.length - 8);
      }
      const val = this[offset + 4] + this[offset + 5] * 2 ** 8 + this[offset + 6] * 2 ** 16 + (last << 24);
      return (BigInt(val) << BigInt(32)) + BigInt(first + this[++offset] * 2 ** 8 + this[++offset] * 2 ** 16 + this[++offset] * 2 ** 24);
    });
    Buffer3.prototype.readBigInt64BE = defineBigIntMethod(function readBigInt64BE(offset) {
      offset = offset >>> 0;
      validateNumber(offset, "offset");
      const first = this[offset];
      const last = this[offset + 7];
      if (first === void 0 || last === void 0) {
        boundsError(offset, this.length - 8);
      }
      const val = (first << 24) + // Overflow
      this[++offset] * 2 ** 16 + this[++offset] * 2 ** 8 + this[++offset];
      return (BigInt(val) << BigInt(32)) + BigInt(this[++offset] * 2 ** 24 + this[++offset] * 2 ** 16 + this[++offset] * 2 ** 8 + last);
    });
    Buffer3.prototype.readFloatLE = function readFloatLE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 4, this.length);
      return ieee754.read(this, offset, true, 23, 4);
    };
    Buffer3.prototype.readFloatBE = function readFloatBE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 4, this.length);
      return ieee754.read(this, offset, false, 23, 4);
    };
    Buffer3.prototype.readDoubleLE = function readDoubleLE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 8, this.length);
      return ieee754.read(this, offset, true, 52, 8);
    };
    Buffer3.prototype.readDoubleBE = function readDoubleBE(offset, noAssert) {
      offset = offset >>> 0;
      if (!noAssert) checkOffset(offset, 8, this.length);
      return ieee754.read(this, offset, false, 52, 8);
    };
    function checkInt(buf, value, offset, ext, max, min) {
      if (!Buffer3.isBuffer(buf)) throw new TypeError('"buffer" argument must be a Buffer instance');
      if (value > max || value < min) throw new RangeError('"value" argument is out of bounds');
      if (offset + ext > buf.length) throw new RangeError("Index out of range");
    }
    Buffer3.prototype.writeUintLE = Buffer3.prototype.writeUIntLE = function writeUIntLE(value, offset, byteLength2, noAssert) {
      value = +value;
      offset = offset >>> 0;
      byteLength2 = byteLength2 >>> 0;
      if (!noAssert) {
        const maxBytes = Math.pow(2, 8 * byteLength2) - 1;
        checkInt(this, value, offset, byteLength2, maxBytes, 0);
      }
      let mul = 1;
      let i = 0;
      this[offset] = value & 255;
      while (++i < byteLength2 && (mul *= 256)) {
        this[offset + i] = value / mul & 255;
      }
      return offset + byteLength2;
    };
    Buffer3.prototype.writeUintBE = Buffer3.prototype.writeUIntBE = function writeUIntBE(value, offset, byteLength2, noAssert) {
      value = +value;
      offset = offset >>> 0;
      byteLength2 = byteLength2 >>> 0;
      if (!noAssert) {
        const maxBytes = Math.pow(2, 8 * byteLength2) - 1;
        checkInt(this, value, offset, byteLength2, maxBytes, 0);
      }
      let i = byteLength2 - 1;
      let mul = 1;
      this[offset + i] = value & 255;
      while (--i >= 0 && (mul *= 256)) {
        this[offset + i] = value / mul & 255;
      }
      return offset + byteLength2;
    };
    Buffer3.prototype.writeUint8 = Buffer3.prototype.writeUInt8 = function writeUInt8(value, offset, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) checkInt(this, value, offset, 1, 255, 0);
      this[offset] = value & 255;
      return offset + 1;
    };
    Buffer3.prototype.writeUint16LE = Buffer3.prototype.writeUInt16LE = function writeUInt16LE(value, offset, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) checkInt(this, value, offset, 2, 65535, 0);
      this[offset] = value & 255;
      this[offset + 1] = value >>> 8;
      return offset + 2;
    };
    Buffer3.prototype.writeUint16BE = Buffer3.prototype.writeUInt16BE = function writeUInt16BE(value, offset, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) checkInt(this, value, offset, 2, 65535, 0);
      this[offset] = value >>> 8;
      this[offset + 1] = value & 255;
      return offset + 2;
    };
    Buffer3.prototype.writeUint32LE = Buffer3.prototype.writeUInt32LE = function writeUInt32LE(value, offset, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) checkInt(this, value, offset, 4, 4294967295, 0);
      this[offset + 3] = value >>> 24;
      this[offset + 2] = value >>> 16;
      this[offset + 1] = value >>> 8;
      this[offset] = value & 255;
      return offset + 4;
    };
    Buffer3.prototype.writeUint32BE = Buffer3.prototype.writeUInt32BE = function writeUInt32BE(value, offset, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) checkInt(this, value, offset, 4, 4294967295, 0);
      this[offset] = value >>> 24;
      this[offset + 1] = value >>> 16;
      this[offset + 2] = value >>> 8;
      this[offset + 3] = value & 255;
      return offset + 4;
    };
    function wrtBigUInt64LE(buf, value, offset, min, max) {
      checkIntBI(value, min, max, buf, offset, 7);
      let lo = Number(value & BigInt(4294967295));
      buf[offset++] = lo;
      lo = lo >> 8;
      buf[offset++] = lo;
      lo = lo >> 8;
      buf[offset++] = lo;
      lo = lo >> 8;
      buf[offset++] = lo;
      let hi = Number(value >> BigInt(32) & BigInt(4294967295));
      buf[offset++] = hi;
      hi = hi >> 8;
      buf[offset++] = hi;
      hi = hi >> 8;
      buf[offset++] = hi;
      hi = hi >> 8;
      buf[offset++] = hi;
      return offset;
    }
    function wrtBigUInt64BE(buf, value, offset, min, max) {
      checkIntBI(value, min, max, buf, offset, 7);
      let lo = Number(value & BigInt(4294967295));
      buf[offset + 7] = lo;
      lo = lo >> 8;
      buf[offset + 6] = lo;
      lo = lo >> 8;
      buf[offset + 5] = lo;
      lo = lo >> 8;
      buf[offset + 4] = lo;
      let hi = Number(value >> BigInt(32) & BigInt(4294967295));
      buf[offset + 3] = hi;
      hi = hi >> 8;
      buf[offset + 2] = hi;
      hi = hi >> 8;
      buf[offset + 1] = hi;
      hi = hi >> 8;
      buf[offset] = hi;
      return offset + 8;
    }
    Buffer3.prototype.writeBigUInt64LE = defineBigIntMethod(function writeBigUInt64LE(value, offset = 0) {
      return wrtBigUInt64LE(this, value, offset, BigInt(0), BigInt("0xffffffffffffffff"));
    });
    Buffer3.prototype.writeBigUInt64BE = defineBigIntMethod(function writeBigUInt64BE(value, offset = 0) {
      return wrtBigUInt64BE(this, value, offset, BigInt(0), BigInt("0xffffffffffffffff"));
    });
    Buffer3.prototype.writeIntLE = function writeIntLE(value, offset, byteLength2, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) {
        const limit = Math.pow(2, 8 * byteLength2 - 1);
        checkInt(this, value, offset, byteLength2, limit - 1, -limit);
      }
      let i = 0;
      let mul = 1;
      let sub = 0;
      this[offset] = value & 255;
      while (++i < byteLength2 && (mul *= 256)) {
        if (value < 0 && sub === 0 && this[offset + i - 1] !== 0) {
          sub = 1;
        }
        this[offset + i] = (value / mul >> 0) - sub & 255;
      }
      return offset + byteLength2;
    };
    Buffer3.prototype.writeIntBE = function writeIntBE(value, offset, byteLength2, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) {
        const limit = Math.pow(2, 8 * byteLength2 - 1);
        checkInt(this, value, offset, byteLength2, limit - 1, -limit);
      }
      let i = byteLength2 - 1;
      let mul = 1;
      let sub = 0;
      this[offset + i] = value & 255;
      while (--i >= 0 && (mul *= 256)) {
        if (value < 0 && sub === 0 && this[offset + i + 1] !== 0) {
          sub = 1;
        }
        this[offset + i] = (value / mul >> 0) - sub & 255;
      }
      return offset + byteLength2;
    };
    Buffer3.prototype.writeInt8 = function writeInt8(value, offset, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) checkInt(this, value, offset, 1, 127, -128);
      if (value < 0) value = 255 + value + 1;
      this[offset] = value & 255;
      return offset + 1;
    };
    Buffer3.prototype.writeInt16LE = function writeInt16LE(value, offset, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) checkInt(this, value, offset, 2, 32767, -32768);
      this[offset] = value & 255;
      this[offset + 1] = value >>> 8;
      return offset + 2;
    };
    Buffer3.prototype.writeInt16BE = function writeInt16BE(value, offset, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) checkInt(this, value, offset, 2, 32767, -32768);
      this[offset] = value >>> 8;
      this[offset + 1] = value & 255;
      return offset + 2;
    };
    Buffer3.prototype.writeInt32LE = function writeInt32LE(value, offset, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) checkInt(this, value, offset, 4, 2147483647, -2147483648);
      this[offset] = value & 255;
      this[offset + 1] = value >>> 8;
      this[offset + 2] = value >>> 16;
      this[offset + 3] = value >>> 24;
      return offset + 4;
    };
    Buffer3.prototype.writeInt32BE = function writeInt32BE(value, offset, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) checkInt(this, value, offset, 4, 2147483647, -2147483648);
      if (value < 0) value = 4294967295 + value + 1;
      this[offset] = value >>> 24;
      this[offset + 1] = value >>> 16;
      this[offset + 2] = value >>> 8;
      this[offset + 3] = value & 255;
      return offset + 4;
    };
    Buffer3.prototype.writeBigInt64LE = defineBigIntMethod(function writeBigInt64LE(value, offset = 0) {
      return wrtBigUInt64LE(this, value, offset, -BigInt("0x8000000000000000"), BigInt("0x7fffffffffffffff"));
    });
    Buffer3.prototype.writeBigInt64BE = defineBigIntMethod(function writeBigInt64BE(value, offset = 0) {
      return wrtBigUInt64BE(this, value, offset, -BigInt("0x8000000000000000"), BigInt("0x7fffffffffffffff"));
    });
    function checkIEEE754(buf, value, offset, ext, max, min) {
      if (offset + ext > buf.length) throw new RangeError("Index out of range");
      if (offset < 0) throw new RangeError("Index out of range");
    }
    function writeFloat(buf, value, offset, littleEndian, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) {
        checkIEEE754(buf, value, offset, 4, 34028234663852886e22, -34028234663852886e22);
      }
      ieee754.write(buf, value, offset, littleEndian, 23, 4);
      return offset + 4;
    }
    Buffer3.prototype.writeFloatLE = function writeFloatLE(value, offset, noAssert) {
      return writeFloat(this, value, offset, true, noAssert);
    };
    Buffer3.prototype.writeFloatBE = function writeFloatBE(value, offset, noAssert) {
      return writeFloat(this, value, offset, false, noAssert);
    };
    function writeDouble(buf, value, offset, littleEndian, noAssert) {
      value = +value;
      offset = offset >>> 0;
      if (!noAssert) {
        checkIEEE754(buf, value, offset, 8, 17976931348623157e292, -17976931348623157e292);
      }
      ieee754.write(buf, value, offset, littleEndian, 52, 8);
      return offset + 8;
    }
    Buffer3.prototype.writeDoubleLE = function writeDoubleLE(value, offset, noAssert) {
      return writeDouble(this, value, offset, true, noAssert);
    };
    Buffer3.prototype.writeDoubleBE = function writeDoubleBE(value, offset, noAssert) {
      return writeDouble(this, value, offset, false, noAssert);
    };
    Buffer3.prototype.copy = function copy(target, targetStart, start, end) {
      if (!Buffer3.isBuffer(target)) throw new TypeError("argument should be a Buffer");
      if (!start) start = 0;
      if (!end && end !== 0) end = this.length;
      if (targetStart >= target.length) targetStart = target.length;
      if (!targetStart) targetStart = 0;
      if (end > 0 && end < start) end = start;
      if (end === start) return 0;
      if (target.length === 0 || this.length === 0) return 0;
      if (targetStart < 0) {
        throw new RangeError("targetStart out of bounds");
      }
      if (start < 0 || start >= this.length) throw new RangeError("Index out of range");
      if (end < 0) throw new RangeError("sourceEnd out of bounds");
      if (end > this.length) end = this.length;
      if (target.length - targetStart < end - start) {
        end = target.length - targetStart + start;
      }
      const len = end - start;
      if (this === target && typeof Uint8Array.prototype.copyWithin === "function") {
        this.copyWithin(targetStart, start, end);
      } else {
        Uint8Array.prototype.set.call(
          target,
          this.subarray(start, end),
          targetStart
        );
      }
      return len;
    };
    Buffer3.prototype.fill = function fill(val, start, end, encoding) {
      if (typeof val === "string") {
        if (typeof start === "string") {
          encoding = start;
          start = 0;
          end = this.length;
        } else if (typeof end === "string") {
          encoding = end;
          end = this.length;
        }
        if (encoding !== void 0 && typeof encoding !== "string") {
          throw new TypeError("encoding must be a string");
        }
        if (typeof encoding === "string" && !Buffer3.isEncoding(encoding)) {
          throw new TypeError("Unknown encoding: " + encoding);
        }
        if (val.length === 1) {
          const code = val.charCodeAt(0);
          if (encoding === "utf8" && code < 128 || encoding === "latin1") {
            val = code;
          }
        }
      } else if (typeof val === "number") {
        val = val & 255;
      } else if (typeof val === "boolean") {
        val = Number(val);
      }
      if (start < 0 || this.length < start || this.length < end) {
        throw new RangeError("Out of range index");
      }
      if (end <= start) {
        return this;
      }
      start = start >>> 0;
      end = end === void 0 ? this.length : end >>> 0;
      if (!val) val = 0;
      let i;
      if (typeof val === "number") {
        for (i = start; i < end; ++i) {
          this[i] = val;
        }
      } else {
        const bytes = Buffer3.isBuffer(val) ? val : Buffer3.from(val, encoding);
        const len = bytes.length;
        if (len === 0) {
          throw new TypeError('The value "' + val + '" is invalid for argument "value"');
        }
        for (i = 0; i < end - start; ++i) {
          this[i + start] = bytes[i % len];
        }
      }
      return this;
    };
    var errors = {};
    function E(sym, getMessage, Base) {
      errors[sym] = class NodeError extends Base {
        constructor() {
          super();
          Object.defineProperty(this, "message", {
            value: getMessage.apply(this, arguments),
            writable: true,
            configurable: true
          });
          this.name = `${this.name} [${sym}]`;
          this.stack;
          delete this.name;
        }
        get code() {
          return sym;
        }
        set code(value) {
          Object.defineProperty(this, "code", {
            configurable: true,
            enumerable: true,
            value,
            writable: true
          });
        }
        toString() {
          return `${this.name} [${sym}]: ${this.message}`;
        }
      };
    }
    E(
      "ERR_BUFFER_OUT_OF_BOUNDS",
      function(name) {
        if (name) {
          return `${name} is outside of buffer bounds`;
        }
        return "Attempt to access memory outside buffer bounds";
      },
      RangeError
    );
    E(
      "ERR_INVALID_ARG_TYPE",
      function(name, actual) {
        return `The "${name}" argument must be of type number. Received type ${typeof actual}`;
      },
      TypeError
    );
    E(
      "ERR_OUT_OF_RANGE",
      function(str, range, input) {
        let msg = `The value of "${str}" is out of range.`;
        let received = input;
        if (Number.isInteger(input) && Math.abs(input) > 2 ** 32) {
          received = addNumericalSeparator(String(input));
        } else if (typeof input === "bigint") {
          received = String(input);
          if (input > BigInt(2) ** BigInt(32) || input < -(BigInt(2) ** BigInt(32))) {
            received = addNumericalSeparator(received);
          }
          received += "n";
        }
        msg += ` It must be ${range}. Received ${received}`;
        return msg;
      },
      RangeError
    );
    function addNumericalSeparator(val) {
      let res = "";
      let i = val.length;
      const start = val[0] === "-" ? 1 : 0;
      for (; i >= start + 4; i -= 3) {
        res = `_${val.slice(i - 3, i)}${res}`;
      }
      return `${val.slice(0, i)}${res}`;
    }
    function checkBounds(buf, offset, byteLength2) {
      validateNumber(offset, "offset");
      if (buf[offset] === void 0 || buf[offset + byteLength2] === void 0) {
        boundsError(offset, buf.length - (byteLength2 + 1));
      }
    }
    function checkIntBI(value, min, max, buf, offset, byteLength2) {
      if (value > max || value < min) {
        const n = typeof min === "bigint" ? "n" : "";
        let range;
        if (byteLength2 > 3) {
          if (min === 0 || min === BigInt(0)) {
            range = `>= 0${n} and < 2${n} ** ${(byteLength2 + 1) * 8}${n}`;
          } else {
            range = `>= -(2${n} ** ${(byteLength2 + 1) * 8 - 1}${n}) and < 2 ** ${(byteLength2 + 1) * 8 - 1}${n}`;
          }
        } else {
          range = `>= ${min}${n} and <= ${max}${n}`;
        }
        throw new errors.ERR_OUT_OF_RANGE("value", range, value);
      }
      checkBounds(buf, offset, byteLength2);
    }
    function validateNumber(value, name) {
      if (typeof value !== "number") {
        throw new errors.ERR_INVALID_ARG_TYPE(name, "number", value);
      }
    }
    function boundsError(value, length, type) {
      if (Math.floor(value) !== value) {
        validateNumber(value, type);
        throw new errors.ERR_OUT_OF_RANGE(type || "offset", "an integer", value);
      }
      if (length < 0) {
        throw new errors.ERR_BUFFER_OUT_OF_BOUNDS();
      }
      throw new errors.ERR_OUT_OF_RANGE(
        type || "offset",
        `>= ${type ? 1 : 0} and <= ${length}`,
        value
      );
    }
    var INVALID_BASE64_RE = /[^+/0-9A-Za-z-_]/g;
    function base64clean(str) {
      str = str.split("=")[0];
      str = str.trim().replace(INVALID_BASE64_RE, "");
      if (str.length < 2) return "";
      while (str.length % 4 !== 0) {
        str = str + "=";
      }
      return str;
    }
    function utf8ToBytes(string, units) {
      units = units || Infinity;
      let codePoint;
      const length = string.length;
      let leadSurrogate = null;
      const bytes = [];
      for (let i = 0; i < length; ++i) {
        codePoint = string.charCodeAt(i);
        if (codePoint > 55295 && codePoint < 57344) {
          if (!leadSurrogate) {
            if (codePoint > 56319) {
              if ((units -= 3) > -1) bytes.push(239, 191, 189);
              continue;
            } else if (i + 1 === length) {
              if ((units -= 3) > -1) bytes.push(239, 191, 189);
              continue;
            }
            leadSurrogate = codePoint;
            continue;
          }
          if (codePoint < 56320) {
            if ((units -= 3) > -1) bytes.push(239, 191, 189);
            leadSurrogate = codePoint;
            continue;
          }
          codePoint = (leadSurrogate - 55296 << 10 | codePoint - 56320) + 65536;
        } else if (leadSurrogate) {
          if ((units -= 3) > -1) bytes.push(239, 191, 189);
        }
        leadSurrogate = null;
        if (codePoint < 128) {
          if ((units -= 1) < 0) break;
          bytes.push(codePoint);
        } else if (codePoint < 2048) {
          if ((units -= 2) < 0) break;
          bytes.push(
            codePoint >> 6 | 192,
            codePoint & 63 | 128
          );
        } else if (codePoint < 65536) {
          if ((units -= 3) < 0) break;
          bytes.push(
            codePoint >> 12 | 224,
            codePoint >> 6 & 63 | 128,
            codePoint & 63 | 128
          );
        } else if (codePoint < 1114112) {
          if ((units -= 4) < 0) break;
          bytes.push(
            codePoint >> 18 | 240,
            codePoint >> 12 & 63 | 128,
            codePoint >> 6 & 63 | 128,
            codePoint & 63 | 128
          );
        } else {
          throw new Error("Invalid code point");
        }
      }
      return bytes;
    }
    function asciiToBytes(str) {
      const byteArray = [];
      for (let i = 0; i < str.length; ++i) {
        byteArray.push(str.charCodeAt(i) & 255);
      }
      return byteArray;
    }
    function utf16leToBytes(str, units) {
      let c, hi, lo;
      const byteArray = [];
      for (let i = 0; i < str.length; ++i) {
        if ((units -= 2) < 0) break;
        c = str.charCodeAt(i);
        hi = c >> 8;
        lo = c % 256;
        byteArray.push(lo);
        byteArray.push(hi);
      }
      return byteArray;
    }
    function base64ToBytes(str) {
      return base64.toByteArray(base64clean(str));
    }
    function blitBuffer(src, dst, offset, length) {
      let i;
      for (i = 0; i < length; ++i) {
        if (i + offset >= dst.length || i >= src.length) break;
        dst[i + offset] = src[i];
      }
      return i;
    }
    function isInstance(obj, type) {
      return obj instanceof type || obj != null && obj.constructor != null && obj.constructor.name != null && obj.constructor.name === type.name;
    }
    function numberIsNaN(obj) {
      return obj !== obj;
    }
    var hexSliceLookupTable = (function() {
      const alphabet = "0123456789abcdef";
      const table = new Array(256);
      for (let i = 0; i < 16; ++i) {
        const i16 = i * 16;
        for (let j = 0; j < 16; ++j) {
          table[i16 + j] = alphabet[i] + alphabet[j];
        }
      }
      return table;
    })();
    function defineBigIntMethod(fn) {
      return typeof BigInt === "undefined" ? BufferBigIntNotDefined : fn;
    }
    function BufferBigIntNotDefined() {
      throw new Error("BigInt not supported");
    }
  }
});

// playground/shims/buffer.mjs
var import_buffer, origToString, origFrom;
var init_buffer = __esm({
  "playground/shims/buffer.mjs"() {
    import_buffer = __toESM(require_buffer(), 1);
    origToString = import_buffer.Buffer.prototype.toString;
    import_buffer.Buffer.prototype.toString = function(enc, ...rest) {
      if (enc === "base64url") {
        return origToString.call(this, "base64", ...rest).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      }
      return origToString.call(this, enc, ...rest);
    };
    origFrom = import_buffer.Buffer.from.bind(import_buffer.Buffer);
    import_buffer.Buffer.from = function(data, enc, ...rest) {
      if (enc === "base64url" && typeof data === "string") {
        const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
        return origFrom(b64, "base64", ...rest);
      }
      return origFrom(data, enc, ...rest);
    };
  }
});

// playground/entry.mjs
init_buffer();

// playground/shims/node-crypto.mjs
init_buffer();
var K = new Uint32Array([
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
]);
var rotr = (x, n) => x >>> n | x << 32 - n;
function sha256Bytes(data) {
  const bytes = data instanceof Uint8Array ? data : new TextEncoder().encode(String(data));
  const bitLen = bytes.length * 8;
  const pad = bytes.length + 9 + 63 & ~63;
  const m = new Uint8Array(pad);
  m.set(bytes);
  m[bytes.length] = 128;
  const dv = new DataView(m.buffer);
  dv.setUint32(pad - 4, bitLen >>> 0);
  dv.setUint32(pad - 8, Math.floor(bitLen / 4294967296));
  const h = new Uint32Array([1779033703, 3144134277, 1013904242, 2773480762, 1359893119, 2600822924, 528734635, 1541459225]);
  const w = new Uint32Array(64);
  for (let off = 0; off < pad; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ w[i - 15] >>> 3;
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ w[i - 2] >>> 10;
      w[i] = w[i - 16] + s0 + w[i - 7] + s1 >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = e & f ^ ~e & g;
      const t1 = hh + S1 + ch + K[i] + w[i] >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = a & b ^ a & c ^ b & c;
      const t2 = S0 + maj >>> 0;
      [hh, g, f, e, d, c, b, a] = [g, f, e, d + t1 >>> 0, c, b, a, t1 + t2 >>> 0];
    }
    h[0] = h[0] + a >>> 0;
    h[1] = h[1] + b >>> 0;
    h[2] = h[2] + c >>> 0;
    h[3] = h[3] + d >>> 0;
    h[4] = h[4] + e >>> 0;
    h[5] = h[5] + f >>> 0;
    h[6] = h[6] + g >>> 0;
    h[7] = h[7] + hh >>> 0;
  }
  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) ov.setUint32(i * 4, h[i]);
  return out;
}
var bytesOf = (d) => d instanceof Uint8Array ? d : import_buffer.Buffer.isBuffer(d) ? new Uint8Array(d) : new TextEncoder().encode(String(d));
function hmacSha256Bytes(key, data) {
  let k = bytesOf(key);
  if (k.length > 64) k = sha256Bytes(k);
  const ipad = new Uint8Array(64).fill(54);
  const opad = new Uint8Array(64).fill(92);
  for (let i = 0; i < k.length; i++) {
    ipad[i] ^= k[i];
    opad[i] ^= k[i];
  }
  const inner = new Uint8Array(64 + bytesOf(data).length);
  inner.set(ipad);
  inner.set(bytesOf(data), 64);
  const ih = sha256Bytes(inner);
  const outer = new Uint8Array(64 + 32);
  outer.set(opad);
  outer.set(ih, 64);
  return sha256Bytes(outer);
}
function hashLike(fn) {
  const chunks = [];
  const self = {
    update(d) {
      chunks.push(bytesOf(d));
      return self;
    },
    digest(enc) {
      const all = new Uint8Array(chunks.reduce((a, c) => a + c.length, 0));
      let o = 0;
      for (const c of chunks) {
        all.set(c, o);
        o += c.length;
      }
      const bytes = fn(all);
      return enc === void 0 ? import_buffer.Buffer.from(bytes) : import_buffer.Buffer.from(bytes).toString(enc);
    }
  };
  return self;
}
var createHash = () => hashLike(sha256Bytes);
var createHmac = (_alg, key) => hashLike((d) => hmacSha256Bytes(bytesOf(key), d));
var timingSafeEqual = (a, b) => {
  const x = bytesOf(a), y = bytesOf(b);
  if (x.length !== y.length) return false;
  let v = 0;
  for (let i = 0; i < x.length; i++) v |= x[i] ^ y[i];
  return v === 0;
};
var unsupported = (name) => () => {
  throw new Error(`${name} is Node-only \u2014 the browser playground uses hmac-sha256 demo issuers (production deployments use Ed25519 via Node/KMS)`);
};
var sign = unsupported("sign");
var verify = unsupported("verify");
var generateKeyPairSync = unsupported("generateKeyPairSync");
var createPrivateKey = unsupported("createPrivateKey");
var createPublicKey = unsupported("createPublicKey");

// packages/core/dist/index.js
init_buffer();

// packages/core/dist/types.js
init_buffer();
var Verdict = {
  Allow: "ALLOW",
  Review: "REVIEW",
  Block: "BLOCK"
};
var INTENT_KINDS = [
  "LOAN_DISBURSAL",
  "PA_SETTLEMENT",
  "REFUND",
  "VDA_WITHDRAWAL",
  "VENDOR_PAYOUT",
  "VERIFICATION"
];
var CHANNELS = ["IMPS", "NEFT", "RTGS", "UPI", "INTERNAL", "CRYPTO"];

// packages/core/dist/canonical.js
init_buffer();
function canonicalJson(value) {
  if (value === null)
    return "null";
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isSafeInteger(value))
        throw new TypeError(`canonicalJson: non-integer number ${value}`);
      return String(value);
    case "object": {
      if (Array.isArray(value))
        return `[${value.map(canonicalJson).join(",")}]`;
      const obj = value;
      const keys = Object.keys(obj).filter((k) => obj[k] !== void 0).sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
    }
    default:
      throw new TypeError(`canonicalJson: unsupported type ${typeof value}`);
  }
}

// packages/core/dist/engine.js
init_buffer();
var severity = (v) => v === Verdict.Block ? 2 : v === Verdict.Review ? 1 : 0;
var EMPTY_HITS = [];
var EMPTY_ERRORS = [];
var LATENCY_BUCKETS_MICROS = [50, 100, 250, 500, 1e3, 2500, 5e3];
var Engine = class {
  rules;
  validate;
  onRuleError;
  evaluated = 0;
  allow = 0;
  review = 0;
  block = 0;
  degradedCount = 0;
  latencySum = 0;
  latencyCounts = new Array(LATENCY_BUCKETS_MICROS.length + 1).fill(0);
  hitCounts = /* @__PURE__ */ new Map();
  errorCounts = /* @__PURE__ */ new Map();
  constructor(rules, options) {
    this.rules = rules.slice();
    this.validate = options.validate;
    this.onRuleError = options.onRuleError;
  }
  get ruleNames() {
    return this.rules.map((r) => r.name);
  }
  evaluate(req, ctx) {
    const start = performance.now();
    let worst = Verdict.Allow;
    let hits = null;
    let errors = null;
    let problem;
    try {
      problem = this.validate(req);
    } catch {
      problem = "shape validation threw";
    }
    if (problem !== null) {
      errors = [{ rule: "engine", message: `malformed request: ${problem}` }];
      worst = Verdict.Review;
    } else {
      for (const rule of this.rules) {
        let hit2;
        try {
          hit2 = rule.evaluate(req, ctx);
        } catch (e) {
          (errors ??= []).push({ rule: rule.name, message: e instanceof Error ? e.message : String(e) });
          this.errorCounts.set(rule.name, (this.errorCounts.get(rule.name) ?? 0) + 1);
          try {
            this.onRuleError?.(rule.name, e);
          } catch {
          }
          continue;
        }
        if (hit2 === null)
          continue;
        this.hitCounts.set(hit2.rule, (this.hitCounts.get(hit2.rule) ?? 0) + 1);
        (hits ??= []).push(hit2);
        if (severity(hit2.verdict) > severity(worst)) {
          worst = hit2.verdict;
          if (worst === Verdict.Block)
            break;
        }
      }
    }
    if (errors !== null && worst === Verdict.Allow)
      worst = Verdict.Review;
    const elapsed = (performance.now() - start) * 1e3;
    this.evaluated += 1;
    if (worst === Verdict.Block)
      this.block += 1;
    else if (worst === Verdict.Review)
      this.review += 1;
    else
      this.allow += 1;
    if (errors !== null)
      this.degradedCount += 1;
    this.latencySum += elapsed;
    let b = 0;
    while (b < LATENCY_BUCKETS_MICROS.length && elapsed > LATENCY_BUCKETS_MICROS[b])
      b += 1;
    this.latencyCounts[b] += 1;
    return {
      verdict: worst,
      hits: hits ?? EMPTY_HITS,
      ruleErrors: errors ?? EMPTY_ERRORS,
      degraded: errors !== null,
      elapsedMicros: elapsed
    };
  }
  get metrics() {
    return {
      evaluated: this.evaluated,
      verdicts: { allow: this.allow, review: this.review, block: this.block },
      ruleHits: Object.fromEntries(this.hitCounts),
      ruleErrors: Object.fromEntries(this.errorCounts),
      degraded: this.degradedCount,
      latencyMicros: { buckets: LATENCY_BUCKETS_MICROS, counts: this.latencyCounts.slice(), sum: this.latencySum }
    };
  }
  ruleStats() {
    const out = {};
    for (const r of this.rules) {
      const s = r.stats?.();
      if (s !== void 0)
        out[r.name] = s;
    }
    return out;
  }
  /** Hot-swap rules; same-named rules carry their state across (Krediwall `replaceRules`). */
  replaceRules(rules) {
    const old = new Map(this.rules.map((r) => [r.name, r]));
    for (const r of rules) {
      const s = old.get(r.name)?.exportState?.();
      if (s !== void 0)
        r.restoreState?.(s);
    }
    this.rules = rules.slice();
  }
  exportState() {
    const out = {};
    for (const r of this.rules) {
      const s = r.exportState?.();
      if (s !== void 0)
        out[r.name] = s;
    }
    return out;
  }
  restoreState(state) {
    for (const r of this.rules) {
      const s = state[r.name];
      if (s !== void 0)
        r.restoreState?.(s);
    }
  }
  reset() {
    for (const r of this.rules)
      r.reset?.();
  }
};

// packages/core/dist/hash.js
init_buffer();
var MOBILE = /^(?:\+?91|0)?([6-9]\d{9})$/;
function normalizeMobile(input) {
  const m = MOBILE.exec(input.replace(/[\s\-()]/g, ""));
  return m?.[1] ?? null;
}
function beneficiaryPreimage(id) {
  if ("account" in id) {
    const account = id.account.replace(/[\s-]/g, "");
    const ifsc = id.ifsc.trim().toUpperCase();
    if (!/^\d{6,20}$/.test(account))
      throw new TypeError("account number must be 6\u201320 digits");
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc))
      throw new TypeError("IFSC must look like ABCD0123456");
    return `acct:${account}|${ifsc}`;
  }
  if ("vpa" in id) {
    const vpa = id.vpa.trim().toLowerCase();
    if (!/^[a-z0-9._-]{2,256}@[a-z][a-z0-9.-]{1,64}$/.test(vpa))
      throw new TypeError("VPA must look like name@handle");
    return `vpa:${vpa}`;
  }
  if ("mobile" in id) {
    const mobile = normalizeMobile(id.mobile);
    if (mobile === null)
      throw new TypeError("mobile must be a 10-digit Indian number");
    return `mob:${mobile}`;
  }
  return `vda:${id.network.trim().toLowerCase()}:${id.address.trim()}`;
}
function hashBeneficiary(id, key) {
  if (key.length < 16)
    throw new RangeError("beneficiary HMAC key must be at least 16 bytes");
  return `hb1_${createHmac("sha256", key).update(beneficiaryPreimage(id)).digest("base64url")}`;
}
var RAW_ACCOUNT = /^\d{6,20}$/;
var RAW_IFSC = /[A-Z]{4}0[A-Z0-9]{6}/i;
function looksLikeRawIdentifier(ref2) {
  if (ref2.includes("@"))
    return true;
  const compact = ref2.replace(/[\s\-+]/g, "");
  if (RAW_ACCOUNT.test(compact))
    return true;
  if (RAW_IFSC.test(ref2) && /\d{6,}/.test(ref2))
    return true;
  return false;
}

// packages/core/dist/intent.js
init_buffer();
var INTENT_DOMAIN = "payrekha-intent-v1\n";
function intentSigningPayload(intent2) {
  const { signature: _ignored, ...rest } = intent2;
  void _ignored;
  return import_buffer.Buffer.from(INTENT_DOMAIN + canonicalJson(rest), "utf8");
}
var PKCS8_ED25519_PREFIX = import_buffer.Buffer.from("302e020100300506032b657004220420", "hex");
var toPrivateKey = (k) => typeof k !== "string" ? k : k.includes("BEGIN") ? createPrivateKey(k) : createPrivateKey({ key: import_buffer.Buffer.from(k, "base64"), format: "der", type: "pkcs8" });
var toPublicKey = (k) => k.includes("BEGIN") ? createPublicKey(k) : createPublicKey({ key: import_buffer.Buffer.from(k, "base64"), format: "der", type: "spki" });
function signIntent(intent2, key) {
  const payload = intentSigningPayload(intent2);
  const signature = key.alg === "ed25519" ? sign(null, payload, toPrivateKey(key.privateKey)).toString("base64url") : createHmac("sha256", key.secret).update(payload).digest("base64url");
  return { ...intent2, signature };
}
var Keyring = class {
  keys = /* @__PURE__ */ new Map();
  gen = 0;
  constructor(keys = []) {
    for (const k of keys)
      this.add(k);
  }
  /** Bumps on every change; cached verifications from older generations are redone. */
  get generation() {
    return this.gen;
  }
  get size() {
    return this.keys.size;
  }
  add(key) {
    if (key.alg === "ed25519" && key.publicKey === void 0)
      throw new TypeError(`key ${key.keyId}: ed25519 needs publicKey`);
    if (key.alg === "hmac-sha256" && (key.secret === void 0 || key.secret.length < 32))
      throw new TypeError(`key ${key.keyId}: hmac-sha256 needs a secret of at least 32 chars`);
    const pub = key.alg === "ed25519" ? toPublicKey(key.publicKey) : null;
    this.keys.set(key.keyId, { meta: key, pub });
    this.gen += 1;
  }
  revoke(keyId) {
    const k = this.keys.get(keyId);
    if (k === void 0)
      return false;
    this.keys.set(keyId, { meta: { ...k.meta, revoked: true }, pub: k.pub });
    this.gen += 1;
    return true;
  }
  list() {
    return [...this.keys.values()].map(({ meta }) => {
      const { secret: _s, ...rest } = meta;
      void _s;
      return rest;
    });
  }
  verify(intent2, atMs) {
    const entry = this.keys.get(intent2.keyId);
    if (entry === void 0)
      return { ok: false, reason: "unknown-key" };
    const { meta, pub } = entry;
    if (meta.issuer !== intent2.issuer)
      return { ok: false, reason: "issuer-mismatch" };
    if (!meta.kinds.includes(intent2.kind))
      return { ok: false, reason: "kind-not-allowed" };
    if (meta.revoked === true)
      return { ok: false, reason: "key-revoked" };
    if (meta.notAfterMs !== void 0 && atMs > meta.notAfterMs)
      return { ok: false, reason: "key-expired" };
    let sig;
    try {
      sig = import_buffer.Buffer.from(intent2.signature, "base64url");
    } catch {
      return { ok: false, reason: "bad-signature" };
    }
    const payload = intentSigningPayload(intent2);
    let good;
    if (meta.alg === "ed25519") {
      try {
        good = sig.length === 64 && verify(null, payload, pub, sig);
      } catch {
        good = false;
      }
    } else {
      const expect = createHmac("sha256", meta.secret).update(payload).digest();
      good = sig.length === expect.length && timingSafeEqual(sig, expect);
    }
    return good ? { ok: true } : { ok: false, reason: "bad-signature" };
  }
};
var isStr = (v, max = 256) => typeof v === "string" && v.length > 0 && v.length <= max;
var isPaise = (v) => Number.isSafeInteger(v) && v >= 0;
function intentShapeProblem(x) {
  if (typeof x !== "object" || x === null)
    return "intent must be an object";
  const i = x;
  if (!isStr(i["intentId"], 128))
    return "intentId must be a non-empty string";
  if (!INTENT_KINDS.includes(i["kind"]))
    return "kind is not a known IntentKind";
  if (!isPaise(i["maxAmountPaise"]) || i["maxAmountPaise"] === 0)
    return "maxAmountPaise must be a positive integer (paise)";
  if (!isStr(i["beneficiaryRef"]))
    return "beneficiaryRef must be a non-empty string";
  if (looksLikeRawIdentifier(i["beneficiaryRef"]))
    return "beneficiaryRef looks like a raw identifier; hash it first";
  if (i["subjectRef"] !== void 0 && !isStr(i["subjectRef"]))
    return "subjectRef must be a string";
  if (!Number.isSafeInteger(i["maxUses"]) || i["maxUses"] < 1)
    return "maxUses must be an integer \u2265 1";
  if (!isPaise(i["notBeforeMs"]) || !isPaise(i["expiresAtMs"]))
    return "notBeforeMs/expiresAtMs must be epoch ms integers";
  if (i["expiresAtMs"] <= i["notBeforeMs"])
    return "expiresAtMs must be after notBeforeMs";
  if (!isStr(i["issuer"], 64) || !isStr(i["keyId"], 64))
    return "issuer and keyId are required";
  if (!isStr(i["signature"], 512))
    return "signature is required";
  return null;
}

// packages/core/dist/registry.js
init_buffer();

// packages/core/dist/lru.js
init_buffer();
var LruMap = class {
  maxEntries;
  map = /* @__PURE__ */ new Map();
  head = null;
  tail = null;
  evicted = 0;
  constructor(maxEntries) {
    this.maxEntries = maxEntries;
  }
  get size() {
    return this.map.size;
  }
  get evictedCount() {
    return this.evicted;
  }
  has(key) {
    return this.map.has(key);
  }
  /** Read without touching recency. */
  peek(key) {
    return this.map.get(key)?.value;
  }
  get(key) {
    const node = this.map.get(key);
    if (node === void 0)
      return void 0;
    this.touch(node);
    return node.value;
  }
  set(key, value) {
    const existing = this.map.get(key);
    if (existing !== void 0) {
      existing.value = value;
      this.touch(existing);
      return;
    }
    const node = { key, value, prev: null, next: this.head };
    if (this.head !== null)
      this.head.prev = node;
    this.head = node;
    this.tail ??= node;
    this.map.set(key, node);
    if (this.map.size > this.maxEntries && this.tail !== null) {
      const lru = this.tail;
      this.unlink(lru);
      this.map.delete(lru.key);
      this.evicted += 1;
    }
  }
  delete(key) {
    const node = this.map.get(key);
    if (node === void 0)
      return false;
    this.unlink(node);
    this.map.delete(key);
    return true;
  }
  clear() {
    this.map.clear();
    this.head = null;
    this.tail = null;
  }
  /** Least-recently-used first: restoring with `set` keeps recency order. */
  *entriesLeastRecentFirst() {
    for (let node = this.tail; node !== null; node = node.prev)
      yield [node.key, node.value];
  }
  touch(node) {
    if (this.head === node)
      return;
    this.unlink(node);
    node.next = this.head;
    if (this.head !== null)
      this.head.prev = node;
    this.head = node;
    this.tail ??= node;
  }
  unlink(node) {
    if (node.prev !== null)
      node.prev.next = node.next;
    else
      this.head = node.next;
    if (node.next !== null)
      node.next.prev = node.prev;
    else
      this.tail = node.prev;
    node.prev = null;
    node.next = null;
  }
};

// packages/core/dist/registry.js
var MemoryIntentStore = class {
  lru;
  constructor(capacity = 1e6) {
    this.lru = new LruMap(capacity);
  }
  get(id) {
    return this.lru.peek(id);
  }
  put(r) {
    this.lru.set(r.intent.intentId, r);
  }
  delete(id) {
    this.lru.delete(id);
  }
  entries() {
    return this.lru.entriesLeastRecentFirst();
  }
  get size() {
    return this.lru.size;
  }
};
var IntentRegistry = class {
  keyring;
  store;
  reservations;
  constructor(keyring, store = new MemoryIntentStore(), reservationCapacity = 1e6) {
    this.keyring = keyring;
    this.store = store;
    this.reservations = new LruMap(reservationCapacity);
  }
  /** Register a signed intent. Verifies the signature on receipt. */
  register(intent2, nowMs) {
    const problem = intentShapeProblem(intent2);
    if (problem !== null)
      return { accepted: false, reason: problem };
    const i = intent2;
    const existing = this.store.get(i.intentId);
    const v = this.keyring.verify(i, nowMs);
    if (existing !== void 0 && existing.verification === "ok") {
      return existing.intent.signature === i.signature ? { accepted: true, intentId: i.intentId } : { accepted: false, reason: "intentId already registered with a different signature" };
    }
    const record = {
      intent: i,
      uses: 0,
      usedPaise: 0,
      verifiedGen: this.keyring.generation,
      verification: v.ok ? "ok" : v.reason
    };
    this.store.put(record);
    return v.ok ? { accepted: true, intentId: i.intentId } : { accepted: false, reason: `signature rejected: ${v.reason}` };
  }
  get(intentId) {
    return this.store.get(intentId);
  }
  /** Bind a payout to its intent. Pure read — consumption happens in `reserve`. */
  check(p, required) {
    if (p.intentId === void 0 || p.intentId === "") {
      return required ? { status: "missing", required, detail: "no intentId on payout" } : { status: "not-required", required };
    }
    const rec = this.store.get(p.intentId);
    if (rec === void 0)
      return { status: "missing", required: true, detail: "intentId not registered" };
    if (rec.verifiedGen !== this.keyring.generation) {
      const v = this.keyring.verify(rec.intent, p.timestampMs);
      rec.verification = v.ok ? "ok" : v.reason;
      rec.verifiedGen = this.keyring.generation;
    }
    const i = rec.intent;
    const base = {
      required: true,
      intentKind: i.kind,
      issuer: i.issuer,
      maxAmountPaise: i.maxAmountPaise,
      remainingPaise: Math.max(0, i.maxAmountPaise - rec.usedPaise),
      uses: rec.uses,
      maxUses: i.maxUses,
      ...i.subjectRef !== void 0 ? { subjectRef: i.subjectRef } : {}
    };
    if (rec.verification !== "ok")
      return { ...base, status: "bad-signature", detail: rec.verification };
    if (i.kind !== p.kind)
      return { ...base, status: "kind-mismatch", detail: `intent ${i.kind}, payout ${p.kind}` };
    if (p.timestampMs < i.notBeforeMs || p.timestampMs > i.expiresAtMs)
      return { ...base, status: "expired" };
    if (i.beneficiaryRef !== p.beneficiaryRef)
      return { ...base, status: "beneficiary-mismatch" };
    const held = this.reservations.get(p.payoutId);
    if (held !== void 0 && held.intentId !== p.intentId)
      return { ...base, status: "reused", detail: "payoutId already bound to another intent" };
    if (rec.uses >= i.maxUses && held === void 0)
      return { ...base, status: "reused" };
    if (p.amountPaise > base.remainingPaise)
      return { ...base, status: "amount-exceeds" };
    return { ...base, status: "ok" };
  }
  /** Consume one use for a payout that is going ahead. Idempotent per payoutId. */
  reserve(intentId, payoutId, amountPaise, sourceKeyId) {
    if (this.reservations.has(payoutId))
      return;
    const rec = this.store.get(intentId);
    if (rec === void 0)
      return;
    rec.uses += 1;
    rec.usedPaise += amountPaise;
    this.store.put(rec);
    this.reservations.set(payoutId, { intentId, amountPaise, ...sourceKeyId !== void 0 ? { sourceKeyId } : {} });
  }
  /**
   * A payout failed or was reversed: give the use and amount back.
   * `denied` when another key holds the reservation (an unkeyed caller may
   * never touch a bound one) or when it was already settled — a settled
   * payout cannot become failed.
   */
  release(payoutId, sourceKeyId) {
    const r = this.reservations.get(payoutId);
    if (r === void 0)
      return "unknown";
    if (r.sourceKeyId !== void 0 && r.sourceKeyId !== sourceKeyId)
      return "denied";
    if (r.settled === true)
      return "denied";
    this.reservations.delete(payoutId);
    const rec = this.store.get(r.intentId);
    if (rec === void 0)
      return "released";
    rec.uses = Math.max(0, rec.uses - 1);
    rec.usedPaise = Math.max(0, rec.usedPaise - r.amountPaise);
    this.store.put(rec);
    return "released";
  }
  /**
   * Settled: the reservation is final but the payoutId→intent binding is
   * kept as a tombstone — deleting it would let the same payoutId consume a
   * fresh intent once dedupe is evicted or lost on restart. Idempotent
   * retries still report `settled`. `denied` on a foreign or unkeyed caller.
   */
  settle(payoutId, sourceKeyId) {
    const r = this.reservations.get(payoutId);
    if (r === void 0)
      return "unknown";
    if (r.sourceKeyId !== void 0 && r.sourceKeyId !== sourceKeyId)
      return "denied";
    if (r.settled === true)
      return "settled";
    this.reservations.set(payoutId, { ...r, settled: true });
    return "settled";
  }
  exportState() {
    return {
      intents: [...this.store.entries()].map(([, r]) => ({ intent: r.intent, uses: r.uses, usedPaise: r.usedPaise })),
      reservations: [...this.reservations.entriesLeastRecentFirst()]
    };
  }
  restoreState(state) {
    const s = state;
    for (const row of s.intents ?? []) {
      const v = this.keyring.verify(row.intent, Date.now());
      this.store.put({
        intent: row.intent,
        uses: row.uses,
        usedPaise: row.usedPaise,
        verifiedGen: this.keyring.generation,
        verification: v.ok ? "ok" : v.reason
      });
    }
    for (const [k, v] of s.reservations ?? [])
      this.reservations.set(k, v);
  }
};

// packages/core/dist/ledger.js
init_buffer();
var BeneficiaryLedger = class {
  lru;
  constructor(capacity = 1e6) {
    this.lru = new LruMap(capacity);
  }
  get(ref2) {
    return this.lru.peek(ref2);
  }
  set(ref2, e) {
    this.lru.set(ref2, e);
  }
  get size() {
    return this.lru.size;
  }
  get evicted() {
    return this.lru.evictedCount;
  }
  exportState() {
    return [...this.lru.entriesLeastRecentFirst()];
  }
  restoreState(rows) {
    for (const [k, v] of rows)
      this.lru.set(k, v);
  }
};
var MerchantLedger = class {
  lru;
  constructor(capacity = 2e5) {
    this.lru = new LruMap(capacity);
  }
  get(merchantId) {
    return this.lru.peek(merchantId);
  }
  /** Record the account a merchant settles to; detects changes. */
  observe(merchantId, beneficiaryRef, atMs) {
    const prev = this.lru.peek(merchantId);
    if (prev === void 0)
      this.lru.set(merchantId, { beneficiaryRef });
    else if (prev.beneficiaryRef !== beneficiaryRef)
      this.lru.set(merchantId, { beneficiaryRef, changedAtMs: atMs, previousRef: prev.beneficiaryRef });
  }
  /** Explicit change notice from the merchant-onboarding system (the best signal). */
  noteAccountChange(merchantId, beneficiaryRef, atMs) {
    const prev = this.lru.peek(merchantId);
    this.lru.set(merchantId, {
      beneficiaryRef,
      changedAtMs: atMs,
      ...prev !== void 0 ? { previousRef: prev.beneficiaryRef } : {}
    });
  }
  exportState() {
    return [...this.lru.entriesLeastRecentFirst()];
  }
  restoreState(rows) {
    for (const [k, v] of rows)
      this.lru.set(k, v);
  }
};
var CanaryRegistry = class {
  beneficiaryRefs = /* @__PURE__ */ new Set();
  sourceKeyIds = /* @__PURE__ */ new Set();
  intentIds = /* @__PURE__ */ new Set();
  add(c) {
    let n = 0;
    for (const r of c.beneficiaryRefs ?? [])
      if (!this.beneficiaryRefs.has(r)) {
        this.beneficiaryRefs.add(r);
        n++;
      }
    for (const r of c.sourceKeyIds ?? [])
      if (!this.sourceKeyIds.has(r)) {
        this.sourceKeyIds.add(r);
        n++;
      }
    for (const r of c.intentIds ?? [])
      if (!this.intentIds.has(r)) {
        this.intentIds.add(r);
        n++;
      }
    return n;
  }
  get size() {
    return this.beneficiaryRefs.size + this.sourceKeyIds.size + this.intentIds.size;
  }
  exportState() {
    return { beneficiaryRefs: [...this.beneficiaryRefs], sourceKeyIds: [...this.sourceKeyIds], intentIds: [...this.intentIds] };
  }
};

// packages/core/dist/calendar.js
init_buffer();

// packages/core/dist/ist.js
init_buffer();
var IST_OFFSET_MS = 5.5 * 36e5;
function istParts(epochMs) {
  const d = new Date(epochMs + IST_OFFSET_MS);
  const date = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  return { date, dayOfWeek: d.getUTCDay(), hour: d.getUTCHours(), minute: d.getUTCMinutes() };
}
function istToEpochMs(year, month, day, hour = 0, minute = 0, second = 0) {
  return Date.UTC(year, month - 1, day, hour, minute, second) - IST_OFFSET_MS;
}
function formatIst(epochMs) {
  const d = new Date(epochMs + IST_OFFSET_MS);
  return `${d.toISOString().slice(0, 19).replace("T", " ")} IST`;
}

// packages/core/dist/calendar.js
var DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
var Calendar = class {
  holidays;
  weekendDays;
  hours;
  constructor(cfg = {}) {
    this.holidays = new Map((cfg.holidays ?? []).map((h) => [h.date, h.name]));
    this.weekendDays = new Set(cfg.weekendDays ?? [0, 6]);
    this.hours = cfg.lowCoverageHours === void 0 ? { from: 23, to: 6 } : cfg.lowCoverageHours;
  }
  window(epochMs) {
    const p = istParts(epochMs);
    const holiday = this.holidays.get(p.date);
    if (holiday !== void 0)
      return { kind: "holiday", label: holiday, istDate: p.date, istHour: p.hour };
    if (this.weekendDays.has(p.dayOfWeek))
      return { kind: "weekend", label: DAY_NAMES[p.dayOfWeek], istDate: p.date, istHour: p.hour };
    if (this.hours !== null) {
      const { from, to } = this.hours;
      const inNight = from > to ? p.hour >= from || p.hour < to : p.hour >= from && p.hour < to;
      if (inNight)
        return { kind: "night", label: `${String(from).padStart(2, "0")}:00\u2013${String(to).padStart(2, "0")}:00 IST`, istDate: p.date, istHour: p.hour };
    }
    return null;
  }
};

// packages/core/dist/ring.js
init_buffer();
var TimeRing = class _TimeRing {
  capacity;
  ts;
  amt;
  head = 0;
  count = 0;
  constructor(capacity) {
    this.capacity = capacity;
    this.ts = new Float64Array(capacity);
    this.amt = new Float64Array(capacity);
  }
  get length() {
    return this.count;
  }
  push(tsMs, amount) {
    this.ts[this.head] = tsMs;
    this.amt[this.head] = amount;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity)
      this.count += 1;
  }
  /** Count and sum of entries with `fromMs < ts <= toMs`. */
  window(fromMs, toMs) {
    let count = 0;
    let sum = 0;
    for (let i = 0; i < this.count; i++) {
      const t = this.ts[i];
      if (t > fromMs && t <= toMs) {
        count += 1;
        sum += this.amt[i];
      }
    }
    return { count, sum };
  }
  /** Amounts in insertion order, oldest first. */
  values() {
    const out = [];
    const start = this.count < this.capacity ? 0 : this.head;
    for (let i = 0; i < this.count; i++)
      out.push(this.amt[(start + i) % this.capacity]);
    return out;
  }
  toJSON() {
    const out = [];
    const start = this.count < this.capacity ? 0 : this.head;
    for (let i = 0; i < this.count; i++) {
      const j = (start + i) % this.capacity;
      out.push([this.ts[j], this.amt[j]]);
    }
    return out;
  }
  static from(capacity, rows) {
    const r = new _TimeRing(capacity);
    for (const [t, a] of rows)
      r.push(t, a);
    return r;
  }
};

// packages/core/dist/firewall.js
init_buffer();
var DEFAULT_MULTIPLIERS = {
  NORMAL: { velocity: 1, coolingAmount: 1 },
  HOLIDAY: { velocity: 0.5, coolingAmount: 0.5 },
  HIGH_ALERT: { velocity: 0.25, coolingAmount: 0.25 }
};
var isStr2 = (v, max = 256) => typeof v === "string" && v.length > 0 && v.length <= max;
var MODES = ["shadow", "advise", "enforce"];
var posInt = (v, name, min = 1) => {
  if (v !== void 0 && (!Number.isSafeInteger(v) || v < min))
    throw new TypeError(`firewall config ${name} must be an integer \u2265 ${min}`);
};
function validateFirewallConfig(cfg) {
  if (cfg.mode !== void 0 && !MODES.includes(cfg.mode))
    throw new TypeError(`firewall config mode must be shadow, advise or enforce (got ${String(cfg.mode)})`);
  for (const [table, name] of [[cfg.modeByKind, "modeByKind"], [cfg.requireIntent, "requireIntent"]]) {
    for (const k of Object.keys(table ?? {})) {
      if (!INTENT_KINDS.includes(k))
        throw new TypeError(`firewall config ${name}.${k}: not a known IntentKind \u2014 a typo silently disables the rule`);
    }
  }
  for (const v of Object.values(cfg.modeByKind ?? {})) {
    if (!MODES.includes(v))
      throw new TypeError(`firewall config modeByKind value must be shadow, advise or enforce (got ${String(v)})`);
  }
  for (const [state, m] of Object.entries(cfg.multipliers ?? {})) {
    if (!(state in DEFAULT_MULTIPLIERS))
      throw new TypeError(`firewall config multipliers.${state}: not a known alert state`);
    for (const [k, v] of Object.entries(m ?? {})) {
      if (typeof v !== "number" || !Number.isFinite(v) || v <= 0)
        throw new TypeError(`firewall config multipliers.${state}.${k} must be a positive finite number`);
    }
  }
  if (cfg.highAlertOnBlocks !== void 0) {
    posInt(cfg.highAlertOnBlocks.count, "highAlertOnBlocks.count", 0);
    posInt(cfg.highAlertOnBlocks.windowMs, "highAlertOnBlocks.windowMs");
  }
  posInt(cfg.microPaise, "microPaise");
  posInt(cfg.dedupeCapacity, "dedupeCapacity");
  posInt(cfg.ledgerCapacity, "ledgerCapacity");
  posInt(cfg.maxTimestampSkewMs, "maxTimestampSkewMs");
  if (cfg.adminTokenSha256 !== void 0 && !/^[0-9a-f]{64}$/i.test(cfg.adminTokenSha256))
    throw new TypeError("firewall config adminTokenSha256 must be a SHA-256 hex string");
}
function payoutShapeProblem(x) {
  if (typeof x !== "object" || x === null)
    return "payout must be an object";
  const p = x;
  if (!isStr2(p["payoutId"], 128))
    return "payoutId";
  if (!INTENT_KINDS.includes(p["kind"]))
    return "kind";
  if (p["intentId"] !== void 0 && typeof p["intentId"] !== "string")
    return "intentId";
  if (!Number.isSafeInteger(p["amountPaise"]) || p["amountPaise"] <= 0)
    return "amountPaise (positive integer paise)";
  if (!isStr2(p["beneficiaryRef"]))
    return "beneficiaryRef";
  if (looksLikeRawIdentifier(p["beneficiaryRef"]))
    return "beneficiaryRef looks raw (hash it)";
  if (p["beneficiaryMobileRef"] !== void 0 && (!isStr2(p["beneficiaryMobileRef"]) || looksLikeRawIdentifier(p["beneficiaryMobileRef"])))
    return "beneficiaryMobileRef";
  if (!CHANNELS.includes(p["channel"]))
    return "channel";
  if (!isStr2(p["sourceKeyId"], 128))
    return "sourceKeyId";
  if (p["origin"] !== "prod" && p["origin"] !== "nonprod" && p["origin"] !== "unknown")
    return "origin";
  if (p["merchantId"] !== void 0 && !isStr2(p["merchantId"], 128))
    return "merchantId";
  if (p["clientAttested"] !== void 0 && typeof p["clientAttested"] !== "boolean")
    return "clientAttested";
  if (p["riskScore"] !== void 0 && (typeof p["riskScore"] !== "number" || !Number.isFinite(p["riskScore"]) || p["riskScore"] < 0 || p["riskScore"] > 1))
    return "riskScore (number 0..1)";
  if (p["externalVerdict"] !== void 0 && !isStr2(p["externalVerdict"], 64))
    return "externalVerdict";
  if (p["externalSource"] !== void 0 && !isStr2(p["externalSource"], 64))
    return "externalSource";
  if (!Number.isSafeInteger(p["timestampMs"]) || p["timestampMs"] <= 0)
    return "timestampMs";
  return null;
}
var sha256 = (s) => createHash("sha256").update(s).digest();
var Payrekha = class {
  keyring;
  intents;
  beneficiaries;
  merchants = new MerchantLedger();
  canaries = new CanaryRegistry();
  calendar;
  engine;
  cfg;
  opts;
  multipliers;
  mode;
  modeByKind;
  highAlert = null;
  recentBlocks = [];
  dedupe = /* @__PURE__ */ new Map();
  dedupeCap;
  audit = [];
  seq = 0;
  dedupedCount = 0;
  hookErrors = 0;
  effective = { ALLOW: 0, HOLD: 0, DECLINE: 0 };
  constructor(rules, options = {}) {
    this.opts = options;
    this.cfg = options.config ?? {};
    validateFirewallConfig(this.cfg);
    this.keyring = options.keyring ?? new Keyring(options.keys ?? []);
    this.intents = new IntentRegistry(this.keyring, options.intentStore ?? new MemoryIntentStore());
    this.beneficiaries = new BeneficiaryLedger(this.cfg.ledgerCapacity);
    this.calendar = new Calendar(this.cfg.calendar);
    this.mode = this.cfg.mode ?? "shadow";
    this.modeByKind = { ...this.cfg.modeByKind ?? {} };
    this.dedupeCap = this.cfg.dedupeCapacity ?? 1e4;
    const m = this.cfg.multipliers ?? {};
    this.multipliers = {
      NORMAL: { ...DEFAULT_MULTIPLIERS.NORMAL, ...m.NORMAL },
      HOLIDAY: { ...DEFAULT_MULTIPLIERS.HOLIDAY, ...m.HOLIDAY },
      HIGH_ALERT: { ...DEFAULT_MULTIPLIERS.HIGH_ALERT, ...m.HIGH_ALERT }
    };
    this.engine = new Engine(rules, {
      validate: payoutShapeProblem,
      ...options.onRuleError !== void 0 ? { onRuleError: options.onRuleError } : {}
    });
  }
  // ---------------------------------------------------------------- verdicts
  evaluate(payout) {
    const dedupeKey = typeof payout?.payoutId === "string" ? `${String(payout?.sourceKeyId ?? "")}
${payout.payoutId}` : void 0;
    const cached = dedupeKey !== void 0 ? this.dedupe.get(dedupeKey) : void 0;
    if (cached !== void 0) {
      this.dedupedCount += 1;
      const mode2 = (payout?.kind !== void 0 ? this.modeByKind[payout.kind] : void 0) ?? this.mode;
      const effectiveAction2 = mode2 === "shadow" ? "ALLOW" : cached.verdict === Verdict.Block ? "DECLINE" : cached.verdict === Verdict.Review ? "HOLD" : "ALLOW";
      this.effective[effectiveAction2] += 1;
      return { ...cached, mode: mode2, effectiveAction: effectiveAction2, deduped: true };
    }
    const ts = Number.isSafeInteger(payout?.timestampMs) ? payout.timestampMs : 0;
    const nowMs = this.now();
    const clientTs = payout?.clientTimestampMs;
    const claimMs = typeof clientTs === "number" && Number.isSafeInteger(clientTs) ? clientTs : ts;
    const skewMs = this.cfg.maxTimestampSkewMs;
    const skewed = skewMs !== void 0 && claimMs > 0 && Math.abs(nowMs - claimMs) > skewMs;
    const evalPayout = skewed ? { ...payout, timestampMs: nowMs } : payout;
    const evalTs = skewed ? nowMs : ts;
    const calendarWindow = evalTs > 0 ? this.calendar.window(evalTs) : null;
    const alertState = this.highAlert !== null ? "HIGH_ALERT" : calendarWindow !== null ? "HOLIDAY" : "NORMAL";
    const wellFormed = payoutShapeProblem(evalPayout) === null;
    const required = alertState === "HIGH_ALERT" || wellFormed && this.cfg.requireIntent?.[evalPayout.kind] !== false;
    const ctx = {
      nowMs: evalTs,
      alertState,
      multipliers: this.multipliers[alertState],
      calendarWindow,
      intent: wellFormed ? this.intents.check(evalPayout, required) : { status: "missing", required },
      beneficiary: wellFormed ? this.beneficiaries.get(evalPayout.beneficiaryRef) : void 0,
      merchant: wellFormed && evalPayout.merchantId !== void 0 ? this.merchants.get(evalPayout.merchantId) : void 0,
      canaries: this.canaries,
      microPaise: this.cfg.microPaise ?? 1e3
    };
    let ev = this.engine.evaluate(evalPayout, ctx);
    if (skewed && skewMs !== void 0) {
      const offsetMs = Math.abs(nowMs - claimMs);
      ev = {
        ...ev,
        hits: [
          ...ev.hits,
          {
            rule: "time.skew",
            verdict: Verdict.Review,
            reason: `Payout's claimed timestamp is ${Math.round(offsetMs / 6e4)} min off firewall time (allowed \xB1${Math.round(skewMs / 6e4)} min); evaluated at firewall time`,
            evidence: { offsetMs, boundMs: skewMs, clientTimestampMs: claimMs }
          }
        ],
        verdict: severity(ev.verdict) >= severity(Verdict.Review) ? ev.verdict : Verdict.Review,
        degraded: true
      };
    }
    const kind = wellFormed ? evalPayout.kind : void 0;
    const mode = (kind !== void 0 ? this.modeByKind[kind] : void 0) ?? this.mode;
    const effectiveAction = mode === "shadow" ? "ALLOW" : ev.verdict === Verdict.Block ? "DECLINE" : ev.verdict === Verdict.Review ? "HOLD" : "ALLOW";
    this.effective[effectiveAction] += 1;
    for (const h of ev.hits) {
      if (h.raiseAlert === "HIGH_ALERT")
        this.enterHighAlert(`rule:${h.rule}`, h.reason, evalTs);
    }
    if (ev.verdict === Verdict.Block)
      this.countBlock(evalTs);
    if (wellFormed)
      this.remember(evalPayout, ctx, effectiveAction);
    this.seq += 1;
    const decisionId = `pd_${createHash("sha256").update(`${String(payout?.payoutId)}|${evalTs}|${this.seq}`).digest("base64url").slice(0, 22)}`;
    const verdict = {
      ...ev,
      decisionId,
      payoutId: String(payout?.payoutId ?? ""),
      mode,
      alertState,
      effectiveAction,
      deduped: false,
      // Analyst-facing score: strongest hit normalized (BLOCK→1.0, REVIEW→0.5),
      // +0.1 when coverage was incomplete. Deterministic — not an ML confidence.
      riskScore: Math.min(1, ev.hits.reduce((m, h) => Math.max(m, severity(h.verdict) / 2), 0) + (ev.degraded ? 0.1 : 0))
    };
    if (dedupeKey !== void 0) {
      this.dedupe.set(dedupeKey, verdict);
      if (this.dedupe.size > this.dedupeCap)
        this.dedupe.delete(this.dedupe.keys().next().value);
    }
    if (this.opts.onDecision !== void 0) {
      try {
        this.opts.onDecision(verdict, payout);
      } catch {
        this.hookErrors += 1;
      }
    }
    return verdict;
  }
  /** Post-verdict bookkeeping: ledger, merchant accounts, intent consumption. */
  remember(p, ctx, action) {
    const prev = ctx.beneficiary;
    const verifiedHere = p.kind === "VERIFICATION" && ctx.intent.status === "ok" && ctx.intent.subjectRef !== void 0;
    let entry = prev ?? { firstSeenMs: p.timestampMs };
    if (p.amountPaise <= ctx.microPaise) {
      entry = {
        ...entry,
        lastMicro: {
          atMs: p.timestampMs,
          amountPaise: p.amountPaise,
          ...verifiedHere ? { verifiedSubject: ctx.intent.subjectRef } : {}
        }
      };
    }
    if (verifiedHere) {
      const subjects = entry.verifiedSubjects ?? [];
      if (!subjects.includes(ctx.intent.subjectRef))
        entry = { ...entry, verifiedSubjects: [...subjects, ctx.intent.subjectRef].slice(-8) };
    }
    this.beneficiaries.set(p.beneficiaryRef, entry);
    if (p.kind === "PA_SETTLEMENT" && p.merchantId !== void 0)
      this.merchants.observe(p.merchantId, p.beneficiaryRef, p.timestampMs);
    if (action !== "DECLINE" && ctx.intent.status === "ok" && p.intentId !== void 0) {
      this.intents.reserve(p.intentId, p.payoutId, p.amountPaise, p.sourceKeyId);
    }
  }
  countBlock(ts) {
    const rule = this.cfg.highAlertOnBlocks ?? { count: 5, windowMs: 10 * 6e4 };
    if (rule.count <= 0)
      return;
    this.recentBlocks.push(ts);
    while (this.recentBlocks.length > 0 && this.recentBlocks[0] <= ts - rule.windowMs)
      this.recentBlocks.shift();
    if (this.recentBlocks.length > rule.count)
      this.recentBlocks.shift();
    if (this.highAlert === null && this.recentBlocks.length >= rule.count) {
      this.enterHighAlert("engine:block-burst", `${rule.count} BLOCK verdicts within ${Math.round(rule.windowMs / 6e4)} min`, ts);
    }
  }
  /**
   * Final payout status, so intent uses and baselines stay accurate. When
   * `sourceKeyId` is given, only the key that consumed the intent may report
   * on it — a `failed`/`reversed` report frees the intent for reuse, so it
   * is a money-lever and every release is audited.
   */
  reportOutcome(payoutId, outcome, sourceKeyId) {
    const r = outcome === "settled" ? this.intents.settle(payoutId, sourceKeyId) : this.intents.release(payoutId, sourceKeyId);
    if (r === "denied")
      this.record({ atMs: this.now(), action: "outcome.denied", actor: sourceKeyId ?? "unknown", reason: `${outcome} reported for ${payoutId}` });
    else if (r === "released" || r === "settled")
      this.record({ atMs: this.now(), action: `outcome.${outcome}`, actor: sourceKeyId ?? "in-process", reason: payoutId });
    return r === "released" || r === "settled";
  }
  registerIntent(intent2, nowMs = this.now()) {
    return this.intents.register(intent2, nowMs);
  }
  /** The in-memory audit ring (last 1000 entries, oldest first) — for the read-only analyst API and consoles. */
  get auditEntries() {
    return this.audit;
  }
  /**
   * Build, sign and register an intent in one call — the managed-intents
   * tier (gateway holds the signing key). The caller's system never touches
   * canonical JSON or key management; the trade-off is that this host can
   * mint, so prefer externally-signed intents in enforce mode.
   * `intentId` is derived from the signed fields when omitted, so a retried
   * mint is idempotent.
   */
  mintIntent(spec, actor, nowMs = this.now()) {
    const issuer = this.keyring.list().find((k) => k.keyId === spec.keyId);
    if (issuer === void 0)
      return { accepted: false, reason: `unknown signing keyId '${spec.keyId}'` };
    const unsigned = {
      kind: spec.kind,
      maxAmountPaise: spec.maxAmountPaise,
      beneficiaryRef: spec.beneficiaryRef,
      ...spec.subjectRef !== void 0 ? { subjectRef: spec.subjectRef } : {},
      maxUses: spec.maxUses ?? 1,
      notBeforeMs: spec.notBeforeMs ?? nowMs,
      expiresAtMs: spec.expiresAtMs ?? nowMs + (spec.ttlMs ?? 3e5),
      issuer: issuer.issuer,
      keyId: spec.keyId,
      intentId: ""
    };
    const intentId = spec.intentId ?? `mint-${createHash("sha256").update(intentSigningPayload(unsigned)).digest("base64url").slice(0, 32)}`;
    const intent2 = signIntent({ ...unsigned, intentId }, spec.key);
    const res = this.intents.register(intent2, nowMs);
    if (res.accepted)
      this.record({ atMs: nowMs, action: "intent.minted", actor, reason: `${intentId} ${spec.kind} \u20B9${spec.maxAmountPaise / 100} via ${spec.keyId}` });
    return { ...res, intentId };
  }
  // ----------------------------------------------------------- state & audit
  get alertState() {
    return this.highAlert !== null ? "HIGH_ALERT" : "NORMAL";
  }
  /** Alert state that would apply at `atMs` (includes the calendar). */
  alertStateAt(atMs) {
    return this.highAlert !== null ? "HIGH_ALERT" : this.calendar.window(atMs) !== null ? "HOLIDAY" : "NORMAL";
  }
  get highAlertInfo() {
    return this.highAlert;
  }
  get currentMode() {
    return { mode: this.mode, modeByKind: { ...this.modeByKind } };
  }
  /** Raising the alert needs no credential: anyone may pull the alarm. */
  raiseHighAlert(actor, reason) {
    this.enterHighAlert(actor, reason, this.now());
  }
  enterHighAlert(actor, reason, atMs) {
    if (this.highAlert !== null)
      return;
    this.highAlert = { since: atMs, reason };
    const e = this.record({ atMs: this.now(), action: "alert.enter", actor, reason, from: "NORMAL", to: "HIGH_ALERT" });
    this.fireAlertChange("NORMAL", "HIGH_ALERT", e);
  }
  /**
   * Clear HIGH_ALERT. Never automatic: the advisory says assume persistence.
   * Needs the admin token; every attempt (good or bad) is audited.
   */
  resetHighAlert(cred) {
    this.authorize(cred, "alert.reset");
    if (this.highAlert === null)
      return;
    this.highAlert = null;
    this.recentBlocks.length = 0;
    const e = this.record({ atMs: this.now(), action: "alert.reset", actor: cred.actor, reason: cred.reason, from: "HIGH_ALERT", to: "NORMAL" });
    this.fireAlertChange("HIGH_ALERT", "NORMAL", e);
  }
  /** Change the mode globally or for one kind. Admin only, audited. */
  setMode(mode, cred, kind) {
    if (mode !== "shadow" && mode !== "advise" && mode !== "enforce")
      throw new TypeError("mode must be shadow, advise or enforce");
    this.authorize(cred, "mode.set");
    const from = kind !== void 0 ? this.modeByKind[kind] ?? this.mode : this.mode;
    if (kind !== void 0)
      this.modeByKind[kind] = mode;
    else
      this.mode = mode;
    this.record({ atMs: this.now(), action: kind !== void 0 ? `mode.set:${kind}` : "mode.set", actor: cred.actor, reason: cred.reason, from, to: mode });
  }
  addCanaries(c, cred) {
    this.authorize(cred, "canary.add");
    const n = this.canaries.add(c);
    this.record({ atMs: this.now(), action: "canary.add", actor: cred.actor, reason: cred.reason, to: String(n) });
    return n;
  }
  /**
   * Revoke an issuer signing key without a redeploy — the incident response
   * to a compromised LOS/settlement key. Every intent it signed fails
   * verification on the next evaluation (generation bump). The revocation is
   * carried in the snapshot so a restart cannot silently un-revoke; keyIds
   * are tombstones and must never be reused for a new key. Admin + audited.
   */
  revokeIssuerKey(keyId, cred) {
    this.authorize(cred, "key.revoke");
    const ok = this.keyring.revoke(keyId);
    this.record({ atMs: this.now(), action: ok ? "key.revoked" : "key.revoke.unknown", actor: cred.actor, reason: cred.reason, to: keyId });
    return ok;
  }
  /** Explicit notice from the merchant-onboarding system that a settlement account changed. */
  noteMerchantAccountChange(merchantId, beneficiaryRef, atMs) {
    if (looksLikeRawIdentifier(beneficiaryRef))
      throw new TypeError("beneficiaryRef looks raw; hash it first");
    this.merchants.noteAccountChange(merchantId, beneficiaryRef, atMs);
  }
  auditTrail() {
    return this.audit.slice();
  }
  authorize(cred, action) {
    const expected = this.cfg.adminTokenSha256;
    const ok = expected !== void 0 && /^[0-9a-f]{64}$/i.test(expected) && typeof cred.adminToken === "string" && timingSafeEqual(sha256(cred.adminToken), import_buffer.Buffer.from(expected, "hex"));
    if (!ok) {
      this.record({ atMs: this.now(), action: `${action}.denied`, actor: cred.actor, reason: cred.reason });
      throw new AuthorizationError(expected === void 0 ? "no admin credential configured" : "admin token rejected");
    }
  }
  record(e) {
    this.audit.push(e);
    if (this.audit.length > 1e3)
      this.audit.shift();
    try {
      this.opts.onAudit?.(e);
    } catch {
      this.hookErrors += 1;
    }
    return e;
  }
  fireAlertChange(from, to, e) {
    try {
      this.opts.onAlertChange?.(from, to, e);
    } catch {
      this.hookErrors += 1;
    }
  }
  now() {
    return this.opts.now?.() ?? Date.now();
  }
  // ------------------------------------------------------------ observability
  get metrics() {
    return {
      ...this.engine.metrics,
      deduped: this.dedupedCount,
      hookErrors: this.hookErrors,
      effective: { ...this.effective },
      intents: this.intents.store.size,
      beneficiaries: this.beneficiaries.size,
      canaries: this.canaries.size,
      highAlert: this.highAlert !== null
    };
  }
  get ruleNames() {
    return this.engine.ruleNames;
  }
  replaceRules(rules) {
    this.engine.replaceRules(rules);
  }
  // ------------------------------------------------------------- persistence
  exportState() {
    return {
      version: 1,
      exportedAtMs: this.now(),
      highAlert: this.highAlert,
      mode: this.mode,
      modeByKind: { ...this.modeByKind },
      intents: this.intents.exportState(),
      beneficiaries: this.beneficiaries.exportState(),
      merchants: this.merchants.exportState(),
      canaries: this.canaries.exportState(),
      rules: this.engine.exportState(),
      audit: this.audit.slice(-200),
      issuers: { revoked: this.keyring.list().flatMap((k) => k.revoked === true ? [k.keyId] : []) },
      recentBlocks: [...this.recentBlocks]
    };
  }
  /**
   * Restore a snapshot. HIGH_ALERT survives restarts — a reboot must not
   * be a way to clear it. Mode is NOT restored from the snapshot: config
   * is the source of truth, so a tampered state file cannot flip enforce
   * back to shadow.
   */
  restoreState(s) {
    if (s.version !== 1)
      throw new TypeError(`unsupported snapshot version ${String(s.version)}`);
    if (s.highAlert !== null)
      this.highAlert = { ...s.highAlert };
    this.intents.restoreState(s.intents);
    this.beneficiaries.restoreState(s.beneficiaries ?? []);
    this.merchants.restoreState(s.merchants ?? []);
    this.canaries.add(s.canaries ?? {});
    this.engine.restoreState(s.rules ?? {});
    for (const keyId of s.issuers?.revoked ?? [])
      this.keyring.revoke(keyId);
    for (const t of s.recentBlocks ?? [])
      if (typeof t === "number" && Number.isFinite(t))
        this.recentBlocks.push(t);
    for (const e of s.audit ?? [])
      this.audit.push(e);
  }
};
var AuthorizationError = class extends Error {
  name = "AuthorizationError";
};

// packages/rules/dist/index.js
init_buffer();

// packages/rules/dist/behaviour.js
init_buffer();

// packages/rules/dist/util.js
init_buffer();
var hit = (rule, verdict, reason, evidence, raiseAlert) => raiseAlert !== void 0 ? { rule, verdict, reason, evidence, raiseAlert } : { rule, verdict, reason, evidence };
var rupees = (paise) => {
  const r = Math.floor(paise / 100);
  const p = paise % 100;
  return `\u20B9${r.toLocaleString("en-IN")}${p !== 0 ? `.${String(p).padStart(2, "0")}` : ""}`;
};

// packages/rules/dist/behaviour.js
function probeRule(o = {}) {
  const windowMs = o.windowMs ?? 24 * 36e5;
  const largePaise = o.largePaise ?? 1e6;
  const largeMultiple = o.largeMultiple ?? 100;
  return {
    name: "probe.micro-then-large",
    evaluate(p, ctx) {
      const micro = ctx.beneficiary?.lastMicro;
      if (micro === void 0 || p.amountPaise <= ctx.microPaise)
        return null;
      const age = p.timestampMs - micro.atMs;
      if (age < 0 || age > windowMs)
        return null;
      if (p.amountPaise < largePaise && p.amountPaise < micro.amountPaise * largeMultiple)
        return null;
      if (micro.verifiedSubject !== void 0 && ctx.intent.status === "ok" && ctx.intent.subjectRef === micro.verifiedSubject)
        return null;
      if (ctx.intent.status === "ok" && ctx.intent.subjectRef !== void 0 && ctx.beneficiary?.verifiedSubjects?.includes(ctx.intent.subjectRef) === true)
        return null;
      const high = ctx.alertState === "HIGH_ALERT";
      return hit("probe.micro-then-large", high ? Verdict.Block : Verdict.Review, `${rupees(micro.amountPaise)} test transfer ${Math.max(1, Math.round(age / 6e4))} min ago, now ${rupees(p.amountPaise)} to the same account` + (micro.verifiedSubject === void 0 ? " (the micro was not a VERIFICATION intent)" : " (verified for a different subject)"), { microPaise: micro.amountPaise, amountPaise: p.amountPaise, minutesSinceMicro: Math.round(age / 6e4), multiple: Math.round(p.amountPaise / micro.amountPaise), alertState: ctx.alertState });
    }
  };
}
function coolingRule(o = {}) {
  const coolingMs = o.coolingMs ?? 30 * 6e4;
  const minPaise = o.minAmountPaise ?? 5e6;
  const exemptBound = o.exemptBoundIntents ?? true;
  return {
    name: "beneficiary.cooling",
    evaluate(p, ctx) {
      const threshold = Math.round(minPaise * ctx.multipliers.coolingAmount);
      if (p.amountPaise < threshold)
        return null;
      const first = ctx.beneficiary?.firstSeenMs ?? p.timestampMs;
      const age = p.timestampMs - first;
      if (age >= coolingMs)
        return null;
      if (ctx.intent.status === "ok" && exemptBound)
        return null;
      const subj = ctx.intent.subjectRef;
      if (ctx.intent.status === "ok" && subj !== void 0 && ctx.beneficiary?.verifiedSubjects?.includes(subj) === true)
        return null;
      return hit("beneficiary.cooling", Verdict.Review, `Beneficiary first seen ${Math.round(age / 6e4)} min ago; ${rupees(p.amountPaise)} is above the ${rupees(threshold)} cooling threshold`, { minutesSinceFirstSeen: Math.round(age / 6e4), coolingMinutes: Math.round(coolingMs / 6e4), thresholdPaise: threshold, amountPaise: p.amountPaise, alertState: ctx.alertState });
    }
  };
}
function velocityRule(o = {}) {
  const windowMs = o.windowMs ?? 10 * 6e4;
  const perKey = o.perSourceKey ?? { count: 20, sumPaise: 5e8 };
  const perMerchant = o.perMerchant ?? { count: 50, sumPaise: 2e9 };
  const global = o.global ?? { count: 500, sumPaise: 1e10 };
  const hardCap = o.hardCapFactor ?? 2;
  const overrides = o.perSourceKeyOverrides ?? {};
  const keyBudget = (id) => Object.hasOwn(overrides, id) ? overrides[id] : perKey;
  const cap = (b) => Math.min(4096, Math.max(64, Math.ceil(b.count * hardCap) + 8));
  const keyRings = new LruMap(o.maxTrackedKeys ?? 1e5);
  const merchantRings = new LruMap(o.maxTrackedKeys ?? 1e5);
  let globalRing = new TimeRing(cap(global));
  const ringFor = (key, b) => {
    const map = key.startsWith("m:") ? merchantRings : keyRings;
    let r = map.get(key);
    if (r === void 0) {
      r = new TimeRing(cap(b));
      map.set(key, r);
    }
    return r;
  };
  const check = (scope, r, b, p, m) => {
    r.push(p.timestampMs, p.amountPaise);
    const w = r.window(p.timestampMs - windowMs, p.timestampMs);
    const count = Math.max(1, Math.floor(b.count * m));
    const sum = Math.max(1, Math.floor(b.sumPaise * m));
    const over = Math.max(w.count / count, w.sum / sum);
    return over > 1 ? { scope, count: w.count, sum: w.sum, budgetCount: count, budgetSum: sum, over } : null;
  };
  return {
    name: "velocity.outflow",
    evaluate(p, ctx) {
      const m = ctx.multipliers.velocity;
      const results = [
        check("sourceKey", ringFor(`k:${p.sourceKeyId}`, keyBudget(p.sourceKeyId)), keyBudget(p.sourceKeyId), p, m),
        p.merchantId !== void 0 ? check("merchant", ringFor(`m:${p.merchantId}`, perMerchant), perMerchant, p, m) : null,
        check("global", globalRing, global, p, m)
      ];
      let worst = null;
      for (const r of results)
        if (r !== null && (worst === null || r.over > worst.over))
          worst = r;
      if (worst === null)
        return null;
      const block = worst.over > hardCap;
      return hit("velocity.outflow", block ? Verdict.Block : Verdict.Review, `${worst.count} payouts / ${rupees(worst.sum)} from this ${worst.scope} in ${Math.round(windowMs / 6e4)} min; budget ${worst.budgetCount} / ${rupees(worst.budgetSum)}` + (m !== 1 ? ` (${ctx.alertState}: \xD7${m})` : "") + (block ? " \u2014 above hard cap" : ""), { scope: worst.scope, count: worst.count, sumPaise: worst.sum, budgetCount: worst.budgetCount, budgetSumPaise: worst.budgetSum, multiplier: m, alertState: ctx.alertState });
    },
    reset() {
      keyRings.clear();
      merchantRings.clear();
      globalRing = new TimeRing(cap(global));
    },
    exportState() {
      return {
        global: globalRing.toJSON(),
        keys: [...keyRings.entriesLeastRecentFirst()].map(([k, r]) => [k, r.toJSON()]),
        merchants: [...merchantRings.entriesLeastRecentFirst()].map(([k, r]) => [k, r.toJSON()])
      };
    },
    restoreState(s) {
      const st = s;
      globalRing = TimeRing.from(cap(global), st.global ?? []);
      for (const [k, rows] of st.keys ?? []) {
        const map = k.startsWith("m:") ? merchantRings : keyRings;
        map.set(k, TimeRing.from(cap(k.startsWith("m:") ? perMerchant : keyBudget(k.slice(2))), rows));
      }
      for (const [k, rows] of st.merchants ?? [])
        merchantRings.set(k, TimeRing.from(cap(perMerchant), rows));
    },
    stats: () => ({ trackedKeys: keyRings.size, trackedMerchants: merchantRings.size, evictedKeys: keyRings.evictedCount + merchantRings.evictedCount })
  };
}
var median = (xs) => {
  const s = xs.slice().sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
function bandRule(o = {}) {
  const size = o.sampleSize ?? 256;
  const minSamples = o.minSamples ?? 50;
  const threshold = o.threshold ?? 8;
  const exclude = new Set(o.excludeKinds ?? ["VERIFICATION"]);
  const bands = /* @__PURE__ */ new Map();
  return {
    name: "amount.band-anomaly",
    evaluate(p) {
      if (exclude.has(p.kind))
        return null;
      const key = `${p.kind}|${p.channel}`;
      let b = bands.get(key);
      if (b === void 0)
        bands.set(key, b = { ring: new TimeRing(size), med: 0, mad: 0, stale: Number.MAX_SAFE_INTEGER });
      let result = null;
      if (b.ring.length >= minSamples) {
        if (b.stale >= 16) {
          const xs = b.ring.values();
          b.med = median(xs);
          b.mad = median(xs.map((x) => Math.abs(x - b.med)));
          b.stale = 0;
        }
        const scale = Math.max(1.4826 * b.mad, b.med * 0.05, 1);
        const z = (p.amountPaise - b.med) / scale;
        if (z > threshold) {
          result = hit("amount.band-anomaly", Verdict.Review, `${rupees(p.amountPaise)} is far above the usual ${p.kind} ${p.channel} band (median ${rupees(Math.round(b.med))})`, { amountPaise: p.amountPaise, medianPaise: Math.round(b.med), madPaise: Math.round(b.mad), robustZ: Math.round(z * 10) / 10, samples: b.ring.length });
        }
      }
      b.ring.push(p.timestampMs, p.amountPaise);
      b.stale += 1;
      return result;
    },
    reset: () => bands.clear(),
    exportState: () => [...bands].map(([k, b]) => [k, b.ring.toJSON()]),
    restoreState(s) {
      for (const [k, rows] of s)
        bands.set(k, { ring: TimeRing.from(size, rows), med: 0, mad: 0, stale: Number.MAX_SAFE_INTEGER });
    },
    stats: () => ({ bands: bands.size })
  };
}

// packages/rules/dist/config.js
init_buffer();

// packages/rules/dist/environment.js
init_buffer();
var DEFAULT_PREFIXES = ["uat-", "uat_", "stg-", "stg_", "staging-", "staging_", "sandbox-", "sandbox_", "test-", "test_"];
function originRule(o = {}) {
  const keys = new Set(o.nonProdKeyIds ?? []);
  const prefixes = (o.nonProdKeyPrefixes ?? DEFAULT_PREFIXES).map((s) => s.toLowerCase());
  return {
    name: "origin.nonprod",
    evaluate(p) {
      const keyHit = keys.has(p.sourceKeyId) || prefixes.some((pre) => p.sourceKeyId.toLowerCase().startsWith(pre));
      if (p.origin === "nonprod" || keyHit) {
        return hit("origin.nonprod", Verdict.Block, `Payout came from a non-production ${p.origin === "nonprod" ? "network origin" : "API key"} \u2014 UAT/staging can never move real money`, {
          origin: p.origin,
          sourceKeyId: p.sourceKeyId,
          matchedKeyList: keyHit
        });
      }
      if (p.origin === "unknown" && o.unknownOrigin === "review")
        return hit("origin.nonprod", Verdict.Review, "Network origin was not tagged by the gateway", { origin: p.origin, sourceKeyId: p.sourceKeyId, matchedKeyList: false });
      return null;
    }
  };
}
function canaryRule() {
  return {
    name: "canary.tripped",
    evaluate(p, ctx) {
      const c = ctx.canaries;
      const which = c.beneficiaryRefs.has(p.beneficiaryRef) ? "beneficiary" : c.sourceKeyIds.has(p.sourceKeyId) ? "sourceKey" : p.intentId !== void 0 && c.intentIds.has(p.intentId) ? "intent" : null;
      if (which === null)
        return null;
      return hit("canary.tripped", Verdict.Block, `Canary ${which} touched \u2014 entering HIGH_ALERT`, { canary: which, sourceKeyId: p.sourceKeyId }, "HIGH_ALERT");
    }
  };
}
function attestationRule(o = {}) {
  const kinds = new Set(o.requireAttestation ?? []);
  return {
    name: "client.unattested",
    evaluate(p) {
      if (!kinds.has(p.kind) || p.clientAttested === true)
        return null;
      return hit("client.unattested", Verdict.Review, `${p.kind} needs an attested client; this call ${p.clientAttested === false ? "failed" : "carried no"} attestation`, {
        kind: p.kind,
        clientAttested: p.clientAttested === void 0 ? "absent" : String(p.clientAttested)
      });
    }
  };
}
function calendarRule() {
  return {
    name: "calendar.window",
    evaluate(_p, ctx) {
      const w = ctx.calendarWindow;
      if (w === null || ctx.alertState === "HIGH_ALERT")
        return null;
      return hit("calendar.window", Verdict.Allow, `${w.kind === "holiday" ? w.label : w.kind === "weekend" ? `Weekend (${w.label})` : `Low-coverage hours (${w.label})`}: thresholds tightened`, {
        window: w.kind,
        label: w.label,
        istDate: w.istDate,
        velocityMultiplier: ctx.multipliers.velocity,
        coolingMultiplier: ctx.multipliers.coolingAmount
      });
    }
  };
}

// packages/rules/dist/external.js
init_buffer();
var DEFAULT_BLOCKS = ["block", "decline", "deny", "reject"];
var DEFAULT_REVIEWS = ["review", "challenge", "hold", "step-up", "stepup", "manual"];
function externalRule(o = {}) {
  const reviewAt = o.reviewScore ?? 0.7;
  const blockAt = o.blockScore ?? 0.9;
  const blocks = new Set((o.verdictBlocks ?? DEFAULT_BLOCKS).map((s) => s.toLowerCase()));
  const reviews = new Set((o.verdictReviews ?? DEFAULT_REVIEWS).map((s) => s.toLowerCase()));
  return {
    name: "external",
    evaluate(p) {
      const verdictWord = p.externalVerdict?.toLowerCase();
      const src = p.externalSource ?? "upstream";
      const ev = {
        source: src,
        ...p.riskScore !== void 0 ? { riskScore: p.riskScore } : {},
        ...p.externalVerdict !== void 0 ? { externalVerdict: p.externalVerdict } : {}
      };
      if (verdictWord !== void 0 && blocks.has(verdictWord))
        return hit("external.verdict", Verdict.Block, `Upstream signal '${p.externalVerdict}' from ${src} blocks this payout`, ev);
      if (p.riskScore !== void 0 && p.riskScore >= blockAt)
        return hit("external.score", Verdict.Block, `Upstream risk score ${p.riskScore} from ${src} \u2265 ${blockAt}`, ev);
      if (verdictWord !== void 0 && reviews.has(verdictWord))
        return hit("external.verdict", Verdict.Review, `Upstream signal '${p.externalVerdict}' from ${src} wants review`, ev);
      if (p.riskScore !== void 0 && p.riskScore >= reviewAt)
        return hit("external.score", Verdict.Review, `Upstream risk score ${p.riskScore} from ${src} \u2265 ${reviewAt}`, ev);
      return null;
    }
  };
}

// packages/rules/dist/feed.js
init_buffer();
var BANDS = ["LOW", "MEDIUM", "HIGH", "VERY_HIGH"];
var FraudFeed = class {
  entries = /* @__PURE__ */ new Map();
  loadedAt = 0;
  get size() {
    return this.entries.size;
  }
  get loadedAtMs() {
    return this.loadedAt;
  }
  lookup(mobileRef) {
    return this.entries.get(mobileRef);
  }
  /** Replace the snapshot atomically. Throws on a malformed file; the previous snapshot stays live. */
  load(snapshot, hashKey, nowMs = Date.now()) {
    if (typeof snapshot !== "object" || snapshot === null)
      throw new Error("feed snapshot must be an object");
    const s = snapshot;
    if (s.version !== 1)
      throw new Error("feed snapshot version must be 1");
    if (!Array.isArray(s.entries))
      throw new Error("feed snapshot entries must be an array");
    const src = typeof s.source === "string" ? s.source : "operator";
    const next = /* @__PURE__ */ new Map();
    s.entries.forEach((raw, i) => {
      const e = raw;
      if (typeof e.band !== "string" || !BANDS.includes(e.band))
        throw new Error(`entries[${i}].band invalid`);
      let ref2;
      if (typeof e.mobileRef === "string" && e.mobileRef.startsWith("hb1_"))
        ref2 = e.mobileRef;
      else if (typeof e.mobile === "string") {
        if (hashKey === void 0)
          throw new Error(`entries[${i}] has a raw mobile but no hash key was supplied`);
        ref2 = hashBeneficiary({ mobile: e.mobile }, hashKey);
      } else
        throw new Error(`entries[${i}] needs mobileRef or mobile`);
      next.set(ref2, { band: e.band, source: typeof e.source === "string" ? e.source : src });
    });
    this.entries = next;
    this.loadedAt = nowMs;
    return next.size;
  }
};
function feedRule(feed, o = {}) {
  const blockAt = BANDS.indexOf(o.blockAt ?? "VERY_HIGH");
  const reviewAt = BANDS.indexOf(o.reviewAt ?? "MEDIUM");
  return {
    name: "feed.reputation",
    evaluate(p) {
      if (p.beneficiaryMobileRef === void 0 || feed.size === 0)
        return null;
      const e = feed.lookup(p.beneficiaryMobileRef);
      if (e === void 0)
        return null;
      const lvl = BANDS.indexOf(e.band);
      if (lvl < reviewAt)
        return null;
      return hit("feed.reputation", lvl >= blockAt ? Verdict.Block : Verdict.Review, `Beneficiary mobile is ${e.band} risk on the ${e.source} feed snapshot`, {
        band: e.band,
        source: e.source,
        snapshotAgeMinutes: Math.round((p.timestampMs - feed.loadedAtMs) / 6e4)
      });
    },
    stats: () => ({ feedEntries: feed.size })
  };
}

// packages/rules/dist/intent.js
init_buffer();
function intentRule() {
  return {
    name: "intent",
    evaluate(p, ctx) {
      const c = ctx.intent;
      const ev = {
        kind: p.kind,
        ...c.intentKind !== void 0 ? { intentKind: c.intentKind } : {},
        ...c.issuer !== void 0 ? { issuer: c.issuer } : {},
        required: c.required,
        alertState: ctx.alertState
      };
      switch (c.status) {
        case "ok":
        case "not-required":
          return null;
        case "missing":
          return hit("intent.missing", Verdict.Block, p.intentId === void 0 || p.intentId === "" ? `No intent on this ${p.kind} payout${ctx.alertState === "HIGH_ALERT" ? " (HIGH_ALERT: every kind needs one)" : ""} \u2014 no matching intent, no payout` : "Intent id is not registered \u2014 no matching intent, no payout", { ...ev, detail: c.detail ?? "missing" });
        case "bad-signature":
          return hit("intent.bad-signature", Verdict.Block, `Intent failed verification (${c.detail ?? "bad-signature"})`, { ...ev, detail: c.detail ?? "bad-signature" });
        case "kind-mismatch":
          return hit("intent.kind-mismatch", Verdict.Block, `Intent authorises ${c.intentKind ?? "?"}, payout is ${p.kind}`, ev);
        case "expired":
          return hit("intent.expired", Verdict.Block, "Payout is outside the intent validity window", ev);
        case "beneficiary-mismatch":
          return hit("intent.beneficiary-mismatch", Verdict.Block, "Payout beneficiary is not the one the intent was signed for", ev);
        case "reused":
          return hit("intent.reused", Verdict.Block, `Intent already used ${c.uses ?? 0}/${c.maxUses ?? 1} time(s)`, { ...ev, uses: c.uses ?? 0, maxUses: c.maxUses ?? 1 });
        case "amount-exceeds":
          if (p.kind === "PA_SETTLEMENT")
            return null;
          return hit("intent.amount-exceeds", Verdict.Block, `${rupees(p.amountPaise)} exceeds the ${rupees(c.remainingPaise ?? 0)} left on the intent`, {
            ...ev,
            amountPaise: p.amountPaise,
            remainingPaise: c.remainingPaise ?? 0,
            maxAmountPaise: c.maxAmountPaise ?? 0
          });
      }
    }
  };
}

// packages/rules/dist/settlement.js
init_buffer();
function settlementOverCapturedRule() {
  return {
    name: "settlement.over-captured",
    evaluate(p, ctx) {
      if (p.kind !== "PA_SETTLEMENT" || ctx.intent.status !== "amount-exceeds")
        return null;
      return hit("settlement.over-captured", Verdict.Block, `Settlement ${rupees(p.amountPaise)} exceeds the reconciled captured net of ${rupees(ctx.intent.remainingPaise ?? 0)}`, { amountPaise: p.amountPaise, reconciledPaise: ctx.intent.remainingPaise ?? 0, overByPaise: p.amountPaise - (ctx.intent.remainingPaise ?? 0) });
    }
  };
}
function settlementAccountChangedRule(o = {}) {
  const coolingMs = o.coolingMs ?? 24 * 36e5;
  return {
    name: "settlement.account-changed",
    evaluate(p, ctx) {
      if (p.kind !== "PA_SETTLEMENT" || p.merchantId === void 0 || ctx.merchant === void 0)
        return null;
      const m = ctx.merchant;
      const changedNow = m.beneficiaryRef !== p.beneficiaryRef;
      const changedAt = changedNow ? p.timestampMs : m.changedAtMs;
      if (changedAt === void 0)
        return null;
      const age = p.timestampMs - changedAt;
      if (age < 0 || age >= coolingMs)
        return null;
      const mins = Math.round(age / 6e4);
      return hit("settlement.account-changed", Verdict.Review, changedNow ? `Merchant is settling to a different account than last time \u2014 ${rupees(p.amountPaise)} held for maker-checker` : `Merchant settlement account changed ${mins} min ago \u2014 ${rupees(p.amountPaise)} held for maker-checker`, { merchantId: p.merchantId, minutesSinceChange: mins, coolingMinutes: Math.round(coolingMs / 6e4), amountPaise: p.amountPaise });
    }
  };
}

// packages/rules/dist/config.js
function payrekhaRules(cfg = {}, feed = new FraudFeed()) {
  const rules = [
    canaryRule(),
    originRule(cfg.origin),
    intentRule(),
    externalRule(cfg.external),
    settlementOverCapturedRule(),
    settlementAccountChangedRule(cfg.settlement),
    probeRule(cfg.probe),
    coolingRule(cfg.cooling),
    velocityRule(cfg.velocity),
    ...cfg.band === false ? [] : [bandRule(cfg.band)],
    feedRule(feed, cfg.feed),
    attestationRule(cfg.requireAttestation !== void 0 ? { requireAttestation: cfg.requireAttestation } : {}),
    calendarRule()
  ];
  return { rules, feed };
}

// playground/entry.mjs
var HK = "playground-hash-key-0123456789abcdef";
var ADMIN = "playground-admin-token-0123456789";
var SECRET = "playground-demo-issuer-secret-0123456789abcdef";
var KINDS = ["LOAN_DISBURSAL", "PA_SETTLEMENT", "VENDOR_PAYOUT", "REFUND", "CRYPTO_WITHDRAWAL", "VERIFICATION"];
var T = (d, h, m, s = 0) => istToEpochMs(2026, 11, d, h, m, s);
var ref = (vpa) => hashBeneficiary({ vpa }, HK);
var toRupees = rupees;
var fw = null;
var modeNow = "enforce";
var seq = 0;
function fresh(mode = modeNow) {
  modeNow = mode;
  seq = 0;
  const set = payrekhaRules({ band: false });
  fw = new Payrekha(set.rules, {
    config: {
      mode,
      adminTokenSha256: createHash("sha256").update(ADMIN).digest("hex"),
      requireIntent: { VENDOR_PAYOUT: false, PA_SETTLEMENT: false, REFUND: false },
      calendar: { holidays: [{ date: "2026-11-08", name: "Diwali (Lakshmi Puja)" }, { date: "2026-11-09", name: "Diwali (Govardhan Puja)" }], lowCoverageHours: null },
      highAlertOnBlocks: { count: 0, windowMs: 1 }
    },
    keys: [{ keyId: "demo-los", issuer: "los-demo", alg: "hmac-sha256", secret: SECRET, kinds: KINDS }],
    now: () => T(4, 10, 0)
  });
  fw.addCanaries({ beneficiaryRefs: [ref("apk-canary-7f3@okbank")] }, { actor: "playground", reason: "canary planted in APK", adminToken: ADMIN });
  return fw;
}
function intent(o) {
  const i = signIntent(
    { maxUses: 1, issuer: "los-demo", keyId: "demo-los", notBeforeMs: T(4, 0, 0), expiresAtMs: T(9, 0, 0), ...o },
    { alg: "hmac-sha256", secret: SECRET }
  );
  fw.registerIntent(i, T(4, 10, 0));
  return i;
}
function pay(o) {
  return fw.evaluate({ payoutId: `pg-${++seq}`, channel: "IMPS", sourceKeyId: "lms-prod", origin: "prod", kind: "LOAN_DISBURSAL", ...o });
}
function attackChain(mode = "enforce") {
  fresh(mode);
  const borrower = ref("ramesh.k@okhdfc");
  const mule = ref("quickcash77@okaxis");
  const steps = [];
  const step = (title, attack, v, amountPaise, at) => steps.push({ title, attack, verdict: v.verdict, effectiveAction: v.effectiveAction, alertState: v.alertState, micros: Math.round(v.elapsedMicros), hits: v.hits.map((h) => ({ rule: h.rule, reason: h.reason })), amountPaise, at });
  const vi = intent({ intentId: "ver-42", kind: "VERIFICATION", maxAmountPaise: 100, beneficiaryRef: borrower, subjectRef: "loan-42" });
  step("Penny-drop verifies the borrower account (VERIFICATION intent)", false, pay({ kind: "VERIFICATION", intentId: vi.intentId, amountPaise: 100, beneficiaryRef: borrower, timestampMs: T(4, 10, 2) }), 100, T(4, 10, 2));
  const li = intent({ intentId: "disb-42", kind: "LOAN_DISBURSAL", maxAmountPaise: 24e6, beneficiaryRef: borrower, subjectRef: "loan-42" });
  step("\u20B92,40,000 loan disbursal with a signed LOS intent", false, pay({ intentId: li.intentId, amountPaise: 24e6, beneficiaryRef: borrower, timestampMs: T(4, 10, 5) }), 24e6, T(4, 10, 5));
  step("Attacker calls the payout API with stolen LMS credentials \u2014 no intent", true, pay({ amountPaise: 48e6, beneficiaryRef: mule, timestampMs: T(6, 2, 11) }), 48e6, T(6, 2, 11));
  const li2 = intent({ intentId: "disb-43", kind: "LOAN_DISBURSAL", maxAmountPaise: 31e6, beneficiaryRef: ref("sunita.m@oksbi"), subjectRef: "loan-43" });
  step("Attacker replays a real intent (disb-43) to a mule account", true, pay({ intentId: li2.intentId, amountPaise: 31e6, beneficiaryRef: mule, timestampMs: T(6, 2, 14) }), 31e6, T(6, 2, 14));
  const fresh1 = ref("fresh.acct91@okicici");
  step("\u20B91 probe to a new account (vendor payout rail)", true, pay({ kind: "VENDOR_PAYOUT", amountPaise: 100, beneficiaryRef: fresh1, timestampMs: T(6, 2, 20) }), 100, T(6, 2, 20));
  step("\u2026then \u20B94,99,999 to the same account", true, pay({ kind: "VENDOR_PAYOUT", amountPaise: 49999900, beneficiaryRef: fresh1, timestampMs: T(6, 2, 24) }), 49999900, T(6, 2, 24));
  step("Same call from a UAT key that can still reach prod", true, pay({ kind: "VENDOR_PAYOUT", sourceKeyId: "uat_lms", origin: "nonprod", amountPaise: 49999900, beneficiaryRef: fresh1, timestampMs: T(6, 2, 27) }), 49999900, T(6, 2, 27));
  fw.merchants.observe("m-kirana-881", ref("kirana881@okhdfc"), T(1, 12, 0));
  fw.noteMerchantAccountChange("m-kirana-881", mule, T(6, 2, 30));
  step("Settlement account changed 5 min ago \u2014 \u20B938 lakh merchant settlement", true, pay({ kind: "PA_SETTLEMENT", merchantId: "m-kirana-881", amountPaise: 38e7, beneficiaryRef: mule, timestampMs: T(6, 2, 35) }), 38e7, T(6, 2, 35));
  let burst;
  for (let k = 0; k < 11; k++) burst = pay({ kind: "REFUND", amountPaise: 9e5, beneficiaryRef: ref(`refund${k}@okaxis`), timestampMs: T(8, 1, 0, k * 20) });
  step("Diwali: calendar flips to HOLIDAY, velocity budget halves \u2014 refund burst", true, burst, 11 * 9e5, T(8, 1, 3, 20));
  step("Attacker pays a canary beneficiary planted in the APK", true, pay({ kind: "REFUND", amountPaise: 25e4, beneficiaryRef: ref("apk-canary-7f3@okbank"), timestampMs: T(8, 1, 10) }), 25e4, T(8, 1, 10));
  step("HIGH_ALERT: the next unbound payout blocks instantly", true, pay({ kind: "REFUND", amountPaise: 12e4, beneficiaryRef: ref("other.mule@okaxis"), timestampMs: T(8, 1, 11) }), 12e4, T(8, 1, 11));
  const attacks = steps.filter((s) => s.attack && !s.title.startsWith("\u20B91 probe"));
  const leaked = attacks.filter((s) => s.effectiveAction === "ALLOW").reduce((a, s) => a + s.amountPaise, 0);
  const wouldStop = attacks.filter((s) => s.verdict !== "ALLOW");
  return { mode, steps, attacks: attacks.length, leaked, wouldStopCount: wouldStop.length, wouldStopPaise: wouldStop.reduce((a, s) => a + s.amountPaise, 0) };
}
function evaluateCustom(payout, beneficiary) {
  if (!fw) fresh();
  const p = { ...payout };
  p.beneficiaryRef = typeof beneficiary === "string" && beneficiary.startsWith("hb1_") ? beneficiary : hashBeneficiary(beneficiary, HK);
  p.payoutId = p.payoutId ?? `custom-${++seq}`;
  p.timestampMs = p.timestampMs ?? Date.now();
  return fw.evaluate(p);
}
function getState() {
  if (!fw) fresh();
  const m = fw.metrics;
  return {
    mode: modeNow,
    alertState: fw.alertState,
    highAlert: fw.highAlertInfo,
    canaries: fw.canaries.size,
    intents: m.intents,
    beneficiaries: m.beneficiaries,
    evaluations: m.evaluated,
    verdicts: m.verdicts
  };
}
fresh();
export {
  attackChain,
  evaluateCustom,
  formatIst,
  fresh,
  getState,
  intent,
  pay,
  ref,
  toRupees
};
/*! Bundled license information:

ieee754/index.js:
  (*! ieee754. BSD-3-Clause License. Feross Aboukhadijeh <https://feross.org/opensource> *)

buffer/index.js:
  (*!
   * The buffer module from node.js, for the browser.
   *
   * @author   Feross Aboukhadijeh <https://feross.org>
   * @license  MIT
   *)
*/
