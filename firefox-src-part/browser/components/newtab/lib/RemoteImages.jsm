/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
"use strict";

const { JSONFile } = ChromeUtils.import("resource://gre/modules/JSONFile.jsm");
const { PromiseUtils } = ChromeUtils.import(
  "resource://gre/modules/PromiseUtils.jsm"
);
const { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");

ChromeUtils.defineModuleGetter(
  this,
  "Downloader",
  "resource://services-settings/Attachments.jsm"
);

ChromeUtils.defineModuleGetter(
  this,
  "KintoHttpClient",
  "resource://services-common/kinto-http-client.js"
);

ChromeUtils.defineModuleGetter(
  this,
  "Utils",
  "resource://services-settings/Utils.jsm"
);

const RS_MAIN_BUCKET = "main";
const RS_COLLECTION = "ms-images";
const RS_DOWNLOAD_MAX_RETRIES = 2;

const REMOTE_IMAGES_PATH = PathUtils.join(
  PathUtils.localProfileDir,
  "settings",
  RS_MAIN_BUCKET,
  RS_COLLECTION
);
const REMOTE_IMAGES_DB_PATH = PathUtils.join(REMOTE_IMAGES_PATH, "db.json");

const CLEANUP_FINISHED_TOPIC = "remote-images:cleanup-finished";

const IMAGE_EXPIRY_DURATION = 30 * 24 * 60 * 60; // 30 days in seconds.

class _RemoteImages {
  #dbPromise;

  constructor() {
    this.#dbPromise = null;

    // Piggy back off of RemoteSettings timer, triggering image cleanup every
    // 24h.
    Services.obs.addObserver(
      () => this.#cleanup(),
      "remote-settings:changes-poll-end"
    );

    // Ensure we migrate all our images to a JSONFile database.
    this.withDb(() => {});
  }

  /**
   * Load the database from disk.
   *
   * If the database does not yet exist, attempt a migration from legacy Remote
   * Images (i.e., image files in |REMOTE_IMAGES_PATH|).
   *
   * @returns {Promise<JSONFile>} A promise that resolves with the database
   *                              instance.
   */
  async #loadDB() {
    let db;

    if (!(await IOUtils.exists(REMOTE_IMAGES_DB_PATH))) {
      db = await this.#migrate();
    } else {
      db = new JSONFile({ path: REMOTE_IMAGES_DB_PATH });
      await db.load();
    }

    return db;
  }

  /**
   * Reset the RemoteImages database
   *
   * NB: This is only meant to be used by unit tests.
   *
   * @returns {Promise<void>} A promise that resolves when the database has been
   *                          reset.
   */
  reset() {
    return this.withDb(async db => {
      await db._save();
      this.#dbPromise = null;
    });
  }

  /**
   * Execute |fn| with the RemoteSettings database.
   *
   * This ensures that only one caller can have a handle to the database at any
   * given time (unless it is leaked through assignment from within |fn|). This
   * prevents re-entrancy issues with multiple calls to cleanup() and calling
   * cleanup while loading images.
   *
   * @param fn The function to call with the database.
   */
  async withDb(fn) {
    const dbPromise = this.#dbPromise ?? this.#loadDB();

    const { resolve, promise } = PromiseUtils.defer();
    // NB: Update |#dbPromise| before awaiting anything so that the next call to
    //     |withDb()| will see the new value of |#dbPromise|.
    this.#dbPromise = promise;

    const db = await dbPromise;

    try {
      return await fn(db);
    } finally {
      resolve(db);
    }
  }

  /**
   * Patch a reference to a remote image in a message with a blob URL.
   *
   * @param message     The remote image reference to be patched.
   * @param replaceWith The property name that will be used to store the blob
   *                    URL on |message|.
   *
   * @return A promise that resolves with an unloading function for the patched
   *         URL, or rejects with an error.
   *
   *         If the message isn't patched (because there isn't a remote image)
   *         then the promise will resolve to null.
   */
  async patchMessage(message, replaceWith = "imageURL") {
    try {
      if (!!message && !!message.imageId) {
        const { imageId } = message;
        const blobURL = await this.load(imageId);

        delete message.imageId;

        message[replaceWith] = blobURL;

        return () => this.unload(blobURL);
      }
      return null;
    } catch (e) {
      Cu.reportError(
        `RemoteImages Could not patch message with imageId "${message.imageId}": ${e}`
      );
      return null;
    }
  }

  /**
   * Load a remote image.
   *
   * If the image has not been previously downloaded then the image will be
   * downloaded from RemoteSettings.
   *
   * @param imageId  The unique image ID.
   *
   * @throws This method throws if the image cannot be loaded.
   *
   * @returns A promise that resolves with a blob URL for the given image, or
   *          rejects with an error.
   *
   *          After the caller is finished with the image, they must call
   *         |RemoteImages.unload()| on the returned URL.
   */
  load(imageId) {
    return this.withDb(async db => {
      const recordId = this.#getRecordId(imageId);

      let blob;
      if (db.data.images[recordId]) {
        // We have previously fetched this image, we can load it from disk.
        try {
          blob = await this.#readFromDisk(db, recordId);
        } catch (e) {
          if (
            !(
              e instanceof Components.Exception &&
              e.name === "NS_ERROR_FILE_NOT_FOUND"
            )
          ) {
            throw e;
          }
        }

        // Fall back to downloading if we cannot read it from disk.
      }

      if (typeof blob === "undefined") {
        blob = await this.#download(db, recordId);
      }

      return URL.createObjectURL(blob);
    });
  }

  /**
   * Unload a URL returned by RemoteImages
   *
   * @param url The URL to unload.
   **/
  unload(url) {
    URL.revokeObjectURL(url);
  }

  /**
   * Clean up all files that haven't been touched in 30d.
   *
   * @returns {Promise<undefined>} A promise that resolves once cleanup has
   *                               finished.
   */
  #cleanup() {
    return this.withDb(async db => {
      const now = Date.now();
      await Promise.all(
        Object.values(db.data.images)
          .filter(entry => now - entry.lastLoaded >= IMAGE_EXPIRY_DURATION)
          .map(entry => {
            const path = PathUtils.join(REMOTE_IMAGES_PATH, entry.recordId);
            delete db.data.images[entry.recordId];

            return IOUtils.remove(path).catch(e => {
              Cu.reportError(
                `Could not remove remote image ${entry.recordId}: ${e}`
              );
            });
          })
      );

      db.saveSoon();

      Services.obs.notifyObservers(null, CLEANUP_FINISHED_TOPIC);
    });
  }

  /**
   * Return the record ID from an image ID.
   *
   * Prior to Firefox 101, imageIds were of the form ${recordId}.${extension} so
   * that we could infer the mimetype.
   *
   * @returns The RemoteSettings record ID.
   */
  #getRecordId(imageId) {
    const idx = imageId.lastIndexOf(".");
    if (idx === -1) {
      return imageId;
    }
    return imageId.substring(0, idx);
  }

  /**
   * Read the image from disk
   *
   * @param {JSONFile} db The RemoteImages database.
   * @param {string} recordId The record ID of the image.
   *
   * @returns A promise that resolves to a blob, or rejects with an Error.
   */
  async #readFromDisk(db, recordId) {
    const path = PathUtils.join(REMOTE_IMAGES_PATH, recordId);

    try {
      const blob = await File.createFromFileName(path, {
        type: db.data.images[recordId].mimetype,
      });
      db.data.images[recordId].lastLoaded = Date.now();

      return blob;
    } catch (e) {
      // If we cannot read the file from disk, delete the entry.
      delete db.data.images[recordId];

      throw e;
    } finally {
      db.saveSoon();
    }
  }

  /**
   * Download an image from RemoteSettings.
   *
   * @param {JSONFile} db The RemoteImages database.
   * @param {string} recordId The record ID of the image.
   *
   * @returns A promise that resolves with a Blob of the image data or rejects
   *          with an Error.
   */
  async #download(db, recordId) {
    const client = new KintoHttpClient(Utils.SERVER_URL);
    const record = await client
      .bucket(RS_MAIN_BUCKET)
      .collection(RS_COLLECTION)
      .getRecord(recordId);

    const downloader = new Downloader(RS_MAIN_BUCKET, RS_COLLECTION);

    const arrayBuffer = await downloader.downloadAsBytes(record.data, {
      retries: RS_DOWNLOAD_MAX_RETRIES,
    });

    // Cache to disk.
    const path = PathUtils.join(REMOTE_IMAGES_PATH, recordId);

    // We do not await this promise because any other attempt to interact with
    // the file via IOUtils will have to synchronize via the IOUtils event queue
    // anyway.
    IOUtils.write(path, new Uint8Array(arrayBuffer));

    db.data.images[recordId] = {
      recordId,
      mimetype: record.data.attachment.mimetype,
      hash: record.data.attachment.hash,
      lastLoaded: Date.now(),
    };

    db.saveSoon();

    return new Blob([arrayBuffer], { type: record.data.attachment.mimetype });
  }

  /**
   * Migrate from a file-based store to an index-based store.
   */
  async #migrate() {
    let children;
    try {
      children = await IOUtils.getChildren(REMOTE_IMAGES_PATH);

      // Delete all previously cached entries.
      await Promise.all(
        children.map(async path => {
          try {
            await IOUtils.remove(path);
          } catch (e) {
            Cu.reportError(`RemoteImages could not delete ${path}: ${e}`);
          }
        })
      );
    } catch (e) {
      if (!(DOMException.isInstance(e) && e.name === "NotFoundError")) {
        throw e;
      }
    }

    await IOUtils.makeDirectory(REMOTE_IMAGES_PATH);
    const db = new JSONFile({ path: REMOTE_IMAGES_DB_PATH });
    db.data = {
      version: 1,
      images: {},
    };
    db.saveSoon();
    return db;
  }
}

const RemoteImages = new _RemoteImages();

const EXPORTED_SYMBOLS = [
  "RemoteImages",
  "REMOTE_IMAGES_PATH",
  "REMOTE_IMAGES_DB_PATH",
];
