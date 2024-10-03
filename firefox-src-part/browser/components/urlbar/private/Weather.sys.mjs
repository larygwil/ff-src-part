/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { BaseFeature } from "resource:///modules/urlbar/private/BaseFeature.sys.mjs";

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  MerinoClient: "resource:///modules/MerinoClient.sys.mjs",
  QuickSuggest: "resource:///modules/QuickSuggest.sys.mjs",
  UrlbarPrefs: "resource:///modules/UrlbarPrefs.sys.mjs",
  UrlbarResult: "resource:///modules/UrlbarResult.sys.mjs",
  UrlbarUtils: "resource:///modules/UrlbarUtils.sys.mjs",
  UrlbarView: "resource:///modules/UrlbarView.sys.mjs",
});

const MERINO_PROVIDER = "accuweather";
const MERINO_TIMEOUT_MS = 5000; // 5s

const HISTOGRAM_LATENCY = "FX_URLBAR_MERINO_LATENCY_WEATHER_MS";
const HISTOGRAM_RESPONSE = "FX_URLBAR_MERINO_RESPONSE_WEATHER";

const RESULT_MENU_COMMAND = {
  INACCURATE_LOCATION: "inaccurate_location",
  MANAGE: "manage",
  NOT_INTERESTED: "not_interested",
  NOT_RELEVANT: "not_relevant",
  SHOW_LESS_FREQUENTLY: "show_less_frequently",
};

const WEATHER_PROVIDER_DISPLAY_NAME = "AccuWeather";

const WEATHER_DYNAMIC_TYPE = "weather";
const WEATHER_VIEW_TEMPLATE = {
  attributes: {
    selectable: true,
  },
  children: [
    {
      name: "currentConditions",
      tag: "span",
      children: [
        {
          name: "currently",
          tag: "div",
        },
        {
          name: "currentTemperature",
          tag: "div",
          children: [
            {
              name: "temperature",
              tag: "span",
            },
            {
              name: "weatherIcon",
              tag: "img",
            },
          ],
        },
      ],
    },
    {
      name: "summary",
      tag: "span",
      overflowable: true,
      children: [
        {
          name: "top",
          tag: "div",
          children: [
            {
              name: "topNoWrap",
              tag: "span",
              children: [
                { name: "title", tag: "span", classList: ["urlbarView-title"] },
                {
                  name: "titleSeparator",
                  tag: "span",
                  classList: ["urlbarView-title-separator"],
                },
              ],
            },
            {
              name: "url",
              tag: "span",
              classList: ["urlbarView-url"],
            },
          ],
        },
        {
          name: "middle",
          tag: "div",
          children: [
            {
              name: "middleNoWrap",
              tag: "span",
              overflowable: true,
              children: [
                {
                  name: "summaryText",
                  tag: "span",
                },
                {
                  name: "summaryTextSeparator",
                  tag: "span",
                },
                {
                  name: "highLow",
                  tag: "span",
                },
              ],
            },
            {
              name: "highLowWrap",
              tag: "span",
            },
          ],
        },
        {
          name: "bottom",
          tag: "div",
        },
      ],
    },
  ],
};

/**
 * A feature that periodically fetches weather suggestions from Merino.
 */
export class Weather extends BaseFeature {
  constructor(...args) {
    super(...args);
    lazy.UrlbarResult.addDynamicResultType(WEATHER_DYNAMIC_TYPE);
    lazy.UrlbarView.addDynamicViewTemplate(
      WEATHER_DYNAMIC_TYPE,
      WEATHER_VIEW_TEMPLATE
    );
  }

  get shouldEnable() {
    // The feature itself is enabled by setting these prefs regardless of
    // whether any config is defined. This is necessary to allow the feature to
    // sync the config from remote settings and Nimbus. Suggestion fetches will
    // not start until the config has been either synced from remote settings or
    // set by Nimbus.
    return (
      lazy.UrlbarPrefs.get("weatherFeatureGate") &&
      lazy.UrlbarPrefs.get("suggest.weather")
    );
  }

  get enablingPreferences() {
    return ["suggest.weather"];
  }

  get rustSuggestionTypes() {
    return ["Weather"];
  }

  isRustSuggestionTypeEnabled() {
    // When weather keywords are defined in Nimbus, weather suggestions are
    // served by UrlbarProviderWeather. Return false here so the quick suggest
    // provider doesn't try to serve them too.
    return !lazy.UrlbarPrefs.get("weatherKeywords");
  }

