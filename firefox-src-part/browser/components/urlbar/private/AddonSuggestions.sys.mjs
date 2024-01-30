/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { BaseFeature } from "resource:///modules/urlbar/private/BaseFeature.sys.mjs";

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  AddonManager: "resource://gre/modules/AddonManager.sys.mjs",
  QuickSuggest: "resource:///modules/QuickSuggest.sys.mjs",
  QuickSuggestRemoteSettings:
    "resource:///modules/urlbar/private/QuickSuggestRemoteSettings.sys.mjs",
  SuggestionsMap:
    "resource:///modules/urlbar/private/QuickSuggestRemoteSettings.sys.mjs",
  UrlbarPrefs: "resource:///modules/UrlbarPrefs.sys.mjs",
  UrlbarResult: "resource:///modules/UrlbarResult.sys.mjs",
  UrlbarUtils: "resource:///modules/UrlbarUtils.sys.mjs",
  UrlbarView: "resource:///modules/UrlbarView.sys.mjs",
});

const VIEW_TEMPLATE = {
  attributes: {
    selectable: true,
  },
  children: [
    {
      name: "content",
      tag: "span",
      overflowable: true,
      children: [
        {
          name: "icon",
          tag: "img",
        },
        {
          name: "header",
          tag: "span",
          children: [
            {
              name: "title",
              tag: "span",
              classList: ["urlbarView-title"],
            },
            {
              name: "separator",
              tag: "span",
              classList: ["urlbarView-title-separator"],
            },
            {
              name: "url",
              tag: "span",
              classList: ["urlbarView-url"],
            },
          ],
        },
        {
          name: "description",
          tag: "span",
        },
        {
          name: "footer",
          tag: "span",
          children: [
            {
              name: "ratingContainer",
              tag: "span",
              children: [
                {
                  classList: ["urlbarView-dynamic-addons-rating"],
                  name: "rating0",
                  tag: "span",
                },
                {
                  classList: ["urlbarView-dynamic-addons-rating"],
                  name: "rating1",
                  tag: "span",
                },
                {
                  classList: ["urlbarView-dynamic-addons-rating"],
                  name: "rating2",
                  tag: "span",
                },
                {
                  classList: ["urlbarView-dynamic-addons-rating"],
                  name: "rating3",
                  tag: "span",
                },
                {
                  classList: ["urlbarView-dynamic-addons-rating"],
                  name: "rating4",
                  tag: "span",
                },
              ],
            },
            {
              name: "reviews",
              tag: "span",
            },
          ],
        },
      ],
    },
  ],
};

const RESULT_MENU_COMMAND = {
  HELP: "help",
  NOT_INTERESTED: "not_interested",
  NOT_RELEVANT: "not_relevant",
  SHOW_LESS_FREQUENTLY: "show_less_frequently",
};

/**
 * A feature that supports Addon suggestions.
 */
export class AddonSuggestions extends BaseFeature {
  constructor() {
    super();
    lazy.UrlbarResult.addDynamicResultType("addons");
    lazy.UrlbarView.addDynamicViewTemplate("addons", VIEW_TEMPLATE);
  }

  get shouldEnable() {
    return (
      lazy.UrlbarPrefs.get("addonsFeatureGate") &&
      lazy.UrlbarPrefs.get("suggest.addons") &&
      lazy.UrlbarPrefs.get("suggest.quicksuggest.nonsponsored")
    );
  }

  get enablingPreferences() {
    return ["suggest.addons", "suggest.quicksuggest.nonsponsored"];
  }

  enable(enabled) {
    if (enabled) {
      lazy.QuickSuggestRemoteSettings.register(this);
    } else {
      lazy.QuickSuggestRemoteSettings.unregister(this);
    }
  }

  queryRemoteSettings(searchString) {
    const suggestions = this.#suggestionsMap?.get(searchString);
    if (!suggestions) {
      return [];
    }

    return suggestions.map(suggestion => ({
      icon: suggestion.icon,
      url: suggestion.url,
      title: suggestion.title,
      description: suggestion.description,
      rating: suggestion.rating,
      number_of_ratings: suggestion.number_of_ratings,
      guid: suggestion.guid,
      score: suggestion.score,
      is_top_pick: suggestion.is_top_pick,
    }));
  }

  async onRemoteSettingsSync(rs) {
    const records = await rs.get({ filters: { type: "amo-suggestions" } });
    if (rs != lazy.QuickSuggestRemoteSettings.rs) {
      return;
    }

    const suggestionsMap = new lazy.SuggestionsMap();

    for (const record of records) {
      const { buffer } = await rs.attachments.download(record);
      if (rs != lazy.QuickSuggestRemoteSettings.rs) {
        return;
      }

      const results = JSON.parse(new TextDecoder("utf-8").decode(buffer));

      // The keywords in remote settings are full keywords. Map each one to an
      // array containing the full keyword's first word plus every subsequent
      // prefix of the full keyword.
      await suggestionsMap.add(results, fullKeyword => {
        let keywords = [fullKeyword];
        let spaceIndex = fullKeyword.search(/\s/);
        if (spaceIndex >= 0) {
          for (let i = spaceIndex; i < fullKeyword.length; i++) {
            keywords.push(fullKeyword.substring(0, i));
          }
        }
        return keywords;
      });
      if (rs != lazy.QuickSuggestRemoteSettings.rs) {
        return;
      }
    }

    this.#suggestionsMap = suggestionsMap;
  }

