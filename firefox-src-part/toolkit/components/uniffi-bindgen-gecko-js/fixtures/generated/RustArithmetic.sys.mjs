// This file was autogenerated by the `uniffi-bindgen-gecko-js` crate.
// Trust me, you don't want to mess with it!

import { UniFFITypeError } from "resource://gre/modules/UniFFI.sys.mjs";



// Objects intended to be used in the unit tests
export var UnitTestObjs = {};

// Write/Read data to/from an ArrayBuffer
class ArrayBufferDataStream {
    constructor(arrayBuffer) {
        this.dataView = new DataView(arrayBuffer);
        this.pos = 0;
    }

    readUint8() {
        let rv = this.dataView.getUint8(this.pos);
        this.pos += 1;
        return rv;
    }

    writeUint8(value) {
        this.dataView.setUint8(this.pos, value);
        this.pos += 1;
    }

    readUint16() {
        let rv = this.dataView.getUint16(this.pos);
        this.pos += 2;
        return rv;
    }

    writeUint16(value) {
        this.dataView.setUint16(this.pos, value);
        this.pos += 2;
    }

    readUint32() {
        let rv = this.dataView.getUint32(this.pos);
        this.pos += 4;
        return rv;
    }

    writeUint32(value) {
        this.dataView.setUint32(this.pos, value);
        this.pos += 4;
    }

    readUint64() {
        let rv = this.dataView.getBigUint64(this.pos);
        this.pos += 8;
        return Number(rv);
    }

    writeUint64(value) {
        this.dataView.setBigUint64(this.pos, BigInt(value));
        this.pos += 8;
    }


    readInt8() {
        let rv = this.dataView.getInt8(this.pos);
        this.pos += 1;
        return rv;
    }

    writeInt8(value) {
        this.dataView.setInt8(this.pos, value);
        this.pos += 1;
    }

    readInt16() {
        let rv = this.dataView.getInt16(this.pos);
        this.pos += 2;
        return rv;
    }

    writeInt16(value) {
        this.dataView.setInt16(this.pos, value);
        this.pos += 2;
    }

    readInt32() {
        let rv = this.dataView.getInt32(this.pos);
        this.pos += 4;
        return rv;
    }

    writeInt32(value) {
        this.dataView.setInt32(this.pos, value);
        this.pos += 4;
    }

    readInt64() {
        let rv = this.dataView.getBigInt64(this.pos);
        this.pos += 8;
        return Number(rv);
    }

    writeInt64(value) {
        this.dataView.setBigInt64(this.pos, BigInt(value));
        this.pos += 8;
    }

    readFloat32() {
        let rv = this.dataView.getFloat32(this.pos);
        this.pos += 4;
        return rv;
    }

    writeFloat32(value) {
        this.dataView.setFloat32(this.pos, value);
        this.pos += 4;
    }

    readFloat64() {
        let rv = this.dataView.getFloat64(this.pos);
        this.pos += 8;
        return rv;
    }

    writeFloat64(value) {
        this.dataView.setFloat64(this.pos, value);
        this.pos += 8;
    }


    writeString(value) {
      const encoder = new TextEncoder();
      // Note: in order to efficiently write this data, we first write the
      // string data, reserving 4 bytes for the size.
      const dest = new Uint8Array(this.dataView.buffer, this.pos + 4);
      const encodeResult = encoder.encodeInto(value, dest);
      if (encodeResult.read != value.length) {
        throw new UniFFIError(
            "writeString: out of space when writing to ArrayBuffer.  Did the computeSize() method returned the wrong result?"
        );
      }
      const size = encodeResult.written;
      // Next, go back and write the size before the string data
      this.dataView.setUint32(this.pos, size);
      // Finally, advance our position past both the size and string data
      this.pos += size + 4;
    }

    readString() {
      const decoder = new TextDecoder();
      const size = this.readUint32();
      const source = new Uint8Array(this.dataView.buffer, this.pos, size)
      const value = decoder.decode(source);
      this.pos += size;
      return value;
    }
}

