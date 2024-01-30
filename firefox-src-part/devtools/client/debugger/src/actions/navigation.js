/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at <http://mozilla.org/MPL/2.0/>. */

import { clearDocuments } from "../utils/editor";
import sourceQueue from "../utils/source-queue";

import { clearWasmStates } from "../utils/wasm";
import { getMainThread, getThreadContext } from "../selectors";
import { evaluateExpressions } from "../actions/expressions";

/**
 * Redux actions for the navigation state
 * @module actions/navigation
 */

/**
 * @memberof actions/navigation
 * @static
 */
export function willNavigate(event) {
  return async function ({
    dispatch,
    getState,
    client,
    sourceMapLoader,
    parserWorker,
  }) {
    sourceQueue.clear();
    sourceMapLoader.clearSourceMaps();
    clearWasmStates();
    clearDocuments();
    parserWorker.clear();
    const thread = getMainThread(getState());

    dispatch({
      type: "NAVIGATE",
      mainThread: { ...thread, url: event.url },
    });
  };
}

/**
 * @memberof actions/navigation
 * @static
 */
export function navigated() {
  return async function ({ getState, dispatch, panel }) {
    try {
      // Update the watched expressions once the page is fully loaded
      const threadcx = getThreadContext(getState());
      await dispatch(evaluateExpressions(threadcx));
    } catch (e) {
      // This may throw if we resume during the page load.
      // browser_dbg-debugger-buttons.js highlights this, especially on MacOS or when ran many times
      console.error("Failed to update expression on navigation", e);
    }

    panel.emit("reloaded");
  };
}
