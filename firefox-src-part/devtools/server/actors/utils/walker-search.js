/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

loader.lazyRequireGetter(
  this,
  "isWhitespaceTextNode",
  "resource://devtools/server/actors/inspector/utils.js",
  true
);

/**
 * The walker-search module provides a simple API to index and search strings
 * and elements inside a given document.
 * It indexes tag names, attribute names and values, and text contents.
 * It provides a simple search function that returns a list of nodes that
 * matched.
 */

class WalkerIndex {
  /**
   * The WalkerIndex class indexes the document (and all subdocs) from
   * a given walker.
   *
   * It is only indexed the first time the data is accessed and will be
   * re-indexed if a mutation happens between requests.
   *
   * @param {Walker} walker The walker to be indexed
   */
  constructor(walker) {
    this.walker = walker;
    this.clearIndex = this.clearIndex.bind(this);

    // Kill the index when mutations occur, the next data get will re-index.
    this.walker.on("any-mutation", this.clearIndex);
  }

  /**
   * Destroy this instance, releasing all data and references
   */
  destroy() {
    this.walker.off("any-mutation", this.clearIndex);
  }

  clearIndex() {
    if (!this.currentlyIndexing) {
      this._data = null;
    }
  }

  get doc() {
    return this.walker.rootDoc;
  }

  /**
   * Get the indexed data
   * This getter also indexes if it hasn't been done yet or if the state is
   * dirty
   *
   * @returns Map<String, Array<{type:String, node:DOMNode}>>
   *          A Map keyed on the searchable value, containing an array with
   *          objects containing the 'type' (one of ALL_RESULTS_TYPES), and
   *          the DOM Node.
   */
  get data() {
    if (!this._data) {
      this._data = new Map();
      this.index();
    }

    return this._data;
  }

  _addToIndex(type, node, value) {
    // Add an entry for this value if there isn't one
    const entry = this._data.get(value);
    if (!entry) {
      this._data.set(value, []);
    }

    // Add the type/node to the list
    this._data.get(value).push({
      type,
      node,
    });
  }

  index() {
    // Handle case where iterating nextNode() with the deepTreeWalker triggers
    // a mutation (Bug 1222558)
    this.currentlyIndexing = true;

    const documentWalker = this.walker.getDocumentWalker(this.doc);
    while (documentWalker.nextNode()) {
      const node = documentWalker.currentNode;

      if (
        this.walker.targetActor.ignoreSubFrames &&
        node.ownerDocument !== this.doc
      ) {
        continue;
      }

      if (node.nodeType === 1) {
        // For each element node, we get the tagname and all attributes names
        // and values
        const localName = node.localName;
        if (localName === "_moz_generated_content_marker") {
          this._addToIndex("tag", node, "::marker");
          this._addToIndex("text", node, node.textContent.trim());
        } else if (localName === "_moz_generated_content_before") {
          this._addToIndex("tag", node, "::before");
          this._addToIndex("text", node, node.textContent.trim());
        } else if (localName === "_moz_generated_content_after") {
          this._addToIndex("tag", node, "::after");
          this._addToIndex("text", node, node.textContent.trim());
        } else {
          this._addToIndex("tag", node, node.localName);
        }

        for (const { name, value } of node.attributes) {
          this._addToIndex("attributeName", node, name);
          this._addToIndex("attributeValue", node, value);
        }
      } else if (node.textContent && node.textContent.trim().length) {
        // For comments and text nodes, we get the text
        this._addToIndex("text", node, node.textContent.trim());
      }
    }

    this.currentlyIndexing = false;
  }
}

exports.WalkerIndex = WalkerIndex;

class WalkerSearch {
  /**
   * The WalkerSearch class provides a way to search an indexed document as well
   * as find elements that match a given css selector.
   *
   * Usage example:
   * let s = new WalkerSearch(doc);
   * let res = s.search("lang", index);
   * for (let {matched, results} of res) {
   *   for (let {node, type} of results) {
   *     console.log("The query matched a node's " + type);
   *     console.log("Node that matched", node);
   *    }
   * }
   * s.destroy();
   *
   * @param {Walker} the walker to be searched
   */
  constructor(walker) {
    this.walker = walker;
    this.index = new WalkerIndex(this.walker);
  }

  destroy() {
    this.index.destroy();
    this.walker = null;
  }

  _addResult(node, type, results) {
    if (!results.has(node)) {
      results.set(node, []);
    }

    const matches = results.get(node);

    // Do not add if the exact same result is already in the list
    let isKnown = false;
    for (const match of matches) {
      if (match.type === type) {
        isKnown = true;
        break;
      }
    }

    if (!isKnown) {
      matches.push({ type });
    }
  }

  _searchIndex(query, options, results) {
    for (const [matched, res] of this.index.data) {
      if (!options.searchMethod(query, matched)) {
        continue;
      }

      // Add any relevant results (skipping non-requested options).
      res
        .filter(entry => {
          return options.types.includes(entry.type);
        })
        .forEach(({ node, type }) => {
          this._addResult(node, type, results);
        });
    }
  }

  _attributeMatch(attributeValue, expectedAttributeValue, isExactMatch) {
    if (expectedAttributeValue === undefined) {
      return true;
    }
    if (isExactMatch) {
      return attributeValue === expectedAttributeValue;
    }
    return attributeValue.startsWith(expectedAttributeValue);
  }