function handleRustResult(result, liftCallback, liftErrCallback) {
    switch (result.code) {
        case "success":
            return liftCallback(result.data);

        case "error":
            throw liftErrCallback(result.data);

        case "internal-error":
            if (result.data) {
                throw new UniFFIInternalError(FfiConverterString.lift(result.data));
            } else {
                throw new UniFFIInternalError("Unknown error");
            }

        default:
            throw new UniFFIError(`Unexpected status code: ${result.code}`);
    }
}

class UniFFIError {
    constructor(message) {
        this.message = message;
    }

    toString() {
        return `UniFFIError: ${this.message}`
    }
}

class UniFFIInternalError extends UniFFIError {}

// Base class for FFI converters
class FfiConverter {
    // throw `UniFFITypeError` if a value to be converted has an invalid type
    static checkType(value) {
        if (value === undefined ) {
            throw new UniFFITypeError(`undefined`);
        }
        if (value === null ) {
            throw new UniFFITypeError(`null`);
        }
    }
}

// Base class for FFI converters that lift/lower by reading/writing to an ArrayBuffer
class FfiConverterArrayBuffer extends FfiConverter {
    static lift(buf) {
        return this.read(new ArrayBufferDataStream(buf));
    }

    static lower(value) {
        const buf = new ArrayBuffer(this.computeSize(value));
        const dataStream = new ArrayBufferDataStream(buf);
        this.write(dataStream, value);
        return buf;
    }
}

// Symbols that are used to ensure that Object constructors
// can only be used with a proper UniFFI pointer
const uniffiObjectPtr = Symbol("uniffiObjectPtr");
const constructUniffiObject = Symbol("constructUniffiObject");
UnitTestObjs.uniffiObjectPtr = uniffiObjectPtr;

// Export the FFIConverter object to make external types work.
export class FfiConverterU64 extends FfiConverter {
    static checkType(value) {
        super.checkType(value);
        if (!Number.isSafeInteger(value)) {
            throw new UniFFITypeError(`${value} exceeds the safe integer bounds`);
        }
        if (value < 0) {
            throw new UniFFITypeError(`${value} exceeds the U64 bounds`);
        }
    }
    static computeSize() {
        return 8;
    }
    static lift(value) {
        return value;
    }
    static lower(value) {
        return value;
    }
    static write(dataStream, value) {
        dataStream.writeUint64(value)
    }
    static read(dataStream) {
        return dataStream.readUint64()
    }
}

// Export the FFIConverter object to make external types work.
export class FfiConverterBool extends FfiConverter {
    static computeSize() {
        return 1;
    }
    static lift(value) {
        return value == 1;
    }
    static lower(value) {
        if (value) {
            return 1;
        } else {
            return 0;
        }
    }
    static write(dataStream, value) {
        dataStream.writeUint8(this.lower(value))
    }
    static read(dataStream) {
        return this.lift(dataStream.readUint8())
    }
}

// Export the FFIConverter object to make external types work.
export class FfiConverterString extends FfiConverter {
    static checkType(value) {
        super.checkType(value);
        if (typeof value !== "string") {
            throw new UniFFITypeError(`${value} is not a string`);
        }
    }

    static lift(buf) {
        const decoder = new TextDecoder();
        const utf8Arr = new Uint8Array(buf);
        return decoder.decode(utf8Arr);
    }
    static lower(value) {
        const encoder = new TextEncoder();
        return encoder.encode(value).buffer;
    }

    static write(dataStream, value) {
        dataStream.writeString(value);
    }

    static read(dataStream) {
        return dataStream.readString();
    }

    static computeSize(value) {
        const encoder = new TextEncoder();
        return 4 + encoder.encode(value).length
    }
}




export class ArithmeticError extends Error {}


export class IntegerOverflow extends ArithmeticError {

    constructor(message, ...params) {
        super(...params);
        this.message = message;
    }
    toString() {
        return `IntegerOverflow: ${super.toString()}`
    }
}

// Export the FFIConverter object to make external types work.
export class FfiConverterTypeArithmeticError extends FfiConverterArrayBuffer {
    static read(dataStream) {
        switch (dataStream.readInt32()) {
            case 1:
                return new IntegerOverflow(FfiConverterString.read(dataStream));
            default:
                throw new UniFFITypeError("Unknown ArithmeticError variant");
        }
    }
    static computeSize(value) {
        // Size of the Int indicating the variant
        let totalSize = 4;
        if (value instanceof IntegerOverflow) {
            return totalSize;
        }
        throw new UniFFITypeError("Unknown ArithmeticError variant");
    }
    static write(dataStream, value) {
        if (value instanceof IntegerOverflow) {
            dataStream.writeInt32(1);
            return;
        }
        throw new UniFFITypeError("Unknown ArithmeticError variant");
    }

