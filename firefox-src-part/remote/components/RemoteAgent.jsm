/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

var EXPORTED_SYMBOLS = ["RemoteAgent", "RemoteAgentFactory"];

const { XPCOMUtils } = ChromeUtils.import(
  "resource://gre/modules/XPCOMUtils.jsm"
);

XPCOMUtils.defineLazyModuleGetters(this, {
  Services: "resource://gre/modules/Services.jsm",

  CDP: "chrome://remote/content/cdp/CDP.jsm",
  Deferred: "chrome://remote/content/shared/Sync.jsm",
  HttpServer: "chrome://remote/content/server/HTTPD.jsm",
  Log: "chrome://remote/content/shared/Log.jsm",
  WebDriverBiDi: "chrome://remote/content/webdriver-bidi/WebDriverBiDi.jsm",
});

XPCOMUtils.defineLazyGetter(this, "logger", () => Log.get());

XPCOMUtils.defineLazyGetter(this, "activeProtocols", () => {
  const protocols = Services.prefs.getIntPref("remote.active-protocols");
  if (protocols < 1 || protocols > 3) {
    throw Error(`Invalid remote protocol identifier: ${protocols}`);
  }

  return protocols;
});

const WEBDRIVER_BIDI_ACTIVE = 0x1;
const CDP_ACTIVE = 0x2;

const DEFAULT_PORT = 9222;
// By default force local connections only
const LOOPBACKS = ["localhost", "127.0.0.1", "[::1]"];

const isRemote =
  Services.appinfo.processType == Services.appinfo.PROCESS_TYPE_CONTENT;

class RemoteAgentParentProcess {
  #allowHosts;
  #allowOrigins;
  #browserStartupFinished;
  #classID;
  #enabled;
  #port;
  #server;

  #cdp;
  #webDriverBiDi;

  constructor() {
    this.#allowHosts = null;
    this.#allowOrigins = null;
    this.#browserStartupFinished = Deferred();
    this.#classID = Components.ID("{8f685a9d-8181-46d6-a71d-869289099c6d}");
    this.#enabled = false;
    this.#port = DEFAULT_PORT;
    this.#server = null;

    // Supported protocols
    this.#cdp = null;
    this.#webDriverBiDi = null;

    Services.ppmm.addMessageListener("RemoteAgent:IsRunning", this);
  }

  get allowHosts() {
    if (this.#allowHosts !== null) {
      return this.#allowHosts;
    }

    if (this.server) {
      // If the server is bound to a hostname, not an IP address, return it as
      // allowed host.
      const hostUri = Services.io.newURI(`https://${this.host}`);
      if (!this.#isIPAddress(hostUri)) {
        return [RemoteAgent.host];
      }

      // Following Bug 1220810 localhost is guaranteed to resolve to a loopback
      // address (127.0.0.1 or ::1) unless network.proxy.allow_hijacking_localhost
      // is set to true, which should not be the case.
      const loopbackAddresses = ["127.0.0.1", "[::1]"];

      // If the server is bound to an IP address and this IP address is a localhost
      // loopback address, return localhost as allowed host.
      if (loopbackAddresses.includes(this.host)) {
        return ["localhost"];
      }
    }

    // Otherwise return an empty array.
    return [];
  }

  get allowOrigins() {
    return this.#allowOrigins;
  }

  /**
   * A promise that resolves when the initial application window has been opened.
   *
   * @returns {Promise}
   *     Promise that resolves when the initial application window is open.
   */
  get browserStartupFinished() {
    return this.#browserStartupFinished.promise;
  }

  get cdp() {
    return this.#cdp;
  }

  get debuggerAddress() {
    if (!this.server) {
      return "";
    }

    return `${this.host}:${this.port}`;
  }

  get enabled() {
    return this.#enabled;
  }

  get host() {
    // Bug 1675471: When using the nsIRemoteAgent interface the HTTPd server's
    // primary identity ("this.server.identity.primaryHost") is lazily set.
    return this.server?._host;
  }

  get running() {
    return !!this.server && !this.server.isStopped();
  }

  get port() {
    // Bug 1675471: When using the nsIRemoteAgent interface the HTTPd server's
    // primary identity ("this.server.identity.primaryPort") is lazily set.
    return this.server?._port;
  }

