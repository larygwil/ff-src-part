/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  BrowserWindowTracker: "resource:///modules/BrowserWindowTracker.sys.mjs",
  NimbusFeatures: "resource://nimbus/ExperimentAPI.sys.mjs",
  UrlbarPrefs: "resource:///modules/UrlbarPrefs.sys.mjs",
  UrlbarUtils: "resource:///modules/UrlbarUtils.sys.mjs",
});

// Suggest features classes. On init, `QuickSuggest` creates an instance of each
// class and keeps it in the `#featuresByName` map. See `SuggestFeature`.
const FEATURES = {
  AddonSuggestions:
    "resource:///modules/urlbar/private/AddonSuggestions.sys.mjs",
  AmpSuggestions: "resource:///modules/urlbar/private/AmpSuggestions.sys.mjs",
  BlockedSuggestions:
    "resource:///modules/urlbar/private/BlockedSuggestions.sys.mjs",
  ExposureSuggestions:
    "resource:///modules/urlbar/private/ExposureSuggestions.sys.mjs",
  FakespotSuggestions:
    "resource:///modules/urlbar/private/FakespotSuggestions.sys.mjs",
  ImpressionCaps: "resource:///modules/urlbar/private/ImpressionCaps.sys.mjs",
  MDNSuggestions: "resource:///modules/urlbar/private/MDNSuggestions.sys.mjs",
  OfflineWikipediaSuggestions:
    "resource:///modules/urlbar/private/OfflineWikipediaSuggestions.sys.mjs",
  PocketSuggestions:
    "resource:///modules/urlbar/private/PocketSuggestions.sys.mjs",
  SuggestBackendMerino:
    "resource:///modules/urlbar/private/SuggestBackendMerino.sys.mjs",
  SuggestBackendMl:
    "resource:///modules/urlbar/private/SuggestBackendMl.sys.mjs",
  SuggestBackendRust:
    "resource:///modules/urlbar/private/SuggestBackendRust.sys.mjs",
  WeatherSuggestions:
    "resource:///modules/urlbar/private/WeatherSuggestions.sys.mjs",
  YelpSuggestions: "resource:///modules/urlbar/private/YelpSuggestions.sys.mjs",
};

// Values returned by the onboarding dialog depending on the user's response.
// These values are used in telemetry events, so be careful about changing them.
const ONBOARDING_CHOICE = {
  ACCEPT_2: "accept_2",
  CLOSE_1: "close_1",
  DISMISS_1: "dismiss_1",
  DISMISS_2: "dismiss_2",
  LEARN_MORE_1: "learn_more_1",
  LEARN_MORE_2: "learn_more_2",
  NOT_NOW_2: "not_now_2",
  REJECT_2: "reject_2",
};

const ONBOARDING_URI =
  "chrome://browser/content/urlbar/quicksuggestOnboarding.html";

/**
 * This class manages Firefox Suggest and has related helpers.
 */
class _QuickSuggest {
  /**
   * @returns {string}
   *   The help URL for Suggest.
   */
  get HELP_URL() {
    return (
      Services.urlFormatter.formatURLPref("app.support.baseURL") +
      "firefox-suggest"
    );
  }

  get ONBOARDING_CHOICE() {
    return { ...ONBOARDING_CHOICE };
  }

  get ONBOARDING_URI() {
    return ONBOARDING_URI;
  }

  /**
   * @returns {Array}
   *   Enabled Suggest backends.
   */
  get enabledBackends() {
    // This getter may be accessed before `init()` is called, so the backends
    // may not be registered yet. Don't assume they're non-null.
    return [
      this.rustBackend,
      this.#featuresByName.get("SuggestBackendMerino"),
      this.#featuresByName.get("SuggestBackendMl"),
    ].filter(b => b?.isEnabled);
  }

  /**
   * @returns {SuggestBackendRust}
   *   The Rust backend, which manages the Rust component.
   */
  get rustBackend() {
    return this.#featuresByName.get("SuggestBackendRust");
  }

