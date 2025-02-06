/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * @typedef {object} Lazy
 * @typedef {import("../content/Utils.sys.mjs").ProgressAndStatusCallbackParams} ProgressAndStatusCallbackParams
 * @property {typeof console} console
 * @property {typeof import("../content/Utils.sys.mjs").getRuntimeWasmFilename} getRuntimeWasmFilename
 * @property {typeof import("../content/EngineProcess.sys.mjs").EngineProcess} EngineProcess
 * @property {typeof import("../../../../services/settings/remote-settings.sys.mjs").RemoteSettings} RemoteSettings
 * @property {typeof import("../../translations/actors/TranslationsParent.sys.mjs").TranslationsParent} TranslationsParent
 */

/** @type {Lazy} */
const lazy = {};

ChromeUtils.defineLazyGetter(lazy, "console", () => {
  return console.createInstance({
    maxLogLevelPref: "browser.ml.logLevel",
    prefix: "ML:EngineParent",
  });
});

ChromeUtils.defineESModuleGetters(lazy, {
  EngineProcess: "chrome://global/content/ml/EngineProcess.sys.mjs",
  RemoteSettings: "resource://services-settings/remote-settings.sys.mjs",
  TranslationsParent: "resource://gre/actors/TranslationsParent.sys.mjs",
  setTimeout: "resource://gre/modules/Timer.sys.mjs",
  clearTimeout: "resource://gre/modules/Timer.sys.mjs",
  ModelHub: "chrome://global/content/ml/ModelHub.sys.mjs",
  getInferenceProcessInfo: "chrome://global/content/ml/Utils.sys.mjs",
  Progress: "chrome://global/content/ml/Utils.sys.mjs",
});

const RS_RUNTIME_COLLECTION = "ml-onnx-runtime";
const RS_INFERENCE_OPTIONS_COLLECTION = "ml-inference-options";
const RS_ALLOW_DENY_COLLECTION = "ml-model-allow-deny-list";
const TERMINATE_TIMEOUT = 5000;

/**
 * The ML engine is in its own content process. This actor handles the
 * marshalling of the data such as the engine payload.
 */
export class MLEngineParent extends JSWindowActorParent {
  /**
   * The RemoteSettingsClient that downloads the wasm binaries.
   *
   * @type {Record<string, RemoteSettingsClient>}
   */
  static #remoteClients = {};

  /** @type {Promise<WasmRecord> | null} */
  static #wasmRecord = null;

  /**
   * Locks to prevent race conditions when creating engines.
   *
   * @type {Map<string, Promise>}
   */
  static engineLocks = new Map();

  /**
   * The following constant controls the major and minor version for onnx wasm downloaded from
   * Remote Settings.
   *
   * In our case, we want to use two distinct ort versions:
   * - Transformers 2.x needs onnxruntime-web <= 1.19
   * - Transformers 3.x needs onnxruntime-web > 1.19
   *
   * We are using "1.x" for the first one, and "2.x" for the second one.
   * So when updating the versions in remote setting, make sure you use 2.0+ for 1.20+
   *
   * When a breaking change is introduced, Nightly will have these
   * numbers incremented by one, but Beta and Release will still be on the previous
   * version. Remote Settings will ship both versions of the records, and the latest
   * asset released in that version will be used. For instance, with a major version
   * of "1", assets can be downloaded for "1.0", "1.2", "1.3beta", but assets marked
   * as "2.0", "2.1", etc will not be downloaded.
   */
  static WASM_MAJOR_VERSION = 3;

  /**
   * This wasm file supports CPU, WebGPU and WebNN.
   *
   * Since SIMD is supported by all major JavaScript engines, non-SIMD build is no longer provided.
   * We also serve the threaded build since we can simply set numThreads to 1 to disable multi-threading.
   */
  static WASM_FILENAME = "ort-wasm-simd-threaded.jsep.wasm";

  /**
   * The modelhub used to retrieve files.
   *
   * @type {ModelHub}
   */
  modelHub = null;

  /**
   * Tracks the most recent revision for each task and model pair that are marked for deletion.
   * Keys are task names and model names. Values contain their respective revisions.
   *
   * @type {Map<string, object>}
   */
  #modelFilesInUse = new Map();

