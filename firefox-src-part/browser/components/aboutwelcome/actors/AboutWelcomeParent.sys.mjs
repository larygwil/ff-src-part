/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  AboutWelcomeDefaults:
    "resource:///modules/aboutwelcome/AboutWelcomeDefaults.sys.mjs",
  AboutWelcomeTelemetry:
    "resource:///modules/aboutwelcome/AboutWelcomeTelemetry.sys.mjs",
  AddonManager: "resource://gre/modules/AddonManager.sys.mjs",
  AWScreenUtils: "resource:///modules/aboutwelcome/AWScreenUtils.sys.mjs",
  BrowserUtils: "resource://gre/modules/BrowserUtils.sys.mjs",
  BuiltInThemes: "resource:///modules/BuiltInThemes.sys.mjs",
  FxAccounts: "resource://gre/modules/FxAccounts.sys.mjs",
  LangPackMatcher: "resource://gre/modules/LangPackMatcher.sys.mjs",
  ShellService: "resource:///modules/ShellService.sys.mjs",
  SpecialMessageActions:
    "resource://messaging-system/lib/SpecialMessageActions.sys.mjs",
});

ChromeUtils.defineLazyGetter(lazy, "log", () => {
  const { Logger } = ChromeUtils.importESModule(
    "resource://messaging-system/lib/Logger.sys.mjs"
  );
  return new Logger("AboutWelcomeParent");
});

ChromeUtils.defineLazyGetter(
  lazy,
  "Telemetry",
  () => new lazy.AboutWelcomeTelemetry()
);

const DID_SEE_ABOUT_WELCOME_PREF = "trailhead.firstrun.didSeeAboutWelcome";
const DID_HANDLE_CAMAPAIGN_ACTION_PREF =
  "trailhead.firstrun.didHandleCampaignAction";
const AWTerminate = {
  WINDOW_CLOSED: "welcome-window-closed",
  TAB_CLOSED: "welcome-tab-closed",
  APP_SHUT_DOWN: "app-shut-down",
  ADDRESS_BAR_NAVIGATED: "address-bar-navigated",
};
const LIGHT_WEIGHT_THEMES = {
  AUTOMATIC: "default-theme@mozilla.org",
  DARK: "firefox-compact-dark@mozilla.org",
  LIGHT: "firefox-compact-light@mozilla.org",
  ALPENGLOW: "firefox-alpenglow@mozilla.org",
};

class AboutWelcomeObserver {
  constructor() {
    Services.obs.addObserver(this, "quit-application");

    this.win = Services.focus.activeWindow;
    if (!this.win) {
      return;
    }

    this.terminateReason = AWTerminate.ADDRESS_BAR_NAVIGATED;

    this.onWindowClose = () => {
      this.terminateReason = AWTerminate.WINDOW_CLOSED;
    };

    this.onTabClose = () => {
      this.terminateReason = AWTerminate.TAB_CLOSED;
    };

    this.win.addEventListener("TabClose", this.onTabClose, { once: true });
    this.win.addEventListener("unload", this.onWindowClose, { once: true });
  }

  observe(aSubject, aTopic) {
    switch (aTopic) {
      case "quit-application":
        this.terminateReason = AWTerminate.APP_SHUT_DOWN;
        break;
    }
  }

  // Added for testing
  get AWTerminate() {
    return AWTerminate;
  }

  stop() {
    lazy.log.debug(`Terminate reason is ${this.terminateReason}`);
    // Clear the entrypoint pref
    Services.prefs.clearUserPref("browser.aboutwelcome.entrypoint");
    Services.obs.removeObserver(this, "quit-application");
    if (!this.win) {
      return;
    }
    this.win.removeEventListener("TabClose", this.onTabClose);
    this.win.removeEventListener("unload", this.onWindowClose);
    this.win = null;
  }
}

export class AboutWelcomeParent extends JSWindowActorParent {
  constructor() {
    super();
    this.startAboutWelcomeObserver();
  }