  async makeResult(queryContext, suggestion, searchString) {
    if (!this.isEnabled) {
      // The feature is disabled on the client, but Merino may still return
      // addon suggestions anyway, and we filter them out here.
      return null;
    }

    // If the user hasn't clicked the "Show less frequently" command, the
    // suggestion can be shown. Otherwise, the suggestion can be shown if the
    // user typed more than one word with at least `showLessFrequentlyCount`
    // characters after the first word, including spaces.
    if (this.showLessFrequentlyCount) {
      let spaceIndex = searchString.search(/\s/);
      if (
        spaceIndex < 0 ||
        searchString.length - spaceIndex < this.showLessFrequentlyCount
      ) {
        return null;
      }
    }

    // If is_top_pick is not specified, handle it as top pick suggestion.
    suggestion.is_top_pick = suggestion.is_top_pick ?? true;

    const { guid, rating, number_of_ratings } =
      suggestion.source === "remote-settings"
        ? suggestion
        : suggestion.custom_details.amo;

    const addon = await lazy.AddonManager.getAddonByID(guid);
    if (addon) {
      // Addon suggested is already installed.
      return null;
    }

    const payload = {
      source: suggestion.source,
      icon: suggestion.icon,
      url: suggestion.url,
      title: suggestion.title,
      description: suggestion.description,
      rating: Number(rating),
      reviews: Number(number_of_ratings),
      helpUrl: lazy.QuickSuggest.HELP_URL,
      shouldNavigate: true,
      dynamicType: "addons",
      telemetryType: "amo",
    };

    return Object.assign(
      new lazy.UrlbarResult(
        lazy.UrlbarUtils.RESULT_TYPE.DYNAMIC,
        lazy.UrlbarUtils.RESULT_SOURCE.SEARCH,
        ...lazy.UrlbarResult.payloadAndSimpleHighlights(
          queryContext.tokens,
          payload
        )
      ),
      { showFeedbackMenu: true }
    );
  }

  getViewUpdate(result) {
    const treatment = lazy.UrlbarPrefs.get("addonsUITreatment");
    const rating = result.payload.rating;

    return {
      content: {
        attributes: { treatment },
      },
      icon: {
        attributes: {
          src: result.payload.icon,
        },
      },
      url: {
        textContent: result.payload.url,
      },
      title: {
        textContent: result.payload.title,
      },
      description: {
        textContent: result.payload.description,
      },
      rating0: {
        attributes: {
          fill: this.#getRatingStar(0, rating),
        },
      },
      rating1: {
        attributes: {
          fill: this.#getRatingStar(1, rating),
        },
      },
      rating2: {
        attributes: {
          fill: this.#getRatingStar(2, rating),
        },
      },
      rating3: {
        attributes: {
          fill: this.#getRatingStar(3, rating),
        },
      },
      rating4: {
        attributes: {
          fill: this.#getRatingStar(4, rating),
        },
      },
      reviews: {
        l10n:
          treatment === "b"
            ? { id: "firefox-suggest-addons-recommended" }
            : {
                id: "firefox-suggest-addons-reviews",
                args: {
                  quantity: result.payload.reviews,
                },
              },
      },
    };
  }

  getResultCommands(result) {
    const commands = [];

    if (this.canShowLessFrequently) {
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
        name: RESULT_MENU_COMMAND.HELP,
        l10n: {
          id: "urlbar-result-menu-learn-more-about-firefox-suggest",
        },
      }
    );

    return commands;
  }

  handlePossibleCommand(queryContext, result, selType) {
    switch (selType) {
      case RESULT_MENU_COMMAND.HELP:
        // "help" is handled by UrlbarInput, no need to do anything here.
        break;
      // selType == "dismiss" when the user presses the dismiss key shortcut.
      case "dismiss":
      case RESULT_MENU_COMMAND.NOT_INTERESTED:
      case RESULT_MENU_COMMAND.NOT_RELEVANT:
        lazy.UrlbarPrefs.set("suggest.addons", false);
        queryContext.view.acknowledgeDismissal(result);
        break;
      case RESULT_MENU_COMMAND.SHOW_LESS_FREQUENTLY:
        queryContext.view.acknowledgeFeedback(result);
        this.incrementShowLessFrequentlyCount();
        break;
    }
  }

  #getRatingStar(nth, rating) {
    // 0    <= x <  0.25 = empty
    // 0.25 <= x <  0.75 = half
    // 0.75 <= x <= 1    = full
    // ... et cetera, until x <= 5.
    const distanceToFull = rating - nth;
    if (distanceToFull < 0.25) {
      return "empty";
    }
    if (distanceToFull < 0.75) {
      return "half";
    }
    return "full";
  }

  incrementShowLessFrequentlyCount() {
    if (this.canShowLessFrequently) {
      lazy.UrlbarPrefs.set(
        "addons.showLessFrequentlyCount",
        this.showLessFrequentlyCount + 1
      );
    }
  }

  get showLessFrequentlyCount() {
    const count = lazy.UrlbarPrefs.get("addons.showLessFrequentlyCount") || 0;
    return Math.max(count, 0);
  }

  get canShowLessFrequently() {
    const cap =
      lazy.UrlbarPrefs.get("addonsShowLessFrequentlyCap") ||
      lazy.QuickSuggestRemoteSettings.config.show_less_frequently_cap ||
      0;
    return !cap || this.showLessFrequentlyCount < cap;
  }

  #suggestionsMap = null;
}
