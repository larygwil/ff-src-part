/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * This module exports a provider that offers engines with aliases as heuristic
 * results.
 */

import {
  UrlbarProvider,
  UrlbarUtils,
} from "resource:///modules/UrlbarUtils.sys.mjs";

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  UrlbarResult: "resource:///modules/UrlbarResult.sys.mjs",
  UrlbarSearchUtils: "resource:///modules/UrlbarSearchUtils.sys.mjs",
});

/**
 * Class used to create the provider.
 */
class ProviderAliasEngines extends UrlbarProvider {
  /**
   * Returns the name of this provider.
   *
   * @returns {string} the name of this provider.
   */
  get name() {
    return "AliasEngines";
  }

  /**
   * @returns {Values<typeof UrlbarUtils.PROVIDER_TYPE>}
   */
  get type() {
    return UrlbarUtils.PROVIDER_TYPE.HEURISTIC;
  }

  /**
   * Whether this provider should be invoked for the given context.
   * If this method returns false, the providers manager won't start a query
   * with this provider, to save on resources.
   *
   * @param {UrlbarQueryContext} queryContext The query context object
   */
  async isActive(queryContext) {
    return (
      (!queryContext.restrictSource ||
        queryContext.restrictSource == UrlbarUtils.RESULT_SOURCE.SEARCH) &&
      !queryContext.searchMode &&
      !!queryContext.tokens.length
    );
  }

  /**
   * Starts querying.
   *
   * @param {object} queryContext The query context object
   * @param {Function} addCallback Callback invoked by the provider to add a new
   *        result.
   */
  async startQuery(queryContext, addCallback) {
    let instance = this.queryInstance;
    let alias = queryContext.tokens[0]?.value;
    let engine = await lazy.UrlbarSearchUtils.engineForAlias(
      alias,
      queryContext.searchString
    );
    let icon = await engine?.getIconURL();
    if (!engine || instance != this.queryInstance) {
      return;
    }
    let query = UrlbarUtils.substringAfter(queryContext.searchString, alias);
    let result = new lazy.UrlbarResult(
      UrlbarUtils.RESULT_TYPE.SEARCH,
      UrlbarUtils.RESULT_SOURCE.SEARCH,
      ...lazy.UrlbarResult.payloadAndSimpleHighlights(queryContext.tokens, {
        engine: engine.name,
        keyword: alias,
        query: query.trimStart(),
        icon,
      })
    );
    result.heuristic = true;
    addCallback(this, result);
  }
}

export var UrlbarProviderAliasEngines = new ProviderAliasEngines();