  startAboutWelcomeObserver() {
    this.AboutWelcomeObserver = new AboutWelcomeObserver();
  }

  // Static methods that calls into ShellService to check
  // if Firefox is pinned or already default
  static async doesAppNeedPin() {
    return (
      (await lazy.ShellService.doesAppNeedPin()) ||
      (await lazy.ShellService.doesAppNeedStartMenuPin())
    );
  }

  static isDefaultBrowser() {
    return lazy.ShellService.isDefaultBrowser();
  }

  didDestroy() {
    if (this.AboutWelcomeObserver) {
      this.AboutWelcomeObserver.stop();
    }
    this.RegionHomeObserver?.stop();

    lazy.Telemetry.sendTelemetry({
      event: "SESSION_END",
      event_context: {
        reason: this.AboutWelcomeObserver.terminateReason,
        page: "about:welcome",
      },
      message_id: this.AWMessageId,
    });
  }

  /**
   * Handle messages from AboutWelcomeChild.sys.mjs
   *
   * @param {string} type
   * @param {any=} data
   * @param {Browser} the xul:browser rendering the page
   */
  async onContentMessage(type, data, browser) {
    lazy.log.debug(`Received content event: ${type}`);
    switch (type) {
      case "AWPage:SET_WELCOME_MESSAGE_SEEN":
        this.AWMessageId = data;
        try {
          Services.prefs.setBoolPref(DID_SEE_ABOUT_WELCOME_PREF, true);
        } catch (e) {
          lazy.log.debug(`Fails to set ${DID_SEE_ABOUT_WELCOME_PREF}.`);
        }
        break;
      case "AWPage:SPECIAL_ACTION":
        return lazy.SpecialMessageActions.handleAction(data, browser);
      case "AWPage:FXA_METRICS_FLOW_URI":
        return lazy.FxAccounts.config.promiseMetricsFlowURI("aboutwelcome");
      case "AWPage:TELEMETRY_EVENT":
        lazy.Telemetry.sendTelemetry(data);
        break;
      case "AWPage:GET_ATTRIBUTION_DATA": {
        let attributionData =
          await lazy.AboutWelcomeDefaults.getAttributionContent();
        return attributionData;
      }
      case "AWPage:ENSURE_ADDON_INSTALLED":
        return new Promise(resolve => {
          let listener = {
            onInstallEnded(install, addon) {
              if (addon.id === data) {
                lazy.AddonManager.removeInstallListener(listener);
                resolve("complete");
              }
            },
            onInstallCancelled() {
              lazy.AddonManager.removeInstallListener(listener);
              resolve("install cancelled");
            },
            onDownloadCancelled() {
              lazy.AddonManager.removeInstallListener(listener);
              resolve("install cancelled");
            },
            onInstallFailed() {
              lazy.AddonManager.removeInstallListener(listener);
              resolve("install failed");
            },
          };
          lazy.AddonManager.addInstallListener(listener);
        });
      case "AWPage:GET_INSTALLED_ADDONS":
        return lazy.AddonManager.getActiveAddons().then(response =>
          response.addons.map(addon => addon.id)
        );
      case "AWPage:GET_ADDON_DETAILS": {
        let addonDetails =
          await lazy.AboutWelcomeDefaults.getAddonFromRepository(data);

        return {
          addonId: addonDetails.id,
          label: addonDetails.name,
          icon: addonDetails.iconURL,
          type: addonDetails.type,
          screenshots: addonDetails.screenshots,
          url: addonDetails.url,
        };
      }
      case "AWPage:SELECT_THEME":
        await lazy.BuiltInThemes.ensureBuiltInThemes();
        return lazy.AddonManager.getAddonByID(LIGHT_WEIGHT_THEMES[data]).then(
          addon => addon.enable()
        );
      case "AWPage:GET_SELECTED_THEME": {
        let themes = await lazy.AddonManager.getAddonsByTypes(["theme"]);
        let activeTheme = themes.find(addon => addon.isActive);
        // Store the current theme ID so user can restore their previous theme.
        if (activeTheme?.id) {
          LIGHT_WEIGHT_THEMES.AUTOMATIC = activeTheme.id;
        }
        // convert this to the short form name that the front end code
        // expects
        let themeShortName = Object.keys(LIGHT_WEIGHT_THEMES).find(
          key => LIGHT_WEIGHT_THEMES[key] === activeTheme?.id
        );
        return themeShortName?.toLowerCase();
      }
      case "AWPage:DOES_APP_NEED_PIN":
        return AboutWelcomeParent.doesAppNeedPin();
      case "AWPage:NEED_DEFAULT":
        // Only need to set default if we're supposed to check and not default.
        return (
          Services.prefs.getBoolPref("browser.shell.checkDefaultBrowser") &&
          !AboutWelcomeParent.isDefaultBrowser()
        );
      case "AWPage:WAIT_FOR_MIGRATION_CLOSE":
        // Support multiples types of migration: 1) content modal 2) old
        // migration modal 3) standalone content modal
        return new Promise(resolve => {
          const topics = [
            "MigrationWizard:Closed",
            "MigrationWizard:Destroyed",
          ];
          const observer = () => {
            topics.forEach(t => Services.obs.removeObserver(observer, t));
            resolve();
          };
          topics.forEach(t => Services.obs.addObserver(observer, t));
        });
      case "AWPage:GET_APP_AND_SYSTEM_LOCALE_INFO":
        return lazy.LangPackMatcher.getAppAndSystemLocaleInfo();
      case "AWPage:EVALUATE_SCREEN_TARGETING":
        return lazy.AWScreenUtils.evaluateTargetingAndRemoveScreens(data);
      case "AWPage:ADD_SCREEN_IMPRESSION":
        return lazy.AWScreenUtils.addScreenImpression(data);
      case "AWPage:EVALUATE_ATTRIBUTE_TARGETING":
        return lazy.AWScreenUtils.evaluateScreenTargeting(data);
      case "AWPage:NEGOTIATE_LANGPACK":
        return lazy.LangPackMatcher.negotiateLangPackForLanguageMismatch(data);
      case "AWPage:ENSURE_LANG_PACK_INSTALLED":
        return lazy.LangPackMatcher.ensureLangPackInstalled(data);
      case "AWPage:SET_REQUESTED_LOCALES":
        return lazy.LangPackMatcher.setRequestedAppLocales(data);
      case "AWPage:SEND_TO_DEVICE_EMAILS_SUPPORTED": {
        return lazy.BrowserUtils.sendToDeviceEmailsSupported();
      }
      case "AWPage:GET_UNHANDLED_CAMPAIGN_ACTION": {
        if (
          !Services.prefs.getBoolPref(DID_HANDLE_CAMAPAIGN_ACTION_PREF, false)
        ) {
          return lazy.AWScreenUtils.getUnhandledCampaignAction();
        }
        break;
      }
      case "AWPage:HANDLE_CAMPAIGN_ACTION": {
        if (
          !Services.prefs.getBoolPref(DID_HANDLE_CAMAPAIGN_ACTION_PREF, false)
        ) {
          lazy.SpecialMessageActions.handleAction({ type: data }, browser);
          try {
            Services.prefs.setBoolPref(DID_HANDLE_CAMAPAIGN_ACTION_PREF, true);
          } catch (e) {
            lazy.log.debug(`Fails to set ${DID_HANDLE_CAMAPAIGN_ACTION_PREF}.`);
          }
          return true;
        }
        break;
      }
      default:
        lazy.log.debug(`Unexpected event ${type} was not handled.`);
    }

    return undefined;
  }

  /**
   * @param {{name: string, data?: any}} message
   * @override
   */
  receiveMessage(message) {
    const { name, data } = message;
    let browser;

    if (this.manager.rootFrameLoader) {
      browser = this.manager.rootFrameLoader.ownerElement;
      return this.onContentMessage(name, data, browser);
    }

    lazy.log.warn(`Not handling ${name} because the browser doesn't exist.`);
    return null;
  }
}