  /**
   * The callback to call for updating about notifications such as dowload progress status.
   *
   * @type {?function(ProgressAndStatusCallbackParams):void}
   */
  notificationsCallback = null;

  /**
   * Remote settings isn't available in tests, so provide mocked responses.
   *
   * @param {RemoteSettingsClient} remoteClients
   */
  static mockRemoteSettings(remoteClients) {
    lazy.console.log("Mocking remote settings in MLEngineParent.");
    MLEngineParent.#remoteClients = remoteClients;
    MLEngineParent.#wasmRecord = null;
  }

  /**
   * Remove anything that could have been mocked.
   */
  static removeMocks() {
    lazy.console.log("Removing mocked remote client in MLEngineParent.");
    MLEngineParent.#remoteClients = {};
    MLEngineParent.#wasmRecord = null;
  }

  /**
   * Creates a new MLEngine.
   *
   * If there's an existing engine with the same pipelineOptions, it will be reused.
   *
   * @param {PipelineOptions} pipelineOptions
   * @param {?function(ProgressAndStatusCallbackParams):void} notificationsCallback A function to call to indicate progress status.
   * @returns {Promise<MLEngine>}
   */
  async getEngine(pipelineOptions, notificationsCallback = null) {
    const engineId = pipelineOptions.engineId;

    // Allow notifications callback changes even when reusing engine.
    this.notificationsCallback = notificationsCallback;

    if (MLEngineParent.engineLocks.has(engineId)) {
      // Wait for the existing lock to resolve
      await MLEngineParent.engineLocks.get(engineId);
    }
    let resolveLock;
    const lockPromise = new Promise(resolve => {
      resolveLock = resolve;
    });
    MLEngineParent.engineLocks.set(engineId, lockPromise);
    try {
      const currentEngine = MLEngine.getInstance(engineId);

      if (currentEngine) {
        if (currentEngine.pipelineOptions.equals(pipelineOptions)) {
          lazy.console.debug("Returning existing engine", engineId);
          return currentEngine;
        }
        await MLEngine.removeInstance(
          engineId,
          /* shutdown */ false,
          /* replacement*/ true
        );
      }

      lazy.console.debug("Creating a new engine");
      const engine = await MLEngine.initialize({
        mlEngineParent: this,
        pipelineOptions,
        notificationsCallback,
      });

      // TODO - What happens if the engine is already killed here?
      return engine;
    } finally {
      MLEngineParent.engineLocks.delete(engineId);
      resolveLock();
    }
  }

  /**
   * Validates a taskName
   *
   * Throws an exception if the task name is invalid.
   *
   * @param {string} taskName
   */
  checkTaskName(taskName) {
    // Define a regular expression to verify taskName pattern (alphanumeric and underscores/dashes)
    const validTaskNamePattern = /^[a-zA-Z0-9_\-]+$/;

    // Check if taskName matches the pattern
    if (!validTaskNamePattern.test(taskName)) {
      // Handle invalid taskName, e.g., throw an error or return null
      throw new Error(
        "Invalid task name. Task name should contain only alphanumeric characters and underscores/dashes."
      );
    }
  }

  // eslint-disable-next-line consistent-return
  async receiveMessage(message) {
    switch (message.name) {
      case "MLEngine:Ready":
        if (lazy.EngineProcess.resolveMLEngineParent) {
          lazy.EngineProcess.resolveMLEngineParent(this);
        } else {
          lazy.console.error(
            "Expected #resolveMLEngineParent to exist when then ML Engine is ready."
          );
        }
        break;
      case "MLEngine:GetWasmArrayBuffer":
        return MLEngineParent.getWasmArrayBuffer();

      case "MLEngine:GetModelFile":
        return this.getModelFile(message.data);

      case "MLEngine:GetInferenceProcessInfo":
        return lazy.getInferenceProcessInfo();

      case "MLEngine:DestroyEngineProcess":
        lazy.EngineProcess.destroyMLEngine().catch(error =>
          console.error(error)
        );
        break;
      case "MLEngine:GetInferenceOptions":
        this.checkTaskName(message.json.taskName);
        return MLEngineParent.getInferenceOptions(
          message.json.featureId,
          message.json.taskName
        );
      case "MLEngine:Removed":
        if (!message.json.replacement) {
          // when receiving this message from the child, we know it's not a replacement.
          await MLEngine.removeInstance(
            message.json.engineId,
            message.json.shutdown,
            /* replacement */ false
          );
        }
        break;
    }
  }

