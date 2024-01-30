/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const EXPORTED_SYMBOLS = ["browsingContext"];

const { XPCOMUtils } = ChromeUtils.import(
  "resource://gre/modules/XPCOMUtils.jsm"
);

XPCOMUtils.defineLazyModuleGetters(this, {
  Services: "resource://gre/modules/Services.jsm",

  AppInfo: "chrome://remote/content/marionette/appinfo.js",
  assert: "chrome://remote/content/shared/webdriver/Assert.jsm",
  BrowsingContextListener:
    "chrome://remote/content/shared/listeners/BrowsingContextListener.jsm",
  ContextDescriptorType:
    "chrome://remote/content/shared/messagehandler/MessageHandler.jsm",
  error: "chrome://remote/content/shared/webdriver/Errors.jsm",
  Log: "chrome://remote/content/shared/Log.jsm",
  Module: "chrome://remote/content/shared/messagehandler/Module.jsm",
  ProgressListener: "chrome://remote/content/shared/Navigate.jsm",
  TabManager: "chrome://remote/content/shared/TabManager.jsm",
  waitForInitialNavigationCompleted:
    "chrome://remote/content/shared/Navigate.jsm",
  WindowGlobalMessageHandler:
    "chrome://remote/content/shared/messagehandler/WindowGlobalMessageHandler.jsm",
  windowManager: "chrome://remote/content/shared/WindowManager.jsm",
});

XPCOMUtils.defineLazyGetter(this, "logger", () =>
  Log.get(Log.TYPES.WEBDRIVER_BIDI)
);

/**
 * @typedef {Object} CreateType
 **/

/**
 * Enum of types supported by the browsingContext.create command.
 *
 * @readonly
 * @enum {CreateType}
 **/
const CreateType = {
  tab: "tab",
  window: "window",
};

/**
 * @typedef {string} WaitCondition
 **/

/**
 * Wait conditions supported by WebDriver BiDi for navigation.
 *
 * @enum {WaitCondition}
 */
const WaitCondition = {
  None: "none",
  Interactive: "interactive",
  Complete: "complete",
};

class BrowsingContextModule extends Module {
  #contextListener;

  /**
   * Create a new module instance.
   *
   * @param {MessageHandler} messageHandler
   *     The MessageHandler instance which owns this Module instance.
   */
  constructor(messageHandler) {
    super(messageHandler);

    // Create the console-api listener and listen on "message" events.
    this.#contextListener = new BrowsingContextListener();
    this.#contextListener.on("attached", this.#onContextAttached);
  }

  destroy() {
    this.#contextListener.off("attached", this.#onContextAttached);
    this.#contextListener.destroy();
  }

  /**
   * Close the provided browsing context.
   *
   * @param {Object=} options
   * @param {string} context
   *     Id of the browsing context to close.
   *
   * @throws {NoSuchFrameError}
   *     If the browsing context cannot be found.
   * @throws {InvalidArgumentError}
   *     If the browsing context is not a top-level one.
   */
  close(options = {}) {
    const { context: contextId } = options;

    assert.string(
      contextId,
      `Expected "context" to be a string, got ${contextId}`
    );

    const context = TabManager.getBrowsingContextById(contextId);
    if (!context) {
      throw new error.NoSuchFrameError(
        `Browsing Context with id ${contextId} not found`
      );
    }

    if (context.parent) {
      throw new error.InvalidArgumentError(
        `Browsing Context with id ${contextId} is not top-level`
      );
    }

    if (TabManager.getTabCount() === 1) {
      // The behavior when closing the last tab is currently unspecified.
      // Warn the consumer about potential issues
      logger.warn(
        `Closing the last open tab (Browsing Context id ${contextId}), expect inconsistent behavior across platforms`
      );
    }

    const browser = context.embedderElement;
    const tabBrowser = TabManager.getTabBrowser(browser.ownerGlobal);
    const tab = tabBrowser.getTabForBrowser(browser);
    TabManager.removeTab(tab);
  }