  getSuggestionTelemetryType() {
    return "weather";
  }

  /**
   * @returns {Set}
   *   The set of keywords that should trigger the weather suggestion. This will
   *   be null when the Rust backend is enabled and keywords are not defined by
   *   Nimbus because in that case Rust manages the keywords. Otherwise, it will
   *   also be null when no config is defined.
   */
  get keywords() {
    return this.#keywords;
  }

  /**
   * @returns {number}
   *   The minimum prefix length of a weather keyword the user must type to
   *   trigger the suggestion. Note that the strings returned from `keywords`
   *   already take this into account. The min length is determined from the
   *   first config source below whose value is non-zero. If no source has a
   *   non-zero value, zero will be returned, and `this.keywords` will contain
   *   only full keywords.
   *
   *   1. The `weather.minKeywordLength` pref, which is set when the user
   *      increments the min length
   *   2. `weatherKeywordsMinimumLength` in Nimbus
   *   3. `min_keyword_length` in the weather record in remote settings (i.e.,
   *      the weather config)
   */
  get minKeywordLength() {
    let minLength =
      lazy.UrlbarPrefs.get("weather.minKeywordLength") ||
      lazy.UrlbarPrefs.get("weatherKeywordsMinimumLength") ||
      this.#config.minKeywordLength ||
      0;
    return Math.max(minLength, 0);
  }

  /**
   * @returns {boolean}
   *   Weather the min keyword length can be incremented. A cap on the min
   *   length can be set in remote settings and Nimbus.
   */
  get canIncrementMinKeywordLength() {
    let nimbusMax =
      lazy.UrlbarPrefs.get("weatherKeywordsMinimumLengthCap") || 0;

    let maxKeywordLength;
    if (nimbusMax) {
      // In Nimbus, the cap is the max keyword length.
      maxKeywordLength = nimbusMax;
    } else {
      // In the RS config, the cap is the max number of times the user can click
      // "Show less frequently". The max keyword length is therefore the initial
      // min length plus the cap.
      let min = this.#config.minKeywordLength;
      let cap = lazy.QuickSuggest.backend.config?.showLessFrequentlyCap;
      if (min && cap) {
        maxKeywordLength = min + cap;
      }
    }

    return !maxKeywordLength || this.minKeywordLength < maxKeywordLength;
  }

  update() {
    let wasEnabled = this.isEnabled;
    super.update();

    // This method is called by `QuickSuggest` in a
    // `NimbusFeatures.urlbar.onUpdate()` callback, when a change occurs to a
    // Nimbus variable or to a pref that's a fallback for a Nimbus variable. A
    // config-related variable or pref may have changed, so update keywords, but
    // only if the feature was already enabled because if it wasn't,
    // `enable(true)` was just called, which calls `#init()`, which calls
    // `#updateKeywords()`.
    if (wasEnabled && this.isEnabled) {
      this.#updateKeywords();
    }
  }

  enable(enabled) {
    if (enabled) {
      this.#init();
    } else {
      this.#uninit();
    }
  }

  /**
   * Increments the minimum prefix length of a weather keyword the user must
   * type to trigger the suggestion, if possible. A cap on the min length can be
   * set in remote settings and Nimbus, and if the cap has been reached, the
   * length is not incremented.
   */
  incrementMinKeywordLength() {
    if (this.canIncrementMinKeywordLength) {
      lazy.UrlbarPrefs.set(
        "weather.minKeywordLength",
        this.minKeywordLength + 1
      );
    }
  }