  /**
   * Deletes all previous revisions for the current task and model used by the engine.
   *
   * @returns {Promise<void>}
   */
  async deletePreviousModelRevisions() {
    if (!this.modelHub) {
      lazy.console.debug(
        "Ignored attempt to delete previous models when the engine is not fully initialized."
      );
    }

    const deletePromises = [];

    for (const [
      key,
      { taskName, model, revision },
    ] of this.#modelFilesInUse.entries()) {
      lazy.console.debug("Deleting previous version for ", {
        taskName,
        model,
        revision,
      });
      deletePromises.push(
        this.modelHub
          .deleteNonMatchingModelRevisions({
            taskName,
            model,
            targetRevision: revision,
          })
          .then(() => this.#modelFilesInUse.delete(key))
      );
    }

    await Promise.all(deletePromises);
  }

  /**
   * Retrieves a model file from the specified URL.
   * This function normalizes the URL, extracts the organization, model name, and file path,
   * then fetches the model file using the ModelHub API. The `modelHub` instance is created
   * only once and reused for subsequent calls to optimize performance.
   *
   * @param {object} config
   * @param {string} config.engineId - The engine id.
   * @param {string} config.taskName - name of the inference task.
   * @param {string} config.url - The URL of the model file to fetch. Can be a path relative to
   * the model hub root or an absolute URL.
   * @param {string} config.rootUrl - The URL of the model file to fetch. Can be a path relative to
   * the model hub root or an absolute URL.
   * @param {string} config.urlTemplate - The URL of the model file to fetch. Can be a path relative to
   * the model hub root or an absolute URL.
   * @returns {Promise<[string, object]>} The file local path and headers
   */
  async getModelFile({ engineId, taskName, url, rootUrl, urlTemplate }) {
    // Create the model hub instance if needed
    if (!this.modelHub) {
      lazy.console.debug("Creating model hub instance");
      this.modelHub = new lazy.ModelHub({
        rootUrl,
        urlTemplate,
        allowDenyList: await MLEngineParent.getAllowDenyList(),
      });
    }

    if (url.startsWith(rootUrl)) {
      url = url.slice(rootUrl.length);
      // Make sure we get a front slash
      if (!url.startsWith("/")) {
        url = `/${url}`;
      }
    }

    // Parsing url to get model name, and file path.
    // if this errors out, it will be caught in the worker
    const parsedUrl = this.modelHub.parseUrl(url, { rootUrl, urlTemplate });

    const [data, headers] = await this.modelHub.getModelDataAsFile({
      engineId,
      taskName,
      ...parsedUrl,
      modelHubRootUrl: rootUrl,
      modelHubUrlTemplate: urlTemplate,
      progressCallback: this.notificationsCallback?.bind(this),
    });

    // Keep the latest revision for each task, model
    this.#modelFilesInUse.set(`${taskName}-${parsedUrl.model}`, {
      taskName,
      ...parsedUrl,
    });

    lazy.console.debug(
      `Model ${parsedUrl.model} was fetched from ${url}, size ${Math.round(
        headers.fileSize / (1024 * 1024)
      )}MiB`
    );