  /**
   * Create a new browsing context using the provided type "tab" or "window".
   *
   * @param {Object=} options
   * @param {CreateType} options.type
   *     Type of browsing context to create.
   *
   * @throws {InvalidArgumentError}
   *     If the browsing context is not a top-level one.
   * @throws {NoSuchFrameError}
   *     If the browsing context cannot be found.
   */
  async create(options = {}) {
    const { type } = options;
    if (type !== CreateType.tab && type !== CreateType.window) {
      throw new error.InvalidArgumentError(
        `Expected "type" to be one of ${Object.values(CreateType)}, got ${type}`
      );
    }

    let browser;
    switch (type) {
      case "window":
        let newWindow = await windowManager.openBrowserWindow();
        browser = TabManager.getTabBrowser(newWindow).selectedBrowser;
        break;

      case "tab":
        if (!TabManager.supportsTabs()) {
          throw new error.UnsupportedOperationError(
            `browsingContext.create with type "tab" not supported in ${AppInfo.name}`
          );
        }
        let tab = await TabManager.addTab({ focus: false });
        browser = TabManager.getBrowserForTab(tab);
    }

    await waitForInitialNavigationCompleted(
      browser.browsingContext.webProgress
    );

    return {
      context: TabManager.getIdForBrowser(browser),
    };
  }

  /**
   * An object that holds the WebDriver Bidi browsing context information.
   *
   * @typedef BrowsingContextInfo
   *
   * @property {string} context
   *     The id of the browsing context.
   * @property {string=} parent
   *     The parent of the browsing context if it's the root browsing context
   *     of the to be processed browsing context tree.
   * @property {string} url
   *     The current documents location.
   * @property {Array<BrowsingContextInfo>=} children
   *     List of child browsing contexts. Only set if maxDepth hasn't been
   *     reached yet.
   */

  /**
   * An object that holds the WebDriver Bidi browsing context tree information.
   *
   * @typedef BrowsingContextGetTreeResult
   *
   * @property {Array<BrowsingContextInfo>} contexts
   *     List of child browsing contexts.
   */