  get scheme() {
    return this.server?.identity.primaryScheme;
  }

  get server() {
    return this.#server;
  }

  get webDriverBiDi() {
    return this.#webDriverBiDi;
  }

  /**
   * Check if the provided URI's host is an IP address.
   *
   * @param {nsIURI} uri
   *     The URI to check.
   * @return {boolean}
   */
  #isIPAddress(uri) {
    try {
      // getBaseDomain throws an explicit error if the uri host is an IP address.
      Services.eTLD.getBaseDomain(uri);
    } catch (e) {
      return e.result == Cr.NS_ERROR_HOST_IS_IP_ADDRESS;
    }
    return false;
  }

  handle(cmdLine) {
    // remote-debugging-port has to be consumed in nsICommandLineHandler:handle
    // to avoid issues on macos. See Marionette.jsm::handle() for more details.
    // TODO: remove after Bug 1724251 is fixed.
    try {
      cmdLine.handleFlagWithParam("remote-debugging-port", false);
    } catch (e) {
      cmdLine.handleFlag("remote-debugging-port", false);
    }
  }

  async #listen(url) {
    if (Services.appinfo.processType != Ci.nsIXULRuntime.PROCESS_TYPE_DEFAULT) {
      throw Components.Exception(
        "May only be instantiated in parent process",
        Cr.NS_ERROR_LAUNCHED_CHILD_PROCESS
      );
    }

    if (this.running) {
      return;
    }

    if (!(url instanceof Ci.nsIURI)) {
      url = Services.io.newURI(url);
    }

    let { host, port } = url;
    if (!LOOPBACKS.includes(host)) {
      throw Components.Exception(
        "Restricted to loopback devices",
        Cr.NS_ERROR_ILLEGAL_VALUE
      );
    }

    // nsIServerSocket uses -1 for atomic port allocation
    if (port === 0) {
      port = -1;
    }

    try {
      this.#server = new HttpServer();
      this.server._start(port, host);

      Services.obs.notifyObservers(null, "remote-listening", true);

      await Promise.all([this.webDriverBiDi?.start(), this.cdp?.start()]);
    } catch (e) {
      await this.#stop();
      logger.error(`Unable to start remote agent: ${e.message}`, e);
    }
  }

  async #stop() {
    if (!this.running) {
      return;
    }

    try {
      // Stop the CDP support before stopping the server.
      // Otherwise the HTTP server will fail to stop.
      await this.cdp?.stop();
      await this.webDriverBiDi?.stop();

      await this.server.stop();
      this.#server = null;
      Services.obs.notifyObservers(null, "remote-listening");
    } catch (e) {
      // this function must never fail
      logger.error("unable to stop listener", e);
    }
  }

  /**
   * Handle the --remote-debugging-port command line argument.
   *
   * @param {nsICommandLine} cmdLine
   *     Instance of the command line interface.
   *
   * @return {boolean}
   *     Return `true` if the command line argument has been found.
   */
  handleRemoteDebuggingPortFlag(cmdLine) {
    let enabled = false;

    try {
      // Catch cases when the argument, and a port have been specified.
      const port = cmdLine.handleFlagWithParam("remote-debugging-port", false);
      if (port !== null) {
        enabled = true;

        // In case of an invalid port keep the default port
        const parsed = Number(port);
        if (!isNaN(parsed)) {
          this.#port = parsed;
        }
      }
    } catch (e) {
      // If no port has been given check for the existence of the argument.
      enabled = cmdLine.handleFlag("remote-debugging-port", false);
    }

    return enabled;
  }

  handleAllowHostsFlag(cmdLine) {
    try {
      const hosts = cmdLine.handleFlagWithParam("remote-allow-hosts", false);
      return hosts.split(",");
    } catch (e) {
      return null;
    }
  }

  handleAllowOriginsFlag(cmdLine) {
    try {
      const origins = cmdLine.handleFlagWithParam(
        "remote-allow-origins",
        false
      );
      return origins.split(",");
    } catch (e) {
      return null;
    }
  }

  async observe(subject, topic) {
    if (this.enabled) {
      logger.trace(`Received observer notification ${topic}`);
    }

    switch (topic) {
      case "profile-after-change":
        Services.obs.addObserver(this, "command-line-startup");
        break;

      case "command-line-startup":
        Services.obs.removeObserver(this, topic);

        this.#enabled = this.handleRemoteDebuggingPortFlag(subject);

        if (this.enabled) {
          Services.obs.addObserver(this, "final-ui-startup");

          this.#allowHosts = this.handleAllowHostsFlag(subject);
          this.#allowOrigins = this.handleAllowOriginsFlag(subject);

          Services.obs.addObserver(this, "browser-idle-startup-tasks-finished");
          Services.obs.addObserver(this, "mail-idle-startup-tasks-finished");
          Services.obs.addObserver(this, "quit-application");

          // With Bug 1717899 we will extend the lifetime of the Remote Agent to
          // the whole Firefox session, which will be identical to Marionette. For
          // now prevent logging if the component is not enabled during startup.
          if (
            (activeProtocols & WEBDRIVER_BIDI_ACTIVE) ===
            WEBDRIVER_BIDI_ACTIVE
          ) {
            this.#webDriverBiDi = new WebDriverBiDi(this);
            if (this.enabled) {
              logger.debug("WebDriver BiDi enabled");
            }
          }

          if ((activeProtocols & CDP_ACTIVE) === CDP_ACTIVE) {
            this.#cdp = new CDP(this);
            if (this.enabled) {
              logger.debug("CDP enabled");
            }
          }
        }
        break;

      case "final-ui-startup":
        Services.obs.removeObserver(this, topic);

        try {
          let address = Services.io.newURI(`http://localhost:${this.#port}`);
          await this.#listen(address);
        } catch (e) {
          throw Error(`Unable to start remote agent: ${e}`);
        }

        break;

      // Used to wait until the initial application window has been opened.
      case "browser-idle-startup-tasks-finished":
      case "mail-idle-startup-tasks-finished":
        Services.obs.removeObserver(
          this,
          "browser-idle-startup-tasks-finished"
        );
        Services.obs.removeObserver(this, "mail-idle-startup-tasks-finished");
        this.#browserStartupFinished.resolve();
        break;

      // Listen for application shutdown to also shutdown the Remote Agent
      // and a possible running instance of httpd.js.
      case "quit-application":
        Services.obs.removeObserver(this, topic);
        this.#stop();
        break;
    }
  }

  receiveMessage({ name }) {
    switch (name) {
      case "RemoteAgent:IsRunning":
        return this.running;

      default:
        logger.warn("Unknown IPC message to parent process: " + name);
        return null;
    }
  }

  // XPCOM

  get classID() {
    return this.#classID;
  }

  get helpInfo() {
    return `  --remote-debugging-port [<port>] Start the Firefox Remote Agent,
                     which is a low-level remote debugging interface used for WebDriver
                     BiDi and CDP. Defaults to port 9222.
  --remote-allow-hosts <hosts> Values of the Host header to allow for incoming requests.
                     Please read security guidelines at https://firefox-source-docs.mozilla.org/remote/Security.html
  --remote-allow-origins <origins> Values of the Origin header to allow for incoming requests.
                     Please read security guidelines at https://firefox-source-docs.mozilla.org/remote/Security.html\n`;
  }

  get QueryInterface() {
    return ChromeUtils.generateQI([
      "nsICommandLineHandler",
      "nsIObserver",
      "nsIRemoteAgent",
    ]);
  }
}

class RemoteAgentContentProcess {
  #classID;

  constructor() {
    this.#classID = Components.ID("{8f685a9d-8181-46d6-a71d-869289099c6d}");
  }

  get running() {
    let reply = Services.cpmm.sendSyncMessage("RemoteAgent:IsRunning");
    if (reply.length == 0) {
      logger.warn("No reply from parent process");
      return false;
    }
    return reply[0];
  }

  get QueryInterface() {
    return ChromeUtils.generateQI(["nsIRemoteAgent"]);
  }
}

var RemoteAgent;
if (isRemote) {
  RemoteAgent = new RemoteAgentContentProcess();
} else {
  RemoteAgent = new RemoteAgentParentProcess();
}

// This is used by the XPCOM codepath which expects a constructor
var RemoteAgentFactory = function() {
  return RemoteAgent;
};