    return [data, headers];
  }

  /** Gets the wasm file from remote settings.
   *
   * @param {RemoteSettingsClient} client
   */
  static async #getWasmArrayRecord(client) {
    /** @type {WasmRecord[]} */
    const wasmRecords =
      await lazy.TranslationsParent.getMaxSupportedVersionRecords(client, {
        filters: { name: MLEngineParent.WASM_FILENAME },
        minSupportedMajorVersion: MLEngineParent.WASM_MAJOR_VERSION,
        maxSupportedMajorVersion: MLEngineParent.WASM_MAJOR_VERSION,
      });

    if (wasmRecords.length === 0) {
      // The remote settings client provides an empty list of records when there is
      // an error.
      throw new Error("Unable to get the ML engine from Remote Settings.");
    }

    if (wasmRecords.length > 1) {
      MLEngineParent.reportError(
        new Error("Expected the ml engine to only have 1 record."),
        wasmRecords
      );
    }
    const [record] = wasmRecords;
    lazy.console.debug(
      `Using runtime ${record.name}@${record.version}`,
      record
    );
    return record;
  }

  /**
   * Gets the allow/deny list from remote settings
   *
   */
  static async getAllowDenyList() {
    return MLEngineParent.#getRemoteClient(RS_ALLOW_DENY_COLLECTION).get();
  }

  /**
   * Gets the inference options from remote settings given a feature id or task name.
   *
   * Each feature can store default options in Remote Settings.
   *
   * We fallback to taskName if there is no featureId provided.
   *
   * @param {string} featureId - id of the feature
   * @param {string} taskName - name of the inference task
   * @returns {Promise<ModelRevisionRecord>}
   */
  static async getInferenceOptions(featureId, taskName) {
    const client = MLEngineParent.#getRemoteClient(
      RS_INFERENCE_OPTIONS_COLLECTION
    );

    let records = featureId ? await client.get({ filters: { featureId } }) : [];

    // if the featureId is not in our settings, we fallback to the task name
    if (records.length === 0) {
      records = await client.get({
        filters: {
          taskName,
        },
      });
    }

    // if we get more than one entry we error out
    if (records.length > 1) {
      throw new Error(
        `Found more than one inference options record for ${featureId} and ${taskName}`
      );
    }

    // if the task name is not in our settings, we just set the onnx runtime filename.
    if (records.length === 0) {
      return {
        runtimeFilename: MLEngineParent.WASM_FILENAME,
      };
    }
    const options = records[0];
    return {
      modelRevision: options.modelRevision,
      modelId: options.modelId,
      tokenizerRevision: options.tokenizerRevision,
      tokenizerId: options.tokenizerId,
      processorRevision: options.processorRevision,
      processorId: options.processorId,
      dtype: options.dtype,
      numThreads: options.numThreads,
      runtimeFilename: MLEngineParent.WASM_FILENAME,
    };
  }

  /**
   * Download the wasm for the ML inference engine.
   *
   * @returns {Promise<ArrayBuffer>}
   */
  static async getWasmArrayBuffer() {
    const client = MLEngineParent.#getRemoteClient(RS_RUNTIME_COLLECTION);

    if (!MLEngineParent.#wasmRecord) {
      // Place the records into a promise to prevent any races.
      MLEngineParent.#wasmRecord = MLEngineParent.#getWasmArrayRecord(client);
    }

    let wasmRecord;
    try {
      wasmRecord = await MLEngineParent.#wasmRecord;
      if (!wasmRecord) {
        return Promise.reject(
          "Error: Unable to get the ML engine from Remote Settings."
        );
      }
    } catch (error) {
      MLEngineParent.#wasmRecord = null;
      throw error;
    }

    /** @type {{buffer: ArrayBuffer}} */
    const { buffer } = await client.attachments.download(wasmRecord);

    return buffer;
  }

  /**
   * Lazily initializes the RemoteSettingsClient for the downloaded wasm binary data.
   *
   * @param {string} collectionName - The name of the collection to use.
   * @returns {RemoteSettingsClient}
   */
  static #getRemoteClient(collectionName) {
    if (MLEngineParent.#remoteClients[collectionName]) {
      return MLEngineParent.#remoteClients[collectionName];
    }

    /** @type {RemoteSettingsClient} */
    const client = lazy.RemoteSettings(collectionName, {
      bucketName: "main",
    });

    MLEngineParent.#remoteClients[collectionName] = client;

    client.on("sync", async ({ data: { created, updated, deleted } }) => {
      lazy.console.debug(`"sync" event for ${collectionName}`, {
        created,
        updated,
        deleted,
      });

      // Remove all the deleted records.
      for (const record of deleted) {
        await client.attachments.deleteDownloaded(record);
      }

      // Remove any updated records, and download the new ones.
      for (const { old: oldRecord } of updated) {
        await client.attachments.deleteDownloaded(oldRecord);
      }

      // Do nothing for the created records.
    });

    return client;
  }

  /**
   * Gets a status
   */
  getStatus() {
    return this.sendQuery("MLEngine:GetStatus");
  }

  /**
   * Send a message to gracefully shutdown all of the ML engines in the engine process.
   * This mostly exists for testing the shutdown paths of the code.
   */
  forceShutdown() {
    return this.sendQuery("MLEngine:ForceShutdown");
  }
}