  /**
   * @returns {object}
   *   Global Suggest configuration stored in remote settings and ingested by
   *   the Rust component. See remote settings or the Rust component for the
   *   latest schema.
   */
  get config() {
    return this.rustBackend?.config || {};
  }

  /**
   * @returns {BlockedSuggestions}
   *   The blocked suggestions feature.
   */
  get blockedSuggestions() {
    return this.#featuresByName.get("BlockedSuggestions");
  }

  /**
   * @returns {ImpressionCaps}
   *   The impression caps feature.
   */
  get impressionCaps() {
    return this.#featuresByName.get("ImpressionCaps");
  }

  /**
   * @returns {Set}
   *   The set of features that manage Rust suggestion types, as determined by
   *   each feature's `rustSuggestionType`.
   */
  get rustFeatures() {
    return new Set(this.#featuresByRustSuggestionType.values());
  }

  /**
   * @returns {Set}
   *   The set of features that manage ML suggestion types, as determined by
   *   each feature's `mlIntent`.
   */
  get mlFeatures() {
    return new Set(this.#featuresByMlIntent.values());
  }

  get logger() {
    if (!this._logger) {
      this._logger = lazy.UrlbarUtils.getLogger({ prefix: "QuickSuggest" });
    }
    return this._logger;
  }

  /**
   * Initializes Suggest. It's safe to call more than once.
   */
  init() {
    if (this.#featuresByName.size) {
      // Already initialized.
      return;
    }

    // Create an instance of each feature and keep it in `#featuresByName`.
    for (let [name, uri] of Object.entries(FEATURES)) {
      let { [name]: ctor } = ChromeUtils.importESModule(uri);
      let feature = new ctor();
      this.#featuresByName.set(name, feature);
      if (feature.merinoProvider) {
        this.#featuresByMerinoProvider.set(feature.merinoProvider, feature);
      }
      if (feature.rustSuggestionType) {
        this.#featuresByRustSuggestionType.set(
          feature.rustSuggestionType,
          feature
        );
      }
      if (feature.mlIntent) {
        this.#featuresByMlIntent.set(feature.mlIntent, feature);
      }

      // Update the map from enabling preferences to features.
      let prefs = feature.enablingPreferences;
      if (prefs) {
        for (let p of prefs) {
          let features = this.#featuresByEnablingPrefs.get(p);
          if (!features) {
            features = new Set();
            this.#featuresByEnablingPrefs.set(p, features);
          }
          features.add(feature);
        }
      }
    }

    this.#updateAll();
    lazy.NimbusFeatures.urlbar.onUpdate(() => this.#updateAll());
    lazy.UrlbarPrefs.addObserver(this);
  }

  /**
   * Returns a Suggest feature by name.
   *
   * @param {string} name
   *   The name of the feature's JS class.
   * @returns {SuggestFeature}
   *   The feature object, an instance of a subclass of `SuggestFeature`.
   */
  getFeature(name) {
    return this.#featuresByName.get(name);
  }

  /**
   * Returns a Suggest feature by the name of the Merino provider that serves
   * its suggestions (as defined by `feature.merinoProvider`). Not all features
   * correspond to a Merino provider.
   *
   * @param {string} provider
   *   The name of a Merino provider.
   * @returns {SuggestProvider}
   *   The feature object, an instance of a subclass of `SuggestProvider`, or
   *   null if no feature corresponds to the Merino provider.
   */
  getFeatureByMerinoProvider(provider) {
    return this.#featuresByMerinoProvider.get(provider);
  }

  /**
   * Returns a Suggest feature by the type of Rust suggestion it manages (as
   * defined by `feature.rustSuggestionType`). Not all features correspond to a
   * Rust suggestion type.
   *
   * @param {string} type
   *   The name of a Rust suggestion type.
   * @returns {SuggestProvider}
   *   The feature object, an instance of a subclass of `SuggestProvider`, or
   *   null if no feature corresponds to the type.
   */
  getFeatureByRustSuggestionType(type) {
    return this.#featuresByRustSuggestionType.get(type);
  }

  /**
   * Returns a Suggest feature by the ML intent name (as defined by
   * `feature.mlIntent` and `MLSuggest`). Not all features support ML.
   *
   * @param {string} intent
   *   The name of an ML intent.
   * @returns {SuggestProvider}
   *   The feature object, an instance of a subclass of `SuggestProvider`, or
   *   null if no feature corresponds to the intent.
   */
  getFeatureByMlIntent(intent) {
    return this.#featuresByMlIntent.get(intent);
  }

  /**
   * Gets the Suggest feature that manages suggestions for urlbar result.
   *
   * @param {UrlbarResult} result
   *   The urlbar result.
   * @returns {SuggestProvider}
   *   The feature instance or null if none was found.
   */
  getFeatureByResult(result) {
    return this.getFeatureBySource(result.payload);
  }

  /**
   * Gets the Suggest feature that manages suggestions for a source and provider
   * name. The source and provider name can be supplied from either a suggestion
   * object or the payload of a `UrlbarResult` object.
   *
   * @param {object} options
   *   Options object.
   * @param {string} options.source
   *   The suggestion source, one of: "merino", "ml", "rust"
   * @param {string} options.provider
   *   This value depends on `source`. The possible values per source are:
   *
   *   merino:
   *     The name of the Merino provider that serves the suggestion type
   *   ml:
   *     The name of the intent as determined by `MLSuggest`
   *   rust:
   *     The name of the suggestion type as defined in Rust
   * @returns {SuggestProvider}
   *   The feature instance or null if none was found.
   */
  getFeatureBySource({ source, provider }) {
    switch (source) {
      case "merino":
        return this.getFeatureByMerinoProvider(provider);
      case "rust":
        return this.getFeatureByRustSuggestionType(provider);
      case "ml":
        return this.getFeatureByMlIntent(provider);
    }
    return null;
  }

  /**
   * Called when a urlbar pref changes.
   *
   * @param {string} pref
   *   The name of the pref relative to `browser.urlbar`.
   */
  onPrefChanged(pref) {
    // If any feature's enabling preference changed, update it now.
    let features = this.#featuresByEnablingPrefs.get(pref);
    if (features) {
      for (let f of features) {
        f.update();
      }
    }
  }

  /**
   * Returns whether a given URL and result URL map back to the same original
   * suggestion URL.
   *
   * Some features may create result URLs that are potentially unique per query.
   * Typically this is done by modifying an original suggestion URL at query
   * time, for example by adding timestamps or query-specific search params. In
   * that case, a single original suggestion URL will map to many result URLs.
   * This function returns whether the given URL and result URL are equal
   * excluding any such modifications.
   *
   * @param {string} url
   *   The URL to check, typically from the user's history.
   * @param {UrlbarResult} result
   *   The Suggest result.
   * @returns {boolean}
   *   Whether `url` is equivalent to the result's URL.
   */
  isUrlEquivalentToResultUrl(url, result) {
    let feature = this.getFeatureByResult(result);
    return feature
      ? feature.isUrlEquivalentToResultUrl(url, result)
      : url == result.payload.url;
  }

  /**
   * An onboarding dialog can be shown to the users who are enrolled into
   * the Suggest experiments or rollouts. This behavior is controlled
   * by the pref `browser.urlbar.quicksuggest.shouldShowOnboardingDialog`
   * which can be remotely configured by Nimbus.
   *
   * Given that the release may overlap with another onboarding dialog, we may
   * wait for a few restarts before showing the Suggest dialog. This can
   * be remotely configured by Nimbus through
   * `quickSuggestShowOnboardingDialogAfterNRestarts`, the default is 0.
   *
   * @returns {boolean}
   *   True if the dialog was shown and false if not.
   */
  async maybeShowOnboardingDialog() {
    // The call to this method races scenario initialization on startup, and the
    // Nimbus variables we rely on below depend on the scenario, so wait for it
    // to be initialized.
    await lazy.UrlbarPrefs.firefoxSuggestScenarioStartupPromise;

    // If the feature is disabled, the user has already seen the dialog, or the
    // user has already opted in, don't show the onboarding.
    if (
      !lazy.UrlbarPrefs.get("quickSuggestEnabled") ||
      lazy.UrlbarPrefs.get("quicksuggest.showedOnboardingDialog") ||
      lazy.UrlbarPrefs.get("quicksuggest.dataCollection.enabled")
    ) {
      return false;
    }

    // Wait a number of restarts before showing the dialog.
    let restartsSeen = lazy.UrlbarPrefs.get("quicksuggest.seenRestarts");
    if (
      restartsSeen <
      lazy.UrlbarPrefs.get("quickSuggestShowOnboardingDialogAfterNRestarts")
    ) {
      lazy.UrlbarPrefs.set("quicksuggest.seenRestarts", restartsSeen + 1);
      return false;
    }

    let win = lazy.BrowserWindowTracker.getTopWindow();

    // Don't show the dialog on top of about:welcome for new users.
    if (win.gBrowser?.currentURI?.spec == "about:welcome") {
      return false;
    }

    if (
      !lazy.UrlbarPrefs.get("quickSuggestShouldShowOnboardingDialog") ||
      lazy.UrlbarPrefs.get("quicksuggest.contextualOptIn")
    ) {
      return false;
    }

    let variationType;
    try {
      // An error happens if the pref is not in user prefs.
      variationType = lazy.UrlbarPrefs.get(
        "quickSuggestOnboardingDialogVariation"
      ).toLowerCase();
    } catch (e) {}

    let params = { choice: undefined, variationType, visitedMain: false };
    await win.gDialogBox.open(ONBOARDING_URI, params);

    lazy.UrlbarPrefs.set("quicksuggest.showedOnboardingDialog", true);
    lazy.UrlbarPrefs.set(
      "quicksuggest.onboardingDialogVersion",
      JSON.stringify({ version: 1, variation: variationType })
    );

    // Record the user's opt-in choice on the user branch. This pref is sticky,
    // so it will retain its user-branch value regardless of what the particular
    // default was at the time.
    let optedIn = params.choice == ONBOARDING_CHOICE.ACCEPT_2;
    lazy.UrlbarPrefs.set("quicksuggest.dataCollection.enabled", optedIn);

    switch (params.choice) {
      case ONBOARDING_CHOICE.LEARN_MORE_1:
      case ONBOARDING_CHOICE.LEARN_MORE_2:
        win.openTrustedLinkIn(this.HELP_URL, "tab");
        break;
      case ONBOARDING_CHOICE.ACCEPT_2:
      case ONBOARDING_CHOICE.REJECT_2:
      case ONBOARDING_CHOICE.NOT_NOW_2:
      case ONBOARDING_CHOICE.CLOSE_1:
        // No other action required.
        break;
      default:
        params.choice = params.visitedMain
          ? ONBOARDING_CHOICE.DISMISS_2
          : ONBOARDING_CHOICE.DISMISS_1;
        break;
    }

    lazy.UrlbarPrefs.set("quicksuggest.onboardingDialogChoice", params.choice);

    return true;
  }

  /**
   * Updates all features.
   */
  #updateAll() {
    // IMPORTANT: This method is a `NimbusFeatures.urlbar.onUpdate()` callback,
    // which means it's called on every change to any pref that is a fallback
    // for a urlbar Nimbus variable.

    // Update features.
    for (let feature of this.#featuresByName.values()) {
      feature.update();
    }
  }

  // Maps from Suggest feature class names to feature instances.
  #featuresByName = new Map();

  // Maps from Merino provider names to Suggest feature instances.
  #featuresByMerinoProvider = new Map();

  // Maps from Rust suggestion types to Suggest feature instances.
  #featuresByRustSuggestionType = new Map();

  // Maps from ML intent strings to Suggest feature instances.
  #featuresByMlIntent = new Map();

  // Maps from preference names to the `Set` of feature instances they enable.
  #featuresByEnablingPrefs = new Map();
}

export const QuickSuggest = new _QuickSuggest();
