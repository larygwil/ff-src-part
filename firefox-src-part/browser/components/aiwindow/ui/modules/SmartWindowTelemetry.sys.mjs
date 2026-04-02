/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/* This singleton is for telemetry events that benefit from shared state management.
 * Simple events to be handled with inline Glean calls */

import { XPCOMUtils } from "resource://gre/modules/XPCOMUtils.sys.mjs";

const ONE_HOUR_MS = 60 * 60 * 1000;
const PREF_MODEL_CHOICE = "browser.smartwindow.firstrun.modelChoice";
const lazy = {};

XPCOMUtils.defineLazyPreferenceGetter(
  lazy,
  "modelChoice",
  PREF_MODEL_CHOICE,
  "",
  () => SmartWindowTelemetry.updateModelMetric()
);

ChromeUtils.defineESModuleGetters(lazy, {
  MODELS:
    "moz-src:///browser/components/aiwindow/ui/modules/AIWindowConstants.sys.mjs",
});

export const SmartWindowTelemetry = {
  _initialized: false,
  lastUriLoadTimestamp: 0,

  init() {
    if (this._initialized) {
      return;
    }
    this._initialized = true;

    this.updateModelMetric();
  },

  updateModelMetric() {
    const choice = lazy.modelChoice;
    const model = choice ? lazy.MODELS[choice]?.modelName : null;
    Glean.smartWindow.model.set(model ?? "unset");
  },

  recordUriLoad() {
    const now = Date.now();

    // Throttle to once per hour to capture activity at event time rather than
    // relying on daily metric submission, while avoiding duplicate events.
    if (now - this.lastUriLoadTimestamp < ONE_HOUR_MS) {
      return false;
    }

    this.lastUriLoadTimestamp = now;

    Glean.smartWindow.uriLoad.record({
      model: lazy.modelChoice === null ? "custom-model" : lazy.modelChoice,
    });

    return true;
  },
};
