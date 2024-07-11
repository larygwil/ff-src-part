/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

import { MESSAGE_TYPE_HASH as msg } from "../modules/ActorConstants.mjs";

export const ASRouterUtils = {
  addListener(listener) {
    if (globalThis.ASRouterAddParentListener) {
      globalThis.ASRouterAddParentListener(listener);
    }
  },
  removeListener(listener) {
    if (globalThis.ASRouterRemoveParentListener) {
      globalThis.ASRouterRemoveParentListener(listener);
    }
  },
  sendMessage(action) {
    if (globalThis.ASRouterMessage) {
      return globalThis.ASRouterMessage(action);
    }
    throw new Error(`Unexpected call:\n${JSON.stringify(action, null, 3)}`);
  },
  blockById(id, options) {
    return ASRouterUtils.sendMessage({
      type: msg.BLOCK_MESSAGE_BY_ID,
      data: { id, ...options },
    });
  },
  modifyMessageJson(content) {
    return ASRouterUtils.sendMessage({
      type: msg.MODIFY_MESSAGE_JSON,
      data: { content },
    });
  },
  executeAction(button_action) {
    return ASRouterUtils.sendMessage({
      type: msg.USER_ACTION,
      data: button_action,
    });
  },
  unblockById(id) {
    return ASRouterUtils.sendMessage({
      type: msg.UNBLOCK_MESSAGE_BY_ID,
      data: { id },
    });
  },
  unblockAll() {
    return ASRouterUtils.sendMessage({
      type: msg.UNBLOCK_ALL,
    });
  },
  resetGroupImpressions() {
    return ASRouterUtils.sendMessage({
      type: msg.RESET_GROUPS_STATE,
    });
  },
  resetMessageImpressions() {
    return ASRouterUtils.sendMessage({
      type: msg.RESET_MESSAGE_STATE,
    });
  },
  resetScreenImpressions() {
    return ASRouterUtils.sendMessage({
      type: msg.RESET_SCREEN_IMPRESSIONS,
    });
  },
  blockBundle(bundle) {
    return ASRouterUtils.sendMessage({
      type: msg.BLOCK_BUNDLE,
      data: { bundle },
    });
  },
  unblockBundle(bundle) {
    return ASRouterUtils.sendMessage({
      type: msg.UNBLOCK_BUNDLE,
      data: { bundle },
    });
  },
  overrideMessage(id) {
    return ASRouterUtils.sendMessage({
      type: msg.OVERRIDE_MESSAGE,
      data: { id },
    });
  },
  editState(key, value) {
    return ASRouterUtils.sendMessage({
      type: msg.EDIT_STATE,
      data: { [key]: value },
    });
  },
  openPBWindow(content) {
    ASRouterUtils.sendMessage({
      type: "FORCE_PRIVATE_BROWSING_WINDOW",
      data: { message: { content } },
    });
  },
  sendTelemetry(ping) {
    return ASRouterUtils.sendMessage({
      type: msg.AS_ROUTER_TELEMETRY_USER_EVENT,
      data: ping,
    });
  },
  getPreviewEndpoint() {
    return null;
  },
};
