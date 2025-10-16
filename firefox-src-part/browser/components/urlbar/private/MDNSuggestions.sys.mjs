/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { SuggestProvider } from "moz-src:///browser/components/urlbar/private/SuggestFeature.sys.mjs";

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  QuickSuggest: "moz-src:///browser/components/urlbar/QuickSuggest.sys.mjs",
  UrlbarPrefs: "moz-src:///browser/components/urlbar/UrlbarPrefs.sys.mjs",
  UrlbarResult: "moz-src:///browser/components/urlbar/UrlbarResult.sys.mjs",
  UrlbarUtils: "moz-src:///browser/components/urlbar/UrlbarUtils.sys.mjs",
});

const RESULT_MENU_COMMAND = {
  MANAGE: "manage",
  NOT_INTERESTED: "not_interested",
  NOT_RELEVANT: "not_relevant",
};

/**
 * A feature that supports MDN suggestions.
 */
export class MDNSuggestions extends SuggestProvider {
  get enablingPreferences() {
    return [
      "mdn.featureGate",
      "suggest.mdn",
      "suggest.quicksuggest.nonsponsored",
    ];
  }

  get primaryUserControlledPreferences() {
    return ["suggest.mdn"];
  }

  get merinoProvider() {
    return "mdn";
  }

  get rustSuggestionType() {
    return "Mdn";
  }

  async makeResult(queryContext, suggestion) {
    if (!this.isEnabled) {
      // The feature is disabled on the client, but Merino may still return
      // mdn suggestions anyway, and we filter them out here.
      return null;
    }

    const url = new URL(suggestion.url);
    url.searchParams.set("utm_medium", "firefox-desktop");
    url.searchParams.set("utm_source", "firefox-suggest");
    url.searchParams.set(
      "utm_campaign",
      "firefox-mdn-web-docs-suggestion-experiment"
    );
    url.searchParams.set("utm_content", "treatment");

    const payload = {
      icon: "chrome://global/skin/icons/mdn.svg",
      url: url.href,
      originalUrl: suggestion.url,
      title: [suggestion.title, lazy.UrlbarUtils.HIGHLIGHT.TYPED],
      description: suggestion.description,
      shouldShowUrl: true,
      bottomTextL10n: { id: "firefox-suggest-mdn-bottom-text" },
    };

    return new lazy.UrlbarResult({
      type: lazy.UrlbarUtils.RESULT_TYPE.URL,
      source: lazy.UrlbarUtils.RESULT_SOURCE.OTHER_NETWORK,
      isBestMatch: true,
      showFeedbackMenu: true,
      ...lazy.UrlbarResult.payloadAndSimpleHighlights(
        queryContext.tokens,
        payload
      ),
    });
  }

  /**
   * Gets the list of commands that should be shown in the result menu for a
   * given result from the provider. All commands returned by this method should
   * be handled by implementing `onEngagement()` with the possible exception of
   * commands automatically handled by the urlbar, like "help".
   */
  getResultCommands() {
    return /** @type {UrlbarResultCommand[]} */ ([
      {
        l10n: {
          id: "firefox-suggest-command-dont-show-mdn",
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
      },
    ]);
  }

  onEngagement(queryContext, controller, details, _searchString) {
    let { result } = details;
    switch (details.selType) {
      case RESULT_MENU_COMMAND.MANAGE:
        // "manage" is handled by UrlbarInput, no need to do anything here.
        break;
      // selType == "dismiss" when the user presses the dismiss key shortcut.
      case "dismiss":
      case RESULT_MENU_COMMAND.NOT_RELEVANT:
        lazy.QuickSuggest.dismissResult(result);
        result.acknowledgeDismissalL10n = {
          id: "firefox-suggest-dismissal-acknowledgment-one-mdn",
        };
        controller.removeResult(result);
        break;
      case RESULT_MENU_COMMAND.NOT_INTERESTED:
        lazy.UrlbarPrefs.set("suggest.mdn", false);
        result.acknowledgeDismissalL10n = {
          id: "firefox-suggest-dismissal-acknowledgment-all-mdn",
        };
        controller.removeResult(result);
        break;
    }
  }
}