  _searchAttribute(query, options, results) {
    if (
      !options.types.includes("attributeName") ||
      !options.types.includes("attributeValue")
    ) {
      return;
    }
    if (!query.includes("=") || query.trim() === "=") {
      return;
    }

    let [attributeName, attributeValue] = query.split("=", 2);

    // Remove leading and trailing quotes
    const isExactMatch =
      attributeValue.startsWith('"') && attributeValue.endsWith('"');
    attributeValue = attributeValue?.replace(/(^")|("$)/gi, "");

    if (attributeName === undefined || attributeName === "") {
      for (const [str, entries] of this.index.data) {
        if (!this._attributeMatch(str, attributeValue, isExactMatch)) {
          continue;
        }

        for (const entry of entries) {
          if (entry.type !== "attributeValue") {
            continue;
          }
          this._addResult(entry.node, "attributeValue", results);
        }
      }
    } else if (this.index.data.has(attributeName)) {
      for (const entry of this.index.data.get(attributeName)) {
        if (entry.type !== "attributeName") {
          continue;
        }
        if (
          !this._attributeMatch(
            entry.node.attributes[attributeName].value,
            attributeValue,
            isExactMatch
          )
        ) {
          continue;
        }
        this._addResult(entry.node, "attributeName", results);
      }
    }
  }

  _searchSelectors(query, options, results) {
    if (!options.types.includes("selector")) {
      return;
    }

    // If the query is just one "word", no need to search because _searchIndex
    // will lead the same results since it has access to tagnames anyway
    if (
      // regular tagname
      query.match(/^[a-z]+$/i) ||
      // custom element names
      InspectorUtils.isCustomElementName(
        query,
        this.walker.targetActor.window.document.documentElement.namespaceURI
      )
    ) {
      return;
    }

    // If the query is not a valid selector, bail
    if (!CSS.supports(`selector(${query})`)) {
      return;
    }

    const nodes = this.walker._multiFrameQuerySelectorAll(query);
    for (const node of nodes) {
      this._addResult(node, "selector", results);
    }
  }

  _searchXPath(query, options, results) {
    if (!options.types.includes("xpath")) {
      return;
    }

    const nodes = this.walker._multiFrameXPath(query);
    for (const node of nodes) {
      // Exclude text nodes that only contain whitespace
      // because they are not displayed in the Inspector.
      if (!isWhitespaceTextNode(node)) {
        this._addResult(node, "xpath", results);
      }
    }
  }

  /**
   * Search the document
   * @param {String} query What to search for
   * @param {Object} options The following options are accepted:
   * - searchMethod {String} one of WalkerSearch.SEARCH_METHOD_*
   *   defaults to WalkerSearch.SEARCH_METHOD_CONTAINS (does not apply to
   *   selector and XPath search types)
   * - types {Array} a list of things to search for (tag, text, attributes, etc)
   *   defaults to WalkerSearch.ALL_RESULTS_TYPES
   * @return {Array} An array is returned with each item being an object like:
   * {
   *   node: <the dom node that matched>,
   *   type: <the type of match: one of WalkerSearch.ALL_RESULTS_TYPES>
   * }
   */
  search(query, options = {}) {
    options.searchMethod =
      options.searchMethod || WalkerSearch.SEARCH_METHOD_CONTAINS;
    options.types = options.types || WalkerSearch.ALL_RESULTS_TYPES;

    // Empty strings will return no results, as will non-string input
    if (typeof query !== "string") {
      query = "";
    }

    // Store results in a map indexed by nodes to avoid duplicate results
    const results = new Map();

    // Search through the indexed data
    this._searchIndex(query, options, results);

    // Search with querySelectorAll
    this._searchSelectors(query, options, results);

    // Search for attributeName=attributeValue pairs
    this._searchAttribute(query, options, results);

    // Search with XPath
    this._searchXPath(query, options, results);

    // Concatenate all results into an Array to return
    const resultList = [];
    for (const [node, matches] of results) {
      for (const { type } of matches) {
        resultList.push({
          node,
          type,
        });
      }
    }

    const documents = this.walker.targetActor.windows.map(win => win.document);

    // Sort the resulting nodes by order of appearance in the DOM
    resultList.sort((a, b) => {
      // Disconnected nodes won't get good results from compareDocumentPosition
      // so check the order of their document instead.
      if (a.node.ownerDocument != b.node.ownerDocument) {
        const indA = documents.indexOf(a.node.ownerDocument);
        const indB = documents.indexOf(b.node.ownerDocument);
        return indA - indB;
      }
      // If the same document, then sort on DOCUMENT_POSITION_FOLLOWING (4)
      // which means B is after A.
      return a.node.compareDocumentPosition(b.node) & 4 ? -1 : 1;
    });

    return resultList;
  }
}

WalkerSearch.SEARCH_METHOD_CONTAINS = (query, candidate) => {
  return query && candidate.toLowerCase().includes(query.toLowerCase());
};

WalkerSearch.ALL_RESULTS_TYPES = [
  "tag",
  "text",
  "attributeName",
  "attributeValue",
  "selector",
  "xpath",
];

exports.WalkerSearch = WalkerSearch;