/**
 * A utility class that manages a main promise for the full response
 * and a sequence of chunk promises for incremental parts of the response.
 *
 */
class ResponseOrChunkResolvers {
  /**
   * Resolver for the main promise (full response).
   *
   * @type {object}
   */
  mainResolvers;

  /**
   * The main promise for the full response.
   *
   * @type {Promise}
   */
  promise;

  /**
   * Index tracking the next chunk resolver to be returned.
   *
   * @type {number}
   */
  nextchunkResolverIdx = 0;

  /**
   * Array of resolvers for incremental chunk promises.
   *
   * @type {Array<object>}
   */
  chunkResolvers = [];

  /**
   * Initializes the class with a main promise resolver
   * and the first chunk resolver for incremental data.
   */
  constructor() {
    lazy.console.debug("Initializing ResponseOrChunkResolvers ...");
    this.mainResolvers = Promise.withResolvers();
    this.promise = this.mainResolvers.promise;

    // Initialize the first chunk resolver
    this.chunkResolvers.push(Promise.withResolvers());
  }

  /**
   * Resolves the main promise with the provided value, indicating the full response is ready.
   *
   * @param {*} value - The value to resolve the main promise with (e.g., the complete response data).
   */
  resolve(value) {
    this.mainResolvers.resolve(value);
  }

  /**
   * Rejects the main promise with the provided reason, indicating that the full response failed.
   *
   * @param {*} reason - The reason for rejecting the main promise (e.g., an error).
   */
  reject(reason) {
    this.mainResolvers.reject(reason);
  }

  /**
   * Returns the promise for the next chunk of the response and advances the internal index.
   * Each call retrieves the promise for the next incremental part of the response.
   *
   * @returns {Promise} The promise for the next chunk of data.
   */
  getAndAdvanceChunkPromise() {
    this.nextchunkResolverIdx += 1;
    return this.chunkResolvers[this.nextchunkResolverIdx - 1].promise;
  }

  /**
   * Resolves the current chunk promise with the provided value
   * and prepares a new chunk resolver for the next incremental part of the response.
   *
   * @param {*} value - The value to resolve the current chunk promise with (e.g., a part of the response data).
   */
  resolveChunk(value) {
    // Create a new chunk resolver for future chunks
    this.chunkResolvers.push(Promise.withResolvers());
    // Resolve the current chunk
    this.chunkResolvers[this.chunkResolvers.length - 2].resolve(value);
  }

  /**
   * Rejects the current chunk promise with the provided reason
   * and prepares a new chunk resolver for the next incremental part of the response.
   *
   * @param {*} reason - The reason for rejecting the current chunk promise (e.g., an error with this chunk).
   */
  rejectChunk(reason) {
    // Create a new chunk resolver for future chunks
    this.chunkResolvers.push(Promise.withResolvers());
    // Reject the current chunk
    this.chunkResolvers[this.chunkResolvers.length - 2].reject(reason);
  }
}

/**
 * The interface to communicate to an MLEngine in the parent process. The engine manages
 * its own lifetime, and is kept alive with a timeout. A reference to this engine can
 * be retained, but once idle, the engine will be destroyed. If a new request to run
 * is sent, the engine will be recreated on demand. This balances the cost of retaining
 * potentially large amounts of memory to run models, with the speed and ease of running
 * the engine.
 *
 * @typedef {object} Request
 * @property {?string} id - The identifier for tracking this request. If not provided, an id will be auto-generated. Each inference callback will reference this id.
 * @property {any[]} args - The arguments to pass to the pipeline. The required arguments depend on your model. See [Hugging Face Transformers documentation](https://huggingface.co/docs/transformers.js/en/api/models) for more details.
 * @property {?object} options - The generation options to pass to the model. Refer to the [GenerationConfigType documentation](https://huggingface.co/docs/transformers.js/en/api/utils/generation#module_utils/generation..GenerationConfigType) for available options.
 * @property {?Uint8Array} data - For the imagetoText model, this is the array containing the image data.
 *
 * @template Response
 */
