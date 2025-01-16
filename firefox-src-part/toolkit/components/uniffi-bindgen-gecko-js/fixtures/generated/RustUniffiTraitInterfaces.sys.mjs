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

    readBytes() {
      const size = this.readInt32();
      const bytes = new Uint8Array(this.dataView.buffer, this.pos, size);
      this.pos += size;
      return bytes
    }

    writeBytes(uint8Array) {
      this.writeUint32(uint8Array.length);
      value.forEach((elt) => {
        dataStream.writeUint8(elt);
      })
    }

    // Reads a Calc pointer from the data stream
    // UniFFI Pointers are **always** 8 bytes long. That is enforced
    // by the C++ and Rust Scaffolding code.
    readPointerCalc() {
        const pointerId = 21; // uniffi_trait_interfaces:Calc
        const res = UniFFIScaffolding.readPointer(pointerId, this.dataView.buffer, this.pos);
        this.pos += 8;
        return res;
    }

    // Writes a Calc pointer into the data stream
    // UniFFI Pointers are **always** 8 bytes long. That is enforced
    // by the C++ and Rust Scaffolding code.
    writePointerCalc(value) {
        const pointerId = 21; // uniffi_trait_interfaces:Calc
        UniFFIScaffolding.writePointer(pointerId, value, this.dataView.buffer, this.pos);
        this.pos += 8;
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
export class FfiConverterU32 extends FfiConverter {
    static checkType(value) {
        super.checkType(value);
        if (!Number.isInteger(value)) {
            throw new UniFFITypeError(`${value} is not an integer`);
        }
        if (value < 0 || value > 4294967295) {
            throw new UniFFITypeError(`${value} exceeds the U32 bounds`);
        }
    }
    static computeSize() {
        return 4;
    }
    static lift(value) {
        return value;
    }
    static lower(value) {
        return value;
    }
    static write(dataStream, value) {
        dataStream.writeUint32(value)
    }
    static read(dataStream) {
        return dataStream.readUint32()
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

/**
 * Calc
 */
export class Calc {
    // Use `init` to instantiate this class.
    // DO NOT USE THIS CONSTRUCTOR DIRECTLY
    constructor(opts) {
        if (!Object.prototype.hasOwnProperty.call(opts, constructUniffiObject)) {
            throw new UniFFIError("Attempting to construct an object using the JavaScript constructor directly" +
            "Please use a UDL defined constructor, or the init function for the primary constructor")
        }
        if (!opts[constructUniffiObject] instanceof UniFFIPointer) {
            throw new UniFFIError("Attempting to create a UniFFI object with a pointer that is not an instance of UniFFIPointer")
        }
        this[uniffiObjectPtr] = opts[constructUniffiObject];
    }

    /**
     * add
     * @returns {number}
     */
    add(a,b) {
        const liftResult = (result) => FfiConverterU32.lift(result);
        const liftError = null;
        const functionCall = () => {
            try {
                FfiConverterU32.checkType(a)
            } catch (e) {
                if (e instanceof UniFFITypeError) {
                    e.addItemDescriptionPart("a");
                }
                throw e;
            }
            try {
                FfiConverterU32.checkType(b)
            } catch (e) {
                if (e instanceof UniFFITypeError) {
                    e.addItemDescriptionPart("b");
                }
                throw e;
            }
            return UniFFIScaffolding.callSync(
                215, // uniffi_trait_interfaces:uniffi_uniffi_trait_interfaces_fn_method_calc_add
                FfiConverterTypeCalc.lower(this),
                FfiConverterU32.lower(a),
                FfiConverterU32.lower(b),
            )
        }
        return handleRustResult(functionCall(), liftResult, liftError);
    }

}

// Export the FFIConverter object to make external types work.
export class FfiConverterTypeCalc extends FfiConverter {
    static lift(value) {
        const opts = {};
        opts[constructUniffiObject] = value;
        return new Calc(opts);
    }

    static lower(value) {
        const ptr = value[uniffiObjectPtr];
        if (!(ptr instanceof UniFFIPointer)) {
            throw new UniFFITypeError("Object is not a 'Calc' instance");
        }
        return ptr;
    }

    static read(dataStream) {
        return this.lift(dataStream.readPointerCalc());
    }

    static write(dataStream, value) {
        dataStream.writePointerCalc(value[uniffiObjectPtr]);
    }

    static computeSize(value) {
        return 8;
    }
}





/**
 * makeBuggyCalculator
 * @returns {Calc}
 */
export function makeBuggyCalculator() {

        const liftResult = (result) => FfiConverterTypeCalc.lift(result);
        const liftError = null;
        const functionCall = () => {
            return UniFFIScaffolding.callSync(
                213, // uniffi_trait_interfaces:uniffi_uniffi_trait_interfaces_fn_func_make_buggy_calculator
            )
        }
        return handleRustResult(functionCall(), liftResult, liftError);
}

/**
 * makeCalculator
 * @returns {Calc}
 */
export function makeCalculator() {

        const liftResult = (result) => FfiConverterTypeCalc.lift(result);
        const liftError = null;
        const functionCall = () => {
            return UniFFIScaffolding.callSync(
                214, // uniffi_trait_interfaces:uniffi_uniffi_trait_interfaces_fn_func_make_calculator
            )
        }
        return handleRustResult(functionCall(), liftResult, liftError);
}