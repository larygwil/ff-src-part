/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Module } from "chrome://remote/content/shared/messagehandler/Module.sys.mjs";

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  assert: "chrome://remote/content/shared/webdriver/Assert.sys.mjs",
  error: "chrome://remote/content/shared/webdriver/Errors.sys.mjs",
  permissions: "chrome://remote/content/shared/Permissions.sys.mjs",
});

export const PermissionState = {
  denied: "denied",
  granted: "granted",
  prompt: "prompt",
};

class PermissionsModule extends Module {
  constructor(messageHandler) {
    super(messageHandler);
  }

  destroy() {}

  /**
   * An object that holds the information about permission descriptor
   * for Webdriver BiDi permissions.setPermission command.
   *
   * @typedef PermissionDescriptor
   *
   * @property {string} name
   *    The name of the permission.
   */

  /**
   * Set to a given permission descriptor a given state on a provided origin.
   *
   * @param {object=} options
   * @param {PermissionDescriptor} options.descriptor
   *     The descriptor of the permission which will be updated.
   * @param {PermissionState} options.state
   *     The state which will be set to the permission.
   * @param {string} options.origin
   *    The origin which is used as a target for permission update.
   * @param {string=} options.userContext [unsupported]
   *    The id of the user context which should be used as a target
   *    for permission update.
   *
   * @throws {InvalidArgumentError}
   *     Raised if an argument is of an invalid type or value.
   * @throws {UnsupportedOperationError}
   *     Raised when unsupported permissions are set or <var>userContext</var>
   *     argument is used.
   */
  async setPermission(options = {}) {
    const {
      descriptor,
      state,
      origin,
      userContext: userContextId = null,
    } = options;

    lazy.assert.object(
      descriptor,
      `Expected "descriptor" to be an object, got ${descriptor}`
    );
    const permissionName = descriptor.name;
    lazy.assert.string(
      permissionName,
      `Expected "descriptor.name" to be a string, got ${permissionName}`
    );

    lazy.permissions.validatePermission(permissionName);

    // Bug 1878741: Allowing this permission causes timing related Android crash.
    if (descriptor.name === "notifications") {
      if (Services.prefs.getBoolPref("notification.prompt.testing", false)) {
        // Okay, do nothing. The notifications module will work without permission.
        return;
      }
      throw new lazy.error.UnsupportedOperationError(
        `Setting "descriptor.name" "notifications" expected "notification.prompt.testing" preference to be set`
      );
    }

    if (permissionName === "storage-access") {
      // TODO: Bug 1895457. Add support for "storage-access" permission.
      throw new lazy.error.UnsupportedOperationError(
        `"descriptor.name" "${permissionName}" is currently unsupported`
      );
    }

    const permissionStateTypes = Object.keys(PermissionState);
    lazy.assert.that(
      state => permissionStateTypes.includes(state),
      `Expected "state" to be one of ${permissionStateTypes}, got ${state}`
    )(state);

    lazy.assert.string(
      origin,
      `Expected "origin" to be a string, got ${origin}`
    );
    lazy.assert.that(
      origin => URL.canParse(origin),
      `Expected "origin" to be a valid URL, got ${origin}`
    )(origin);

    if (userContextId !== null) {
      lazy.assert.string(
        userContextId,
        `Expected "userContext" to be a string, got ${userContextId}`
      );

      // TODO: Bug 1894217. Add support for "userContext" argument.
      throw new lazy.error.UnsupportedOperationError(
        `"userContext" is not supported yet`
      );
    }

    const activeWindow = Services.wm.getMostRecentBrowserWindow();
    let typedDescriptor;
    try {
      typedDescriptor = activeWindow.navigator.permissions.parseSetParameters({
        descriptor,
        state,
      });
    } catch (err) {
      throw new lazy.error.InvalidArgumentError(
        `The conversion of "descriptor" was not successful: ${err.message}`
      );
    }

    lazy.permissions.set(typedDescriptor, state, origin);
  }
}

export const permissions = PermissionsModule;