class MLEngine {
  /**
   * The cached engines.
   *
   * @type {Map<string, MLEngine>}
   */
  static #instances = new Map();

  /**
   * @type {MessagePort | null}
   */
  #port = null;

  #nextRequestId = 0;

  /**
   * Tie together a message id to a resolved response.
   *
   * @type {Map<number, PromiseWithResolvers<Request>>}
   */
  #requests = new Map();

  /**
   * @type {"uninitialized" | "ready" | "error" | "closed"}
   */
  engineStatus = "uninitialized";

  /**
   * Unique identifier for the engine.
   *
   * @type {string}
   */
  engineId;

  /**
   * Callback to call when receiving an initializing progress status.
   *
   * @type {?function(ProgressAndStatusCallbackParams):void}
   */
  notificationsCallback = null;

  /**
   * Removes an instance of the MLEngine with the given engineId.
   *
   * @param {string} engineId - The ID of the engine instance to be removed.
   * @param {boolean} shutdown - Flag indicating whether to shutdown the engine.
   * @param {boolean} replacement - Flag indicating whether the engine is being replaced.
   * @returns {Promise<void>} A promise that resolves once the engine is removed.
   */
  static async removeInstance(engineId, shutdown, replacement) {
    for (const [id, engine] of MLEngine.#instances.entries()) {
      if (engine.engineId == engineId) {
        await engine.terminate(shutdown, replacement);
        MLEngine.#instances.delete(id);
      }
    }
  }

  /**
   * Retrieves an instance of the MLEngine with the given engineId.
   *
   * @param {string} engineId - The ID of the engine instance to retrieve.
   * @returns {MLEngine|null} The engine instance with the given ID, or null if not found.
   */
  static getInstance(engineId) {
    return MLEngine.#instances.get(engineId) || null;
  }

  /**
   * Private constructor for an ML Engine.
   *
   * @param {object} config - The configuration object for the instance.
   * @param {object} config.mlEngineParent - The parent machine learning engine associated with this instance.
   * @param {object} config.pipelineOptions - The options for configuring the pipeline associated with this instance.
   * @param {?function(ProgressAndStatusCallbackParams):void} config.notificationsCallback - The initialization progress callback function to call.
   */
  constructor({ mlEngineParent, pipelineOptions, notificationsCallback }) {
    const engineId = pipelineOptions.engineId;
    this.events = {};
    this.engineId = engineId;
    MLEngine.#instances.set(engineId, this);
    this.mlEngineParent = mlEngineParent;
    this.pipelineOptions = pipelineOptions;
    this.notificationsCallback = notificationsCallback;
  }

  /**
   * Initialize the MLEngine.
   *
   * @param {object} config - The configuration object for the instance.
   * @param {object} config.mlEngineParent - The parent machine learning engine associated with this instance.
   * @param {object} config.pipelineOptions - The options for configuring the pipeline associated with this instance.
   * @param {?function(ProgressAndStatusCallbackParams):void} config.notificationsCallback - The initialization progress callback function to call.
   */
  static async initialize({
    mlEngineParent,
    pipelineOptions,
    notificationsCallback,
  }) {
    const mlEngine = new MLEngine({
      mlEngineParent,
      pipelineOptions,
      notificationsCallback,
    });

    await mlEngine.setupPortCommunication();

    // Delete previous model revisions.
    await mlEngine.mlEngineParent.deletePreviousModelRevisions();

    return mlEngine;
  }

  /**
   * Registers an event listener for the specified event.
   *
   * @param {string} event - The name of the event.
   * @param {Function} listener - The callback function to execute when the event is triggered.
   */
  on(event, listener) {
    if (!this.events[event]) {
      this.events[event] = [];
    }
    this.events[event].push(listener);
  }

  /**
   * Removes an event listener for the specified event.
   *
   * @param {string} event - The name of the event.
   * @param {Function} listenerToRemove - The callback function to remove.
   */
  off(event, listenerToRemove) {
    if (!this.events[event]) {
      return;
    }

    this.events[event] = this.events[event].filter(
      listener => listener !== listenerToRemove
    );
  }

  /**
   * Emits the specified event, invoking all registered listeners with the provided data.
   *
   * @param {string} event - The name of the event.
   * @param {*} data - The data to pass to the event listeners.
   */
  emit(event, data) {
    if (!this.events[event]) {
      return;
    }
    this.events[event].forEach(listener => listener(data));
  }