  /**
   * Returns a tree of all browsing contexts that are descendents of the
   * given context, or all top-level contexts when no root is provided.
   *
   * @param {Object=} options
   * @param {number=} maxDepth
   *     Depth of the browsing context tree to traverse. If not specified
   *     the whole tree is returned.
   * @param {string=} root
   *     Id of the root browsing context.
   *
   * @returns {BrowsingContextGetTreeResult}
   *     Tree of browsing context information.
   * @throws {NoSuchFrameError}
   *     If the browsing context cannot be found.
   */
  getTree(options = {}) {
    const { maxDepth = null, root: rootId = null } = options;

    if (maxDepth !== null) {
      assert.positiveInteger(
        maxDepth,
        `Expected "maxDepth" to be a positive integer, got ${maxDepth}`
      );
    }

    let contexts;
    if (rootId !== null) {
      // With a root id specified return the context info for itself
      // and the full tree.
      assert.string(rootId, `Expected "root" to be a string, got ${rootId}`);
      contexts = [this.#getBrowsingContext(rootId)];
    } else {
      // Return all top-level browsing contexts.
      contexts = TabManager.browsers.map(browser => browser.browsingContext);
    }

    const contextsInfo = contexts.map(context => {
      return this.#getBrowsingContextInfo(context, { maxDepth });
    });

    return { contexts: contextsInfo };
  }

  /**
   * An object that holds the WebDriver Bidi navigation information.
   *
   * @typedef BrowsingContextNavigateResult
   *
   * @property {String} navigation
   *     Unique id for this navigation.
   * @property {String} url
   *     The requested or reached URL.
   */

  /**
   * Navigate the given context to the provided url, with the provided wait condition.
   *
   * @param {Object=} options
   * @param {string} context
   *     Id of the browsing context to navigate.
   * @param {string} url
   *     Url for the navigation.
   * @param {WaitCondition=} wait
   *     Wait condition for the navigation, one of "none", "interactive", "complete".
   *
   * @returns {BrowsingContextNavigateResult}
   *     Navigation result.
   * @throws {InvalidArgumentError}
   *     Raised if an argument is of an invalid type or value.
   * @throws {NoSuchFrameError}
   *     If the browsing context for contextId cannot be found.
   */
  async navigate(options = {}) {
    const { context: contextId, url, wait = WaitCondition.None } = options;

    assert.string(
      contextId,
      `Expected "context" to be a string, got ${contextId}`
    );

    assert.string(url, `Expected "url" to be string, got ${url}`);

    const waitConditions = Object.values(WaitCondition);
    if (!waitConditions.includes(wait)) {
      throw new error.InvalidArgumentError(
        `Expected "wait" to be one of ${waitConditions}, got ${wait}`
      );
    }

    const context = this.#getBrowsingContext(contextId);

    // webProgress will be stable even if the context navigates, retrieve it
    // immediately before doing any asynchronous call.
    const webProgress = context.webProgress;

    const base = await this.messageHandler.handleCommand({
      moduleName: "browsingContext",
      commandName: "_getBaseURL",
      destination: {
        type: WindowGlobalMessageHandler.type,
        id: context.id,
      },
    });

    let targetURI;
    try {
      const baseURI = Services.io.newURI(base);
      targetURI = Services.io.newURI(url, null, baseURI);
    } catch (e) {
      throw new error.InvalidArgumentError(
        `Expected "url" to be a valid URL (${e.message})`
      );
    }

    return this.#awaitNavigation(webProgress, targetURI, {
      wait,
    });
  }

  /**
   * Start and await a navigation on the provided BrowsingContext. Returns a
   * promise which resolves when the navigation is done according to the provided
   * navigation strategy.
   *
   * @param {WebProgress} webProgress
   *     The WebProgress instance to observe for this navigation.
   * @param {nsIURI} targetURI
   *     The URI to navigate to.
   * @param {Object} options
   * @param {WaitCondition} options.wait
   *     The WaitCondition to use to wait for the navigation.
   */
  async #awaitNavigation(webProgress, targetURI, options) {
    const { wait } = options;

    const context = webProgress.browsingContext;
    const browserId = context.browserId;

    const resolveWhenStarted = wait === WaitCondition.None;
    const listener = new ProgressListener(webProgress, {
      expectNavigation: true,
      resolveWhenStarted,
      // In case the webprogress is already navigating, always wait for an
      // explicit start flag.
      waitForExplicitStart: true,
    });

    const onDOMContentLoadedEvent = (evtName, wrappedEvt) => {
      if (webProgress.browsingContext.id !== wrappedEvt.contextId) {
        // Ignore load events for unrelated browsing contexts.
        return;
      }

      if (wrappedEvt.readyState === "interactive") {
        listener.stop();
      }
    };

    const contextDescriptor = {
      type: ContextDescriptorType.TopBrowsingContext,
      id: browserId,
    };

    // Monitor DOMContentLoaded for the Interactive wait condition, to resolve
    // as soon as the document becomes interactive.
    if (wait === WaitCondition.Interactive) {
      await this.messageHandler.eventsDispatcher.on(
        "browsingContext.DOMContentLoaded",
        contextDescriptor,
        onDOMContentLoadedEvent
      );
    }

    const navigated = listener.start();
    navigated.finally(async () => {
      if (listener.isStarted) {
        listener.stop();
      }

      if (wait === WaitCondition.Interactive) {
        await this.messageHandler.eventsDispatcher.off(
          "browsingContext.DOMContentLoaded",
          contextDescriptor,
          onDOMContentLoadedEvent
        );
      }
    });

    context.loadURI(targetURI.spec, {
      loadFlags: Ci.nsIWebNavigation.LOAD_FLAGS_IS_LINK,
      triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
      hasValidUserGestureActivation: true,
    });
    await navigated;

    let url;
    if (wait === WaitCondition.None) {
      // If wait condition is None, the navigation resolved before the current
      // context has navigated.
      url = listener.targetURI.spec;
    } else {
      url = listener.currentURI.spec;
    }

    return {
      // TODO: The navigation id should be a real id mapped to the navigation.
      // See https://bugzilla.mozilla.org/show_bug.cgi?id=1763122
      navigation: null,
      url,
    };
  }

  /**
   * Retrieves a browsing context based on its id.
   *
   * @param {Number} contextId
   *     Id of the browsing context.
   * @returns {BrowsingContext=}
   *     The browsing context or null if <var>contextId</var> is null.
   * @throws {NoSuchFrameError}
   *     If the browsing context cannot be found.
   */
  #getBrowsingContext(contextId) {
    // The WebDriver BiDi specification expects null to be
    // returned if no browsing context id has been specified.
    if (contextId === null) {
      return null;
    }

    const context = TabManager.getBrowsingContextById(contextId);
    if (context === null) {
      throw new error.NoSuchFrameError(
        `Browsing Context with id ${contextId} not found`
      );
    }

    return context;
  }

  /**
   * Get the WebDriver BiDi browsing context information.
   *
   * @param {BrowsingContext} context
   *     The browsing context to get the information from.
   * @param {Object=} options
   * @param {boolean=} isRoot
   *     Flag that indicates if this browsing context is the root of all the
   *     browsing contexts to be returned. Defaults to true.
   * @param {number=} maxDepth
   *     Depth of the browsing context tree to traverse. If not specified
   *     the whole tree is returned.
   * @returns {BrowsingContextInfo}
   *     The information about the browsing context.
   */
  #getBrowsingContextInfo(context, options = {}) {
    const { isRoot = true, maxDepth = null } = options;

    let children = null;
    if (maxDepth === null || maxDepth > 0) {
      children = context.children.map(context =>
        this.#getBrowsingContextInfo(context, {
          maxDepth: maxDepth === null ? maxDepth : maxDepth - 1,
          isRoot: false,
        })
      );
    }

    const contextInfo = {
      context: TabManager.getIdForBrowsingContext(context),
      url: context.currentURI.spec,
      children,
    };

    if (isRoot) {
      // Only emit the parent id for the top-most browsing context.
      const parentId = TabManager.getIdForBrowsingContext(context.parent);
      contextInfo.parent = parentId;
    }

    return contextInfo;
  }

  #onContextAttached = async (eventName, data = {}) => {
    const { browsingContext, why } = data;

    // Filter out top-level browsing contexts that are created because of a
    // cross-group navigation.
    if (why === "replace") {
      return;
    }

    // Filter out notifications for chrome context until support gets
    // added (bug 1722679).
    if (!browsingContext.webProgress) {
      return;
    }

    const contextInfo = this.#getBrowsingContextInfo(browsingContext, {
      maxDepth: 0,
    });
    this.emitProtocolEvent("browsingContext.contextCreated", contextInfo);
  };

  /**
   * Internal commands
   */

  _subscribeEvent(params) {
    // TODO: Bug 1741861. Move this logic to a shared module or the an abstract
    // class.
    switch (params.event) {
      case "browsingContext.contextCreated":
        this.#contextListener.startListening();

        return this.messageHandler.addSessionData({
          moduleName: "browsingContext",
          category: "event",
          contextDescriptor: {
            type: ContextDescriptorType.All,
          },
          values: [params.event],
        });
      default:
        throw new Error(
          `Unsupported event for browsingContext module ${params.event}`
        );
    }
  }

  _unsubscribeEvent(params) {
    switch (params.event) {
      case "browsingContext.contextCreated":
        this.#contextListener.stopListening();

        return this.messageHandler.removeSessionData({
          moduleName: "browsingContext",
          category: "event",
          contextDescriptor: {
            type: ContextDescriptorType.All,
          },
          values: [params.event],
        });
      default:
        throw new Error(
          `Unsupported event for browsingContext module ${params.event}`
        );
    }
  }

  static get supportedEvents() {
    return ["browsingContext.contextCreated"];
  }
}

const browsingContext = BrowsingContextModule;
