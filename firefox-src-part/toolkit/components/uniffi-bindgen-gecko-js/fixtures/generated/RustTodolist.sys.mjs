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

    // Reads a TodoList pointer from the data stream
    // UniFFI Pointers are **always** 8 bytes long. That is enforced
    // by the C++ and Rust Scaffolding code.
    readPointerTodoList() {
        const pointerId = 12; // todolist:TodoList
        const res = UniFFIScaffolding.readPointer(pointerId, this.dataView.buffer, this.pos);
        this.pos += 8;
        return res;
    }

    // Writes a TodoList pointer into the data stream
    // UniFFI Pointers are **always** 8 bytes long. That is enforced
    // by the C++ and Rust Scaffolding code.
    writePointerTodoList(value) {
        const pointerId = 12; // todolist:TodoList
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
            let message = result.internalErrorMessage;
            if (message) {
                throw new UniFFIInternalError(message);
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

export class TodoList {
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
     * An async constructor for TodoList.
     * 
     * @returns {Promise<TodoList>}: A promise that resolves
     *      to a newly constructed TodoList
     */
    static init() {
        const liftResult = (result) => FfiConverterTypeTodoList.lift(result);
        const liftError = null;
        const functionCall = () => {
            return UniFFIScaffolding.callAsync(
                141, // todolist:uniffi_uniffi_todolist_fn_constructor_todolist_new
            )
        }
        try {
            return functionCall().then((result) => handleRustResult(result, liftResult, liftError));
        }  catch (error) {
            return Promise.reject(error)
        }}

    addEntries(entries) {
        const liftResult = (result) => undefined;
        const liftError = null;
        const functionCall = () => {
            try {
                FfiConverterSequenceTypeTodoEntry.checkType(entries)
            } catch (e) {
                if (e instanceof UniFFITypeError) {
                    e.addItemDescriptionPart("entries");
                }
                throw e;
            }
            return UniFFIScaffolding.callAsync(
                142, // todolist:uniffi_uniffi_todolist_fn_method_todolist_add_entries
                FfiConverterTypeTodoList.lower(this),
                FfiConverterSequenceTypeTodoEntry.lower(entries),
            )
        }
        try {
            return functionCall().then((result) => handleRustResult(result, liftResult, liftError));
        }  catch (error) {
            return Promise.reject(error)
        }
    }

    addEntry(entry) {
        const liftResult = (result) => undefined;
        const liftError = (data) => FfiConverterTypeTodoError.lift(data);
        const functionCall = () => {
            try {
                FfiConverterTypeTodoEntry.checkType(entry)
            } catch (e) {
                if (e instanceof UniFFITypeError) {
                    e.addItemDescriptionPart("entry");
                }
                throw e;
            }
            return UniFFIScaffolding.callAsync(
                143, // todolist:uniffi_uniffi_todolist_fn_method_todolist_add_entry
                FfiConverterTypeTodoList.lower(this),
                FfiConverterTypeTodoEntry.lower(entry),
            )
        }
        try {
            return functionCall().then((result) => handleRustResult(result, liftResult, liftError));
        }  catch (error) {
            return Promise.reject(error)
        }
    }

    addItem(todo) {
        const liftResult = (result) => undefined;
        const liftError = (data) => FfiConverterTypeTodoError.lift(data);
        const functionCall = () => {
            try {
                FfiConverterString.checkType(todo)
            } catch (e) {
                if (e instanceof UniFFITypeError) {
                    e.addItemDescriptionPart("todo");
                }
                throw e;
            }
            return UniFFIScaffolding.callAsync(
                144, // todolist:uniffi_uniffi_todolist_fn_method_todolist_add_item
                FfiConverterTypeTodoList.lower(this),
                FfiConverterString.lower(todo),
            )
        }
        try {
            return functionCall().then((result) => handleRustResult(result, liftResult, liftError));
        }  catch (error) {
            return Promise.reject(error)
        }
    }

    addItems(items) {
        const liftResult = (result) => undefined;
        const liftError = null;
        const functionCall = () => {
            try {
                FfiConverterSequencestring.checkType(items)
            } catch (e) {
                if (e instanceof UniFFITypeError) {
                    e.addItemDescriptionPart("items");
                }
                throw e;
            }
            return UniFFIScaffolding.callAsync(
                145, // todolist:uniffi_uniffi_todolist_fn_method_todolist_add_items
                FfiConverterTypeTodoList.lower(this),
                FfiConverterSequencestring.lower(items),
            )
        }
        try {
            return functionCall().then((result) => handleRustResult(result, liftResult, liftError));
        }  catch (error) {
            return Promise.reject(error)
        }
    }

    clearItem(todo) {
        const liftResult = (result) => undefined;
        const liftError = (data) => FfiConverterTypeTodoError.lift(data);
        const functionCall = () => {
            try {
                FfiConverterString.checkType(todo)
            } catch (e) {
                if (e instanceof UniFFITypeError) {
                    e.addItemDescriptionPart("todo");
                }
                throw e;
            }
            return UniFFIScaffolding.callAsync(
                146, // todolist:uniffi_uniffi_todolist_fn_method_todolist_clear_item
                FfiConverterTypeTodoList.lower(this),
                FfiConverterString.lower(todo),
            )
        }
        try {
            return functionCall().then((result) => handleRustResult(result, liftResult, liftError));
        }  catch (error) {
            return Promise.reject(error)
        }
    }

    getEntries() {
        const liftResult = (result) => FfiConverterSequenceTypeTodoEntry.lift(result);
        const liftError = null;
        const functionCall = () => {
            return UniFFIScaffolding.callAsync(
                147, // todolist:uniffi_uniffi_todolist_fn_method_todolist_get_entries
                FfiConverterTypeTodoList.lower(this),
            )
        }
        try {
            return functionCall().then((result) => handleRustResult(result, liftResult, liftError));
        }  catch (error) {
            return Promise.reject(error)
        }
    }

    getFirst() {
        const liftResult = (result) => FfiConverterString.lift(result);
        const liftError = (data) => FfiConverterTypeTodoError.lift(data);
        const functionCall = () => {
            return UniFFIScaffolding.callAsync(
                148, // todolist:uniffi_uniffi_todolist_fn_method_todolist_get_first
                FfiConverterTypeTodoList.lower(this),
            )
        }
        try {
            return functionCall().then((result) => handleRustResult(result, liftResult, liftError));
        }  catch (error) {
            return Promise.reject(error)
        }
    }

    getItems() {
        const liftResult = (result) => FfiConverterSequencestring.lift(result);
        const liftError = null;
        const functionCall = () => {
            return UniFFIScaffolding.callAsync(
                149, // todolist:uniffi_uniffi_todolist_fn_method_todolist_get_items
                FfiConverterTypeTodoList.lower(this),
            )
        }
        try {
            return functionCall().then((result) => handleRustResult(result, liftResult, liftError));
        }  catch (error) {
            return Promise.reject(error)
        }
    }

    getLast() {
        const liftResult = (result) => FfiConverterString.lift(result);
        const liftError = (data) => FfiConverterTypeTodoError.lift(data);
        const functionCall = () => {
            return UniFFIScaffolding.callAsync(
                150, // todolist:uniffi_uniffi_todolist_fn_method_todolist_get_last
                FfiConverterTypeTodoList.lower(this),
            )
        }
        try {
            return functionCall().then((result) => handleRustResult(result, liftResult, liftError));
        }  catch (error) {
            return Promise.reject(error)
        }
    }

    getLastEntry() {
        const liftResult = (result) => FfiConverterTypeTodoEntry.lift(result);
        const liftError = (data) => FfiConverterTypeTodoError.lift(data);
        const functionCall = () => {
            return UniFFIScaffolding.callAsync(
                151, // todolist:uniffi_uniffi_todolist_fn_method_todolist_get_last_entry
                FfiConverterTypeTodoList.lower(this),
            )
        }
        try {
            return functionCall().then((result) => handleRustResult(result, liftResult, liftError));
        }  catch (error) {
            return Promise.reject(error)
        }
    }

    makeDefault() {
        const liftResult = (result) => undefined;
        const liftError = null;
        const functionCall = () => {
            return UniFFIScaffolding.callAsync(
                152, // todolist:uniffi_uniffi_todolist_fn_method_todolist_make_default
                FfiConverterTypeTodoList.lower(this),
            )
        }
        try {
            return functionCall().then((result) => handleRustResult(result, liftResult, liftError));
        }  catch (error) {
            return Promise.reject(error)
        }
    }

}

// Export the FFIConverter object to make external types work.
export class FfiConverterTypeTodoList extends FfiConverter {
    static lift(value) {
        const opts = {};
        opts[constructUniffiObject] = value;
        return new TodoList(opts);
    }

    static lower(value) {
        const ptr = value[uniffiObjectPtr];
        if (!(ptr instanceof UniFFIPointer)) {
            throw new UniFFITypeError("Object is not a 'TodoList' instance");
        }
        return ptr;
    }

    static read(dataStream) {
        return this.lift(dataStream.readPointerTodoList());
    }

    static write(dataStream, value) {
        dataStream.writePointerTodoList(value[uniffiObjectPtr]);
    }

    static computeSize(value) {
        return 8;
    }
}

export class TodoEntry {
    constructor({ text } = {}) {
        try {
            FfiConverterString.checkType(text)
        } catch (e) {
            if (e instanceof UniFFITypeError) {
                e.addItemDescriptionPart("text");
            }
            throw e;
        }
        this.text = text;
    }
    equals(other) {
        return (
            this.text == other.text
        )
    }
}

// Export the FFIConverter object to make external types work.
export class FfiConverterTypeTodoEntry extends FfiConverterArrayBuffer {
    static read(dataStream) {
        return new TodoEntry({
            text: FfiConverterString.read(dataStream),
        });
    }
    static write(dataStream, value) {
        FfiConverterString.write(dataStream, value.text);
    }

    static computeSize(value) {
        let totalSize = 0;
        totalSize += FfiConverterString.computeSize(value.text);
        return totalSize
    }

    static checkType(value) {
        super.checkType(value);
        if (!(value instanceof TodoEntry)) {
            throw new UniFFITypeError(`Expected 'TodoEntry', found '${typeof value}'`);
        }
        try {
            FfiConverterString.checkType(value.text);
        } catch (e) {
            if (e instanceof UniFFITypeError) {
                e.addItemDescriptionPart(".text");
            }
            throw e;
        }
    }
}




export class TodoError extends Error {}


export class TodoDoesNotExist extends TodoError {

    constructor(message, ...params) {
        super(...params);
        this.message = message;
    }
    toString() {
        return `TodoDoesNotExist: ${super.toString()}`
    }
}

export class EmptyTodoList extends TodoError {

    constructor(message, ...params) {
        super(...params);
        this.message = message;
    }
    toString() {
        return `EmptyTodoList: ${super.toString()}`
    }
}

export class DuplicateTodo extends TodoError {

    constructor(message, ...params) {
        super(...params);
        this.message = message;
    }
    toString() {
        return `DuplicateTodo: ${super.toString()}`
    }
}

export class EmptyString extends TodoError {

    constructor(message, ...params) {
        super(...params);
        this.message = message;
    }
    toString() {
        return `EmptyString: ${super.toString()}`
    }
}

export class DeligatedError extends TodoError {

    constructor(message, ...params) {
        super(...params);
        this.message = message;
    }
    toString() {
        return `DeligatedError: ${super.toString()}`
    }
}

// Export the FFIConverter object to make external types work.
export class FfiConverterTypeTodoError extends FfiConverterArrayBuffer {
    static read(dataStream) {
        switch (dataStream.readInt32()) {
            case 1:
                return new TodoDoesNotExist(FfiConverterString.read(dataStream));
            case 2:
                return new EmptyTodoList(FfiConverterString.read(dataStream));
            case 3:
                return new DuplicateTodo(FfiConverterString.read(dataStream));
            case 4:
                return new EmptyString(FfiConverterString.read(dataStream));
            case 5:
                return new DeligatedError(FfiConverterString.read(dataStream));
            default:
                throw new UniFFITypeError("Unknown TodoError variant");
        }
    }
    static computeSize(value) {
        // Size of the Int indicating the variant
        let totalSize = 4;
        if (value instanceof TodoDoesNotExist) {
            return totalSize;
        }
        if (value instanceof EmptyTodoList) {
            return totalSize;
        }
        if (value instanceof DuplicateTodo) {
            return totalSize;
        }
        if (value instanceof EmptyString) {
            return totalSize;
        }
        if (value instanceof DeligatedError) {
            return totalSize;
        }
        throw new UniFFITypeError("Unknown TodoError variant");
    }
    static write(dataStream, value) {
        if (value instanceof TodoDoesNotExist) {
            dataStream.writeInt32(1);
            return;
        }
        if (value instanceof EmptyTodoList) {
            dataStream.writeInt32(2);
            return;
        }
        if (value instanceof DuplicateTodo) {
            dataStream.writeInt32(3);
            return;
        }
        if (value instanceof EmptyString) {
            dataStream.writeInt32(4);
            return;
        }
        if (value instanceof DeligatedError) {
            dataStream.writeInt32(5);
            return;
        }
        throw new UniFFITypeError("Unknown TodoError variant");
    }

    static errorClass = TodoError;
}

// Export the FFIConverter object to make external types work.
export class FfiConverterOptionalTypeTodoList extends FfiConverterArrayBuffer {
    static checkType(value) {
        if (value !== undefined && value !== null) {
            FfiConverterTypeTodoList.checkType(value)
        }
    }

    static read(dataStream) {
        const code = dataStream.readUint8(0);
        switch (code) {
            case 0:
                return null
            case 1:
                return FfiConverterTypeTodoList.read(dataStream)
            default:
                throw UniFFIError(`Unexpected code: ${code}`);
        }
    }

    static write(dataStream, value) {
        if (value === null || value === undefined) {
            dataStream.writeUint8(0);
            return;
        }
        dataStream.writeUint8(1);
        FfiConverterTypeTodoList.write(dataStream, value)
    }

    static computeSize(value) {
        if (value === null || value === undefined) {
            return 1;
        }
        return 1 + FfiConverterTypeTodoList.computeSize(value)
    }
}

// Export the FFIConverter object to make external types work.
export class FfiConverterSequencestring extends FfiConverterArrayBuffer {
    static read(dataStream) {
        const len = dataStream.readInt32();
        const arr = [];
        for (let i = 0; i < len; i++) {
            arr.push(FfiConverterString.read(dataStream));
        }
        return arr;
    }

    static write(dataStream, value) {
        dataStream.writeInt32(value.length);
        value.forEach((innerValue) => {
            FfiConverterString.write(dataStream, innerValue);
        })
    }

    static computeSize(value) {
        // The size of the length
        let size = 4;
        for (const innerValue of value) {
            size += FfiConverterString.computeSize(innerValue);
        }
        return size;
    }

    static checkType(value) {
        if (!Array.isArray(value)) {
            throw new UniFFITypeError(`${value} is not an array`);
        }
        value.forEach((innerValue, idx) => {
            try {
                FfiConverterString.checkType(innerValue);
            } catch (e) {
                if (e instanceof UniFFITypeError) {
                    e.addItemDescriptionPart(`[${idx}]`);
                }
                throw e;
            }
        })
    }
}

// Export the FFIConverter object to make external types work.
export class FfiConverterSequenceTypeTodoEntry extends FfiConverterArrayBuffer {
    static read(dataStream) {
        const len = dataStream.readInt32();
        const arr = [];
        for (let i = 0; i < len; i++) {
            arr.push(FfiConverterTypeTodoEntry.read(dataStream));
        }
        return arr;
    }

    static write(dataStream, value) {
        dataStream.writeInt32(value.length);
        value.forEach((innerValue) => {
            FfiConverterTypeTodoEntry.write(dataStream, innerValue);
        })
    }

    static computeSize(value) {
        // The size of the length
        let size = 4;
        for (const innerValue of value) {
            size += FfiConverterTypeTodoEntry.computeSize(innerValue);
        }
        return size;
    }

    static checkType(value) {
        if (!Array.isArray(value)) {
            throw new UniFFITypeError(`${value} is not an array`);
        }
        value.forEach((innerValue, idx) => {
            try {
                FfiConverterTypeTodoEntry.checkType(innerValue);
            } catch (e) {
                if (e instanceof UniFFITypeError) {
                    e.addItemDescriptionPart(`[${idx}]`);
                }
                throw e;
            }
        })
    }
}





export function createEntryWith(todo) {

        const liftResult = (result) => FfiConverterTypeTodoEntry.lift(result);
        const liftError = (data) => FfiConverterTypeTodoError.lift(data);
        const functionCall = () => {
            try {
                FfiConverterString.checkType(todo)
            } catch (e) {
                if (e instanceof UniFFITypeError) {
                    e.addItemDescriptionPart("todo");
                }
                throw e;
            }
            return UniFFIScaffolding.callAsync(
                153, // todolist:uniffi_uniffi_todolist_fn_func_create_entry_with
                FfiConverterString.lower(todo),
            )
        }
        try {
            return functionCall().then((result) => handleRustResult(result, liftResult, liftError));
        }  catch (error) {
            return Promise.reject(error)
        }
}

export function getDefaultList() {

        const liftResult = (result) => FfiConverterOptionalTypeTodoList.lift(result);
        const liftError = null;
        const functionCall = () => {
            return UniFFIScaffolding.callAsync(
                154, // todolist:uniffi_uniffi_todolist_fn_func_get_default_list
            )
        }
        try {
            return functionCall().then((result) => handleRustResult(result, liftResult, liftError));
        }  catch (error) {
            return Promise.reject(error)
        }
}

export function setDefaultList(list) {

        const liftResult = (result) => undefined;
        const liftError = null;
        const functionCall = () => {
            try {
                FfiConverterTypeTodoList.checkType(list)
            } catch (e) {
                if (e instanceof UniFFITypeError) {
                    e.addItemDescriptionPart("list");
                }
                throw e;
            }
            return UniFFIScaffolding.callAsync(
                155, // todolist:uniffi_uniffi_todolist_fn_func_set_default_list
                FfiConverterTypeTodoList.lower(list),
            )
        }
        try {
            return functionCall().then((result) => handleRustResult(result, liftResult, liftError));
        }  catch (error) {
            return Promise.reject(error)
        }
}
