/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { SuggestProvider } from "moz-src:///browser/components/urlbar/private/SuggestFeature.sys.mjs";

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  QuickSuggest: "moz-src:///browser/components/urlbar/QuickSuggest.sys.mjs",
  UrlbarResult: "moz-src:///browser/components/urlbar/UrlbarResult.sys.mjs",
  UrlbarUtils: "moz-src:///browser/components/urlbar/UrlbarUtils.sys.mjs",
});

/**
 * A feature that manages Wikipedia suggestions, both offline (Rust) and online
 * (Merino).
 */
export class WikipediaSuggestions extends SuggestProvider {
  get enablingPreferences() {
    return [
      "wikipediaFeatureGate",
      "suggest.wikipedia",
      "suggest.quicksuggest.nonsponsored",
    ];
  }

  get primaryUserControlledPreferences() {
    return ["suggest.wikipedia"];
  }

  get merinoProvider() {
    return "wikipedia";
  }

  get rustSuggestionType() {
    return "Wikipedia";
  }

  isSuggestionSponsored() {
    return false;
  }

  getSuggestionTelemetryType(suggestion) {
    // Previously online Wikipedia suggestions were not managed by this feature
    // and they had a separate telemetry type, so we carry that forward here.
    return suggestion.source == "merino" ? "wikipedia" : "adm_nonsponsored";
  }

  makeResult(queryContext, suggestion) {
    return new lazy.UrlbarResult({
      type: lazy.UrlbarUtils.RESULT_TYPE.URL,
      source: lazy.UrlbarUtils.RESULT_SOURCE.SEARCH,
      ...lazy.UrlbarResult.payloadAndSimpleHighlights(queryContext.tokens, {
        url: suggestion.url,
        title: suggestion.title,
        qsSuggestion: [
          // Merino uses snake_case, so this will be `full_keyword` for it.
          suggestion.fullKeyword ?? suggestion.full_keyword,
          lazy.UrlbarUtils.HIGHLIGHT.SUGGESTED,
        ],
        isBlockable: true,
        isManageable: true,
      }),
    });
  }

  onEngagement(queryContext, controller, details, _searchString) {
    let { result } = details;

    // Handle commands. These suggestions support the Dismissal and Manage
    // commands. Dismissal is the only one we need to handle here. `UrlbarInput`
    // handles Manage.
    if (details.selType == "dismiss") {
      lazy.QuickSuggest.dismissResult(result);
      controller.removeResult(result);
    }
  }
}
