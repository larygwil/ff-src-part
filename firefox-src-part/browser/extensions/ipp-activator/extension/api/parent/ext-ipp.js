/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* global ExtensionAPI, ExtensionCommon, Cr */

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  ExtensionParent: "resource://gre/modules/ExtensionParent.sys.mjs",
  IPProtectionService:
    "resource:///modules/ipprotection/IPProtectionService.sys.mjs",
});

ChromeUtils.defineLazyGetter(lazy, "tabTracker", () => {
  return lazy.ExtensionParent.apiManager.global.tabTracker;
});

const PREF_DYNAMIC_TAB_BREAKAGES =
  "extensions.ippactivator.dynamicTabBreakages";
const PREF_DYNAMIC_WEBREQUEST_BREAKAGES =
  "extensions.ippactivator.dynamicWebRequestBreakages";
const PREF_NOTIFIED_DOMAINS = "extensions.ippactivator.notifiedDomains";

this.ippActivator = class extends ExtensionAPI {
  onStartup() {}

  onShutdown(_isAppShutdown) {}

  getAPI(context) {
    return {
      ippActivator: {
        onIPPActivated: new ExtensionCommon.EventManager({
          context,
          name: "ippActivator.onIPPActivated",
          register: fire => {
            const topics = [
              "IPProtectionService:StateChanged",
              "IPProtectionService:Started",
              "IPProtectionService:Stopped",
              "IPProtectionService:SignedOut",
            ];
            const observer = _event => {
              fire.async();
            };

            topics.forEach(topic =>
              lazy.IPProtectionService.addEventListener(topic, observer)
            );

            return () => {
              topics.forEach(topic =>
                lazy.IPProtectionService.removeEventListener(topic, observer)
              );
            };
          },
        }).api(),
        isTesting() {
          return Services.prefs.getBoolPref(
            "extensions.ippactivator.testMode",
            false
          );
        },
        hideMessage(tabId) {
          try {
            const tab = tabId
              ? lazy.tabTracker.getTab(tabId)
              : lazy.tabTracker.activeTab;
            const browser = tab?.linkedBrowser;
            const win = browser?.ownerGlobal;
            if (!browser || !win || !win.gBrowser) {
              return;
            }

            const nbox = win.gBrowser.getNotificationBox(browser);
            const id = "ipp-activator-notification";
            const existing = nbox.getNotificationWithValue?.(id);
            if (existing) {
              nbox.removeNotification(existing);
            }
          } catch (e) {
            console.warn("Unable to hide the message", e);
          }
        },
        isIPPActive() {
          if ("state" in lazy.IPProtectionService) {
            return lazy.IPProtectionService.state === "active";
          }

          return !!lazy.IPProtectionService.isActive;
        },
        getDynamicTabBreakages() {
          try {
            const json = Services.prefs.getStringPref(
              PREF_DYNAMIC_TAB_BREAKAGES,
              "[]"
            );
            const arr = JSON.parse(json);
            return Array.isArray(arr) ? arr : [];
          } catch (_) {
            return [];
          }
        },
        getDynamicWebRequestBreakages() {
          try {
            const json = Services.prefs.getStringPref(
              PREF_DYNAMIC_WEBREQUEST_BREAKAGES,
              "[]"
            );
            const arr = JSON.parse(json);
            return Array.isArray(arr) ? arr : [];
          } catch (_) {
            return [];
          }
        },
        getNotifiedDomains() {
          try {
            const json = Services.prefs.getStringPref(
              PREF_NOTIFIED_DOMAINS,
              "[]"
            );
            const arr = JSON.parse(json);
            return Array.isArray(arr) ? arr : [];
          } catch (_) {
            return [];
          }
        },
        addNotifiedDomain(domain) {
          const d = String(domain || "");
          if (!d) {
            return;
          }
          let arr = [];
          try {
            const json = Services.prefs.getStringPref(
              PREF_NOTIFIED_DOMAINS,
              "[]"
            );
            arr = JSON.parse(json);
            if (!Array.isArray(arr)) {
              arr = [];
            }
          } catch (_) {
            arr = [];
          }
          if (!arr.includes(d)) {
            arr.push(d);
            Services.prefs.setStringPref(
              PREF_NOTIFIED_DOMAINS,
              JSON.stringify(arr)
            );
          }
        },
        getBaseDomainFromURL(url) {
          try {
            const host = Services.io.newURI(url).host;
            if (!host) {
              return { baseDomain: "", host: "" };
            }
            let baseDomain = "";
            try {
              baseDomain = Services.eTLD.getBaseDomainFromHost(host);
            } catch (e) {
              if (e.result === Cr.NS_ERROR_INSUFFICIENT_DOMAIN_LEVELS) {
                baseDomain = host;
              } else {
                baseDomain = "";
              }
            }
            return { baseDomain, host };
          } catch (_) {
            return { baseDomain: "", host: "" };
          }
        },
        async showMessage(message, tabId) {
          try {
            // Choose the target tab (by id if provided, else active tab)
            const tab = tabId
              ? lazy.tabTracker.getTab(tabId)
              : lazy.tabTracker.activeTab;
            const browser = tab?.linkedBrowser;
            const win = browser?.ownerGlobal;
            if (!browser || !win || !win.gBrowser) {
              return Promise.resolve(false);
            }

            const nbox = win.gBrowser.getNotificationBox(browser);
            const id = "ipp-activator-notification";

            const existing = nbox.getNotificationWithValue?.(id);
            if (existing) {
              nbox.removeNotification(existing);
            }

            const buildLabel = msg => {
              // Accept either string or array of parts {text, modifier}
              if (Array.isArray(msg)) {
                const frag = win.document.createDocumentFragment();
                for (const part of msg) {
                  const text = String(part?.text ?? "");
                  const mods = Array.isArray(part?.modifier)
                    ? part.modifier
                    : [];
                  if (mods.includes("strong")) {
                    const strong = win.document.createElement("strong");
                    strong.textContent = text;
                    frag.append(strong);
                  } else {
                    frag.append(win.document.createTextNode(text));
                  }
                }
                return frag;
              }
              return String(msg ?? "");
            };

            const label = buildLabel(message);

            // Promise that resolves when the notification is dismissed
            let resolveDismiss;
            const dismissedPromise = new Promise(resolve => {
              resolveDismiss = resolve;
            });

            // Create the notification; set persistence when available
            nbox
              .appendNotification(
                id,
                {
                  // If label is a string, pass it through; if it's a Node, the
                  // notification box will handle it as rich content.
                  label,
                  priority: nbox.PRIORITY_WARNING_HIGH,
                  eventCallback: param => {
                    resolveDismiss(param === "dismissed");
                  },
                },
                []
              )
              .then(notification => {
                // Persist the notification until the user removes so it
                // doesn't get removed on redirects.
                notification.persistence = -1;
              });

            return dismissedPromise;
          } catch (e) {
            console.warn("Unable to show the message", e);
            return Promise.resolve(false);
          }
        },
        onDynamicTabBreakagesUpdated: new ExtensionCommon.EventManager({
          context,
          name: "ippActivator.onDynamicTabBreakagesUpdated",
          register: fire => {
            const observer = {
              observe(subject, topic, data) {
                if (
                  topic === "nsPref:changed" &&
                  data === PREF_DYNAMIC_TAB_BREAKAGES
                ) {
                  fire.async();
                }
              },
            };
            Services.prefs.addObserver(PREF_DYNAMIC_TAB_BREAKAGES, observer);
            return () =>
              Services.prefs.removeObserver(
                PREF_DYNAMIC_TAB_BREAKAGES,
                observer
              );
          },
        }).api(),
        onDynamicWebRequestBreakagesUpdated: new ExtensionCommon.EventManager({
          context,
          name: "ippActivator.onDynamicWebRequestBreakagesUpdated",
          register: fire => {
            const observer = {
              observe(subject, topic, data) {
                if (
                  topic === "nsPref:changed" &&
                  data === PREF_DYNAMIC_WEBREQUEST_BREAKAGES
                ) {
                  fire.async();
                }
              },
            };
            Services.prefs.addObserver(
              PREF_DYNAMIC_WEBREQUEST_BREAKAGES,
              observer
            );
            return () =>
              Services.prefs.removeObserver(
                PREF_DYNAMIC_WEBREQUEST_BREAKAGES,
                observer
              );
          },
        }).api(),
      },
    };
  }
};