  async onRemoteSettingsSync(rs) {
    this.logger.debug("Loading weather config from remote settings");
    let records = await rs.get({ filters: { type: "weather" } });
    if (!this.isEnabled) {
      return;
    }

    this.logger.debug("Got weather records: " + JSON.stringify(records));
    this.#rsConfig = lazy.UrlbarUtils.copySnakeKeysToCamel(
      records?.[0]?.weather || {}
    );
    this.#updateKeywords();
  }

  async makeResult(queryContext, _suggestion, searchString) {
    // The Rust component doesn't enforce a minimum keyword length, so discard
    // the suggestion if the search string isn't long enough. This conditional
    // will always be false for the JS backend since in that case keywords are
    // never shorter than `minKeywordLength`.
    if (searchString.length < this.minKeywordLength) {
      return null;
    }

    if (!this.#merino) {
      this.#merino = new lazy.MerinoClient(this.constructor.name);
    }

    let merino = this.#merino;
    let fetchInstance = (this.#fetchInstance = {});
    let suggestions = await merino.fetch({
      query: "",
      providers: [MERINO_PROVIDER],
      timeoutMs: this.#timeoutMs,
      extraLatencyHistogram: HISTOGRAM_LATENCY,
      extraResponseHistogram: HISTOGRAM_RESPONSE,
    });
    if (fetchInstance != this.#fetchInstance || merino != this.#merino) {
      return null;
    }

    if (!suggestions.length) {
      return null;
    }
    let suggestion = suggestions[0];

    let unit = Services.locale.regionalPrefsLocales[0] == "en-US" ? "f" : "c";
    return Object.assign(
      new lazy.UrlbarResult(
        lazy.UrlbarUtils.RESULT_TYPE.DYNAMIC,
        lazy.UrlbarUtils.RESULT_SOURCE.SEARCH,
        {
          url: suggestion.url,
          iconId: suggestion.current_conditions.icon_id,
          requestId: suggestion.request_id,
          dynamicType: WEATHER_DYNAMIC_TYPE,
          city: suggestion.city_name,
          temperatureUnit: unit,
          temperature: suggestion.current_conditions.temperature[unit],
          currentConditions: suggestion.current_conditions.summary,
          forecast: suggestion.forecast.summary,
          high: suggestion.forecast.high[unit],
          low: suggestion.forecast.low[unit],
        }
      ),
      {
        showFeedbackMenu: true,
        suggestedIndex: searchString ? 1 : 0,
      }
    );
  }

  getViewUpdate(result) {
    let uppercaseUnit = result.payload.temperatureUnit.toUpperCase();
    return {
      currently: {
        l10n: {
          id: "firefox-suggest-weather-currently",
          cacheable: true,
        },
      },
      temperature: {
        l10n: {
          id: "firefox-suggest-weather-temperature",
          args: {
            value: result.payload.temperature,
            unit: uppercaseUnit,
          },
          cacheable: true,
          excludeArgsFromCacheKey: true,
        },
      },
      weatherIcon: {
        attributes: { iconId: result.payload.iconId },
      },
      title: {
        l10n: {
          id: "firefox-suggest-weather-title",
          args: { city: result.payload.city },
          cacheable: true,
          excludeArgsFromCacheKey: true,
        },
      },
      url: {
        textContent: result.payload.url,
      },
      summaryText: lazy.UrlbarPrefs.get("weatherSimpleUI")
        ? { textContent: result.payload.currentConditions }
        : {
            l10n: {
              id: "firefox-suggest-weather-summary-text",
              args: {
                currentConditions: result.payload.currentConditions,
                forecast: result.payload.forecast,
              },
              cacheable: true,
              excludeArgsFromCacheKey: true,
            },
          },
      highLow: {
        l10n: {
          id: "firefox-suggest-weather-high-low",
          args: {
            high: result.payload.high,
            low: result.payload.low,
            unit: uppercaseUnit,
          },
          cacheable: true,
          excludeArgsFromCacheKey: true,
        },
      },
      highLowWrap: {
        l10n: {
          id: "firefox-suggest-weather-high-low",
          args: {
            high: result.payload.high,
            low: result.payload.low,
            unit: uppercaseUnit,
          },
        },
      },
      bottom: {
        l10n: {
          id: "firefox-suggest-weather-sponsored",
          args: { provider: WEATHER_PROVIDER_DISPLAY_NAME },
          cacheable: true,
        },
      },
    };
  }

  getResultCommands() {
    let commands = [
      {
        name: RESULT_MENU_COMMAND.INACCURATE_LOCATION,
        l10n: {
          id: "firefox-suggest-weather-command-inaccurate-location",
        },
      },
    ];

    if (this.canIncrementMinKeywordLength) {
      commands.push({
        name: RESULT_MENU_COMMAND.SHOW_LESS_FREQUENTLY,
        l10n: {
          id: "firefox-suggest-command-show-less-frequently",
        },
      });
    }

    commands.push(
      {
        l10n: {
          id: "firefox-suggest-command-dont-show-this",
        },
        children: [
          {
            name: RESULT_MENU_COMMAND.NOT_RELEVANT,
            l10n: {
              id: "firefox-suggest-command-not-relevant",
            },
          },
          {
            name: RESULT_MENU_COMMAND.NOT_INTERESTED,
            l10n: {
              id: "firefox-suggest-command-not-interested",
            },
          },
        ],
      },
      { name: "separator" },
      {
        name: RESULT_MENU_COMMAND.MANAGE,
        l10n: {
          id: "urlbar-result-menu-manage-firefox-suggest",
        },
      }
    );

    return commands;
  }

  handleCommand(view, result, selType) {
    switch (selType) {
      case RESULT_MENU_COMMAND.MANAGE:
        // "manage" is handled by UrlbarInput, no need to do anything here.
        break;
      // selType == "dismiss" when the user presses the dismiss key shortcut.
      case "dismiss":
      case RESULT_MENU_COMMAND.NOT_INTERESTED:
      case RESULT_MENU_COMMAND.NOT_RELEVANT:
        this.logger.info("Dismissing weather result");
        lazy.UrlbarPrefs.set("suggest.weather", false);
        result.acknowledgeDismissalL10n = {
          id: "firefox-suggest-dismissal-acknowledgment-all",
        };
        view.controller.removeResult(result);
        break;
      case RESULT_MENU_COMMAND.INACCURATE_LOCATION:
        // Currently the only way we record this feedback is in the Glean
        // engagement event. As with all commands, it will be recorded with an
        // `engagement_type` value that is the command's name, in this case
        // `inaccurate_location`.
        view.acknowledgeFeedback(result);
        break;
      case RESULT_MENU_COMMAND.SHOW_LESS_FREQUENTLY:
        view.acknowledgeFeedback(result);
        this.incrementMinKeywordLength();
        if (!this.canIncrementMinKeywordLength) {
          view.invalidateResultMenuCommands();
        }
        break;
    }
  }

  get #config() {
    let { rustBackend } = lazy.QuickSuggest;
    let config = rustBackend.isEnabled
      ? rustBackend.getConfigForSuggestionType(this.rustSuggestionTypes[0])
      : this.#rsConfig;
    return config || {};
  }

  #init() {
    // On feature init, we only update keywords and listen for changes that
    // affect keywords.
    this.#updateKeywords();
    lazy.UrlbarPrefs.addObserver(this);
    lazy.QuickSuggest.jsBackend.register(this);
  }

  #uninit() {
    lazy.QuickSuggest.jsBackend.unregister(this);
    lazy.UrlbarPrefs.removeObserver(this);
    this.#keywords = null;
    this.#merino = null;
  }

  #updateKeywords() {
    this.logger.debug("Starting keywords update");

    let nimbusKeywords = lazy.UrlbarPrefs.get("weatherKeywords");

    // If the Rust backend is enabled and weather keywords aren't defined in
    // Nimbus, Rust will manage the keywords.
    if (lazy.UrlbarPrefs.get("quickSuggestRustEnabled") && !nimbusKeywords) {
      this.logger.debug(
        "Rust enabled, no keywords in Nimbus, deferring to Rust"
      );
      this.#keywords = null;
      return;
    }

    // If the JS backend is enabled but no keywords are defined, we can't
    // possibly serve a weather suggestion.
    if (
      !lazy.UrlbarPrefs.get("quickSuggestRustEnabled") &&
      !this.#config.keywords &&
      !nimbusKeywords
    ) {
      this.logger.debug("Rust disabled, no keywords in RS or Nimbus");
      this.#keywords = null;
      return;
    }

    // At this point, keywords exist and this feature will manage them.
    let fullKeywords = nimbusKeywords || this.#config.keywords;
    let minLength = this.minKeywordLength;
    this.logger.debug(
      "Updating keywords: " + JSON.stringify({ fullKeywords, minLength })
    );

    if (!minLength) {
      this.logger.debug("Min length is undefined or zero, using full keywords");
      this.#keywords = new Set(fullKeywords);
    } else {
      // Create keywords that are prefixes of the full keywords starting at the
      // specified minimum length.
      this.#keywords = new Set();
      for (let full of fullKeywords) {
        for (let i = minLength; i <= full.length; i++) {
          this.#keywords.add(full.substring(0, i));
        }
      }
    }
  }

  onPrefChanged(pref) {
    if (pref == "weather.minKeywordLength") {
      this.#updateKeywords();
    }
  }

  get _test_merino() {
    return this.#merino;
  }

  _test_setTimeoutMs(ms) {
    this.#timeoutMs = ms < 0 ? MERINO_TIMEOUT_MS : ms;
  }

  #fetchInstance = null;
  #keywords = null;
  #merino = null;
  #rsConfig = null;
  #timeoutMs = MERINO_TIMEOUT_MS;
}
