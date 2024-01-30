/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { WindowGlobalBiDiModule } from "chrome://remote/content/webdriver-bidi/modules/WindowGlobalBiDiModule.sys.mjs";

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  action: "chrome://remote/content/shared/webdriver/Actions.sys.mjs",
  deserialize: "chrome://remote/content/webdriver-bidi/RemoteValue.sys.mjs",
  element: "chrome://remote/content/marionette/element.sys.mjs",
  error: "chrome://remote/content/shared/webdriver/Errors.sys.mjs",
});

class InputModule extends WindowGlobalBiDiModule {
  #actionState;

  constructor(messageHandler) {
    super(messageHandler);

    this.#actionState = null;
  }

  destroy() {}

  async performActions(options) {
    const { actions } = options;
    if (this.#actionState === null) {
      this.#actionState = new lazy.action.State({
        specCompatPointerOrigin: true,
      });
    }

    await this.#deserializeActionOrigins(actions);
    const actionChain = lazy.action.Chain.fromJSON(this.#actionState, actions);
    await actionChain.dispatch(this.#actionState, this.messageHandler.window);
  }

  async releaseActions() {
    if (this.#actionState === null) {
      return;
    }
    await this.#actionState.release(this.messageHandler.window);
    this.#actionState = null;
  }

  /**
   * In the provided array of input.SourceActions, replace all origins matching
   * the input.ElementOrigin production with the Element corresponding to this
   * origin.
   *
   * Note that this method replaces the content of the `actions` in place, and
   * does not return a new array.
   *
   * @param {Array<input.SourceActions>} actions
   *     The array of SourceActions to deserialize.
   * @returns {Promise}
   *     A promise which resolves when all ElementOrigin origins have been
   *     deserialized.
   */
  async #deserializeActionOrigins(actions) {
    const promises = [];
    for (const actionsByTick of actions) {
      for (const action of actionsByTick.actions) {
        if (action.origin?.type === "element") {
          promises.push(
            (async () => {
              action.origin = await this.#getElementFromElementOrigin(
                action.origin
              );
            })()
          );
        }
      }
    }
    return Promise.all(promises);
  }

  async #getElementFromElementOrigin(origin) {
    const sharedReference = origin.element;
    if (typeof sharedReference?.sharedId !== "string") {
      throw new lazy.error.InvalidArgumentError(
        `Expected "origin.element" to be a SharedReference, got: ${sharedReference}`
      );
    }

    const realm = this.messageHandler.getRealm();

    const element = lazy.deserialize(realm, sharedReference, {
      nodeCache: this.nodeCache,
    });
    if (!lazy.element.isElement(element)) {
      throw new lazy.error.NoSuchElementError(
        `No element found for shared id: ${sharedReference.sharedId}`
      );
    }

    return element;
  }
}

export const input = InputModule;
