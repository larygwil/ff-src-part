
/**
 * Handler for a single UniFFI CallbackInterface
 *
 * This class stores objects that implement a callback interface in a handle
 * map, allowing them to be referenced by the Rust code using an integer
 * handle.
 *
 * While the callback object is stored in the map, it allows the Rust code to
 * call methods on the object using the callback object handle, a method id,
 * and an ArrayBuffer packed with the method arguments.
 *
 * When the Rust code drops its reference, it sends a call with the methodId=0,
 * which causes callback object to be removed from the map.
 */
class UniFFICallbackHandler {
    #name;
    #interfaceId;
    #handleCounter;
    #handleMap;
    #methodHandlers;
    #allowNewCallbacks

    /**
     * Create a UniFFICallbackHandler
     * @param {string} name - Human-friendly name for this callback interface
     * @param {int} interfaceId - Interface ID for this CallbackInterface.
     * @param {UniFFICallbackMethodHandler[]} methodHandlers -- UniFFICallbackHandler for each method, in the same order as the UDL file
     */
     constructor(name, interfaceId, methodHandlers) {
        this.#name = name;
        this.#interfaceId = interfaceId;
        this.#handleCounter = 0;
        this.#handleMap = new Map();
        this.#methodHandlers = methodHandlers;
        this.#allowNewCallbacks = true;

        UniFFIScaffolding.registerCallbackHandler(this.#interfaceId, this);
        Services.obs.addObserver(this, "xpcom-shutdown");
     }

    /**
     * Store a callback object in the handle map and return the handle
     *
     * @param {obj} callbackObj - Object that implements the callback interface
     * @returns {int} - Handle for this callback object, this is what gets passed back to Rust.
     */
    storeCallbackObj(callbackObj) {
        if (!this.#allowNewCallbacks) {
            throw new UniFFIError(`No new callbacks allowed for ${this.#name}`);
        }
        const handle = this.#handleCounter;
        this.#handleCounter += 1;
        this.#handleMap.set(handle, new UniFFICallbackHandleMapEntry(callbackObj, Components.stack.caller.formattedStack.trim()));
        return handle;
    }

    /**
     * Get a previously stored callback object
     *
     * @param {int} handle - Callback object handle, returned from `storeCallbackObj()`
     * @returns {obj} - Callback object
     */
    getCallbackObj(handle) {
        return this.#handleMap.get(handle).callbackObj;
    }

    /**
     * Set if new callbacks are allowed for this handler
     *
     * This is called with false during shutdown to ensure the callback maps don't
     * prevent JS objects from being GCed.
     */
    setAllowNewCallbacks(allow) {
        this.#allowNewCallbacks = allow
    }

    /**
     * Check that no callbacks are currently registered
     *
     * If there are callbacks registered a UniFFIError will be thrown.  This is
     * called during shutdown to generate an alert if there are leaked callback
     * interfaces.
     */
    assertNoRegisteredCallbacks() {
        if (this.#handleMap.size > 0) {
            const entry = this.#handleMap.values().next().value;
            throw new UniFFIError(`UniFFI interface ${this.#name} has ${this.#handleMap.size} registered callbacks at xpcom-shutdown. This likely indicates a UniFFI callback leak.\nStack trace for the first leaked callback:\n${entry.stackTrace}.`);
        }
    }

    /**
     * Invoke a method on a stored callback object
     * @param {int} handle - Object handle
     * @param {int} methodId - Method index (0-based)
     * @param {ArrayBuffer} argsArrayBuffer - Arguments to pass to the method, packed in an ArrayBuffer
     */
    call(handle, methodId, argsArrayBuffer) {
        try {
            this.#invokeCallbackInner(handle, methodId, argsArrayBuffer);
        } catch (e) {
            console.error(`internal error invoking callback: ${e}`)
        }
    }

    /**
     * Free a stored callback object
     * @param {int} handle - Object handle
     */
    free(handle) {
        this.#handleMap.delete(handle);
    }

    #invokeCallbackInner(handle, methodId, argsArrayBuffer) {
        const callbackObj = this.getCallbackObj(handle);
        if (callbackObj === undefined) {
            throw new UniFFIError(`${this.#name}: invalid callback handle id: ${handle}`);
        }

        // Get the method data, converting from 1-based indexing
        const methodHandler = this.#methodHandlers[methodId];
        if (methodHandler === undefined) {
            throw new UniFFIError(`${this.#name}: invalid method id: ${methodId}`)
        }

        methodHandler.call(callbackObj, argsArrayBuffer);
    }

    /**
     * xpcom-shutdown observer method
     *
     * This handles:
     *  - Deregistering ourselves as the UniFFI callback handler
     *  - Checks for any leftover stored callbacks which indicate memory leaks
     */
    observe(aSubject, aTopic, aData) {
        if (aTopic == "xpcom-shutdown") {
            try {
                this.setAllowNewCallbacks(false);
                this.assertNoRegisteredCallbacks();
                UniFFIScaffolding.deregisterCallbackHandler(this.#interfaceId);
            } catch (ex) {
                console.error(`UniFFI Callback interface error during xpcom-shutdown: ${ex}`);
                Cc["@mozilla.org/xpcom/debug;1"]
                    .getService(Ci.nsIDebug2)
                    .abort(ex.filename, ex.lineNumber);
            }
         }
    }
}

/**
 * Handles calling a single method for a callback interface
 */
class UniFFICallbackMethodHandler {
    #name;
    #argsConverters;

    /**
     * Create a UniFFICallbackMethodHandler

     * @param {string} name -- Name of the method to call on the callback object
     * @param {FfiConverter[]} argsConverters - FfiConverter for each argument type
     */
    constructor(name, argsConverters) {
        this.#name = name;
        this.#argsConverters = argsConverters;
    }

    /**
     * Invoke the method
     *
     * @param {obj} callbackObj -- Object implementing the callback interface for this method
     * @param {ArrayBuffer} argsArrayBuffer -- Arguments for the method, packed in an ArrayBuffer
     */
     call(callbackObj, ...args) {
        const convertedArgs = this.#argsConverters.map((converter, i) => converter.lift(args[i]));
        return callbackObj[this.#name](...convertedArgs);
    }
}

/**
 * UniFFICallbackHandler.handleMap entry
 *
 * @property callbackObj - Callback object, this must implement the callback interface.
 * @property {string} stackTrace - Stack trace from when the callback object was registered.  This is used to proved extra context when debugging leaked callback objects.
 */
class UniFFICallbackHandleMapEntry {
    constructor(callbackObj, stackTrace) {
        this.callbackObj = callbackObj;
        this.stackTrace = stackTrace
    }
}
