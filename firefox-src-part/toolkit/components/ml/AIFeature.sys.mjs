/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Base class for AI features in Firefox.
 * Each feature manages its own preferences and artifacts.
 *
 * @interface
 */
export class AIFeature {
  /**
   * Feature identifier (e.g., "linkpreview", "translations").
   *
   * @returns {string} The feature identifier.
   */
  static get id() {
    throw new Error("AIFeature subclass must implement static get id()");
  }

  /**
   * Enable the feature by setting its preference,
   * which typically triggers observers that handle:
   * - Setting up event listeners
   * - Downloading required models/artifacts
   * - Updating telemetry
   *
   * @returns {Promise<void>} Resolves when enable process completes
   */
  static async enable() {
    throw new Error("AIFeature subclass must implement static enable()");
  }

  /**
   * Disable the feature by clearing its preference,
   * which typically triggers observers that handle:
   * - Removing event listeners
   * - Deleting downloaded models/artifacts
   * - Updating telemetry
   *
   * @returns {Promise<void>} Resolves when disable process (including cleanup) completes
   */
  static async disable() {
    throw new Error("AIFeature subclass must implement static disable()");
  }

  /**
   * Check if the feature is enabled.
   *
   * @returns {boolean} True if enabled, false otherwise.
   */
  static get isEnabled() {
    throw new Error("AIFeature subclass must implement static get isEnabled()");
  }

  /**
   * Check if the feature is allowed to be enabled.
   * This determines whether a feature could ever be enabled based on
   * environmental factors like locale, platform, or other prerequisites.
   * This differs from isEnabled - isAllowed checks if enabling is possible,
   * while isEnabled checks if it's currently enabled.
   *
   * Use this to conditionally show/hide feature sections in Settings UI
   * when the feature cannot be used regardless of user preference.
   *
   * @returns {boolean} True if the feature can be enabled, false otherwise.
   */
  static get isAllowed() {
    throw new Error("AIFeature subclass must implement static get isAllowed()");
  }
}