  /**
   * Sets the engine status and emits a statusChanged event.
   *
   * @param {"uninitialized" | "ready" | "error" | "closed"} status - The new status of the engine.
   */
  setEngineStatus(status) {
    this.engineStatus = status;
    this.emit("statusChanged", status);
  }

  /**
   * Create a MessageChannel to communicate with the engine directly.
   * And ensure the engine is fully initialized with all required files for the current model version downloaded.
   */
  async setupPortCommunication() {
    const { port1: childPort, port2: parentPort } = new MessageChannel();
    const transferables = [childPort];
    this.#port = parentPort;
    const newPortResolvers = Promise.withResolvers();
    this.#port.onmessage = message =>
      this.handlePortMessage(message, newPortResolvers);
    this.mlEngineParent.sendAsyncMessage(
      "MLEngine:NewPort",
      {
        port: childPort,
        pipelineOptions: this.pipelineOptions.getOptions(),
      },
      transferables
    );
    await newPortResolvers.promise;

    this.setEngineStatus("ready");
  }

  /**
   * Handles messages received from the port.
   *
   * @param {object} event - The message event.
   * @param {object} event.data - The data of the message event.
   * @param {object} newPortResolvers - An object containing a promise for mlEngine new port setup, along with two functions to resolve or reject it.
   */
  handlePortMessage = ({ data }, newPortResolvers) => {
    switch (data.type) {
      case "EnginePort:EngineReady": {
        if (data.error) {
          newPortResolvers.reject(data.error);
        } else {
          newPortResolvers.resolve();
        }

        break;
      }
      case "EnginePort:ModelRequest": {
        if (this.#port) {
          this.getModel().then(
            model => {
              this.#port.postMessage({
                type: "EnginePort:ModelResponse",
                model,
                error: null,
              });
            },
            error => {
              this.#port.postMessage({
                type: "EnginePort:ModelResponse",
                model: null,
                error,
              });
              if (
                // Ignore intentional errors in tests.
                !error?.message.startsWith("Intentionally")
              ) {
                lazy.console.error("Failed to get the model", error);
              }
            }
          );
        } else {
          lazy.console.error(
            "Expected a port to exist during the EnginePort:GetModel event"
          );
        }
        break;
      }
      case "EnginePort:RunResponse": {
        const { response, error, requestId } = data;
        const request = this.#requests.get(requestId);
        if (request) {
          if (response) {
            request.resolve(response);
          } else {
            request.reject(error);
          }
        } else {
          lazy.console.error(
            "Could not resolve response in the MLEngineParent",
            data
          );
        }
        this.#requests.delete(requestId);
        break;
      }
      case "EnginePort:EngineTerminated": {
        // The engine was terminated, and if a new run is needed a new port
        // will need to be requested.
        this.setEngineStatus("closed");
        this.discardPort();
        break;
      }
      case "EnginePort:InitProgress": {
        if (data.statusResponse.type === lazy.Progress.ProgressType.INFERENCE) {
          const requestId = data.statusResponse.metadata.requestId;
          const request = this.#requests.get(requestId);

          if (request) {
            if (data.statusResponse.ok) {
              request.resolveChunk?.(data.statusResponse);
            } else {
              request.rejectChunk?.(data.statusResponse);
            }
          } else {
            lazy.console.error(
              "Could not resolve response in the MLEngineParent",
              data.statusResponse
            );
          }
        }

        // TODO(aristide) Don't send the chunk data back to the callback
        this.notificationsCallback?.(data.statusResponse);
        break;
      }
      default:
        lazy.console.error("Unknown port message from engine", data);
        break;
    }
  };

  /**
   * Discards the current port and closes the connection.
   */
  discardPort() {
    if (this.#port) {
      this.#port.postMessage({ type: "EnginePort:Discard" });
      this.#port.close();
      this.#port = null;
    }
  }

  /**
   * Terminates the engine.
   *
   * @param {boolean} shutdown - Flag indicating whether to shutdown the engine.
   * @param {boolean} replacement - Flag indicating whether the engine is being replaced.
   * @returns {Promise<void>} A promise that resolves once the engine is terminated.
   */
  async terminate(shutdown, replacement) {
    if (this.#port) {
      this.#port.postMessage({
        type: "EnginePort:Terminate",
        shutdown,
        replacement,
      });
    }
    await this.#waitForStatus("closed");
  }

  /**
   * Waits for the engine to reach the desired status.
   *
   * @param {string} desiredStatus - The desired engine status.
   * @returns {Promise<string>} - A promise that resolves when the engine reaches the desired status.
   */

  #waitForStatus(desiredStatus) {
    return new Promise((resolve, reject) => {
      // Initial check in case the status is already the desired one
      if (this.engineStatus === desiredStatus) {
        resolve(`Engine status is now ${desiredStatus} `);
      }

      let onStatusChanged;

      // Set a timeout to reject the promise if the status doesn't change in time
      const timeoutId = lazy.setTimeout(() => {
        this.off("statusChanged", onStatusChanged);
        reject(
          `Timeout after ${TERMINATE_TIMEOUT} ms: Engine status did not reach ${desiredStatus} `
        );
      }, TERMINATE_TIMEOUT);

      onStatusChanged = status => {
        if (status === desiredStatus) {
          this.off("statusChanged", onStatusChanged);
          lazy.clearTimeout(timeoutId);
          resolve(`Engine status is now ${desiredStatus} `);
        }
      };

      this.on("statusChanged", onStatusChanged);
    });
  }

  /**
   * Run the inference request
   *
   * @param {Request} request
   * @returns {Promise<Response>}
   */
  run(request) {
    const resolvers = Promise.withResolvers();
    const requestId = this.#nextRequestId++;
    this.#requests.set(requestId, resolvers);

    let transferables = [];
    if (request.data instanceof ArrayBuffer) {
      transferables.push(request.data);
    }

    this.#port.postMessage(
      {
        type: "EnginePort:Run",
        requestId,
        request,
        engineRunOptions: { enableInferenceProgress: false },
      },
      transferables
    );
    return resolvers.promise;
  }

  /**
   * Run the inference request using an async generator function.
   *
   * @param {Request} request - The inference request containing the input data.
   * @returns {AsyncGenerator<Response, Response, unknown>} An async generator yielding chunks of generated responses.
   */
  runWithGenerator = async function* (request) {
    // Create a promise to track when the engine has fully completed all runs
    const responseChunkResolvers = new ResponseOrChunkResolvers();

    const requestId = this.#nextRequestId++;
    this.#requests.set(requestId, responseChunkResolvers);

    let completed = false;

    // Track when the engine is fully completed
    const completionPromise = responseChunkResolvers.promise.finally(
      results => {
        completed = true;
        return results;
      }
    );

    // Handle transferables for performance optimization
    const transferables = [];
    if (request.data instanceof ArrayBuffer) {
      transferables.push(request.data);
    }

    // Send the request to the engine via postMessage with optional transferables
    this.#port.postMessage(
      {
        type: "EnginePort:Run",
        requestId,
        request,
        engineRunOptions: { enableInferenceProgress: true },
      },
      transferables
    );

    const timeoutPromise = delay =>
      new Promise(resolve =>
        lazy.setTimeout(() => resolve({ timeout: true, ok: true }), delay)
      );

    let chunkPromise = responseChunkResolvers.getAndAdvanceChunkPromise();
    // Loop to yield chunks as they arrive
    while (true) {
      // Wait for the chunk with a timeout
      const chunk = await Promise.race([chunkPromise, timeoutPromise(10)]);

      // If there was no timeout we can yield the chunk and move to the next
      if (!chunk.timeout) {
        yield { text: chunk.metadata.text };
        chunkPromise = responseChunkResolvers.getAndAdvanceChunkPromise();
      }

      // Warn if the engine completed before receiving all chunks
      if (completed) {
        lazy.console.warn(
          "Warning: The run completed before the last chunk was received. The full output may not have been received."
        );
        break;
      }

      // Check if this is the last chunk or if an error occurred
      if (
        chunk.statusText === lazy.Progress.ProgressStatusText.DONE ||
        !chunk.ok
      ) {
        break;
      }
    }

    // Wait for the engine to fully complete before exiting
    return completionPromise;
  };
}