    static errorClass = ArithmeticError;
}





export function add(a,b) {

        const liftResult = (result) => FfiConverterU64.lift(result);
        const liftError = (data) => FfiConverterTypeArithmeticError.lift(data);
        const functionCall = () => {
            try {
                FfiConverterU64.checkType(a)
            } catch (e) {
                if (e instanceof UniFFITypeError) {
                    e.addItemDescriptionPart("a");
                }
                throw e;
            }
            try {
                FfiConverterU64.checkType(b)
            } catch (e) {
                if (e instanceof UniFFITypeError) {
                    e.addItemDescriptionPart("b");
                }
                throw e;
            }
            return UniFFIScaffolding.callAsync(
                59, // arithmetic:uniffi_arithmetical_fn_func_add
                FfiConverterU64.lower(a),
                FfiConverterU64.lower(b),
            )
        }
        try {
            return functionCall().then((result) => handleRustResult(result, liftResult, liftError));
        }  catch (error) {
            return Promise.reject(error)
        }
}

export function div(dividend,divisor) {

        const liftResult = (result) => FfiConverterU64.lift(result);
        const liftError = null;
        const functionCall = () => {
            try {
                FfiConverterU64.checkType(dividend)
            } catch (e) {
                if (e instanceof UniFFITypeError) {
                    e.addItemDescriptionPart("dividend");
                }
                throw e;
            }
            try {
                FfiConverterU64.checkType(divisor)
            } catch (e) {
                if (e instanceof UniFFITypeError) {
                    e.addItemDescriptionPart("divisor");
                }
                throw e;
            }
            return UniFFIScaffolding.callAsync(
                60, // arithmetic:uniffi_arithmetical_fn_func_div
                FfiConverterU64.lower(dividend),
                FfiConverterU64.lower(divisor),
            )
        }
        try {
            return functionCall().then((result) => handleRustResult(result, liftResult, liftError));
        }  catch (error) {
            return Promise.reject(error)
        }
}

export function equal(a,b) {

        const liftResult = (result) => FfiConverterBool.lift(result);
        const liftError = null;
        const functionCall = () => {
            try {
                FfiConverterU64.checkType(a)
            } catch (e) {
                if (e instanceof UniFFITypeError) {
                    e.addItemDescriptionPart("a");
                }
                throw e;
            }
            try {
                FfiConverterU64.checkType(b)
            } catch (e) {
                if (e instanceof UniFFITypeError) {
                    e.addItemDescriptionPart("b");
                }
                throw e;
            }
            return UniFFIScaffolding.callAsync(
                61, // arithmetic:uniffi_arithmetical_fn_func_equal
                FfiConverterU64.lower(a),
                FfiConverterU64.lower(b),
            )
        }
        try {
            return functionCall().then((result) => handleRustResult(result, liftResult, liftError));
        }  catch (error) {
            return Promise.reject(error)
        }
}

export function sub(a,b) {

        const liftResult = (result) => FfiConverterU64.lift(result);
        const liftError = (data) => FfiConverterTypeArithmeticError.lift(data);
        const functionCall = () => {
            try {
                FfiConverterU64.checkType(a)
            } catch (e) {
                if (e instanceof UniFFITypeError) {
                    e.addItemDescriptionPart("a");
                }
                throw e;
            }
            try {
                FfiConverterU64.checkType(b)
            } catch (e) {
                if (e instanceof UniFFITypeError) {
                    e.addItemDescriptionPart("b");
                }
                throw e;
            }
            return UniFFIScaffolding.callAsync(
                62, // arithmetic:uniffi_arithmetical_fn_func_sub
                FfiConverterU64.lower(a),
                FfiConverterU64.lower(b),
            )
        }
        try {
            return functionCall().then((result) => handleRustResult(result, liftResult, liftError));
        }  catch (error) {
            return Promise.reject(error)
        }
}
