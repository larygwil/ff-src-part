/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * MLSuggest helps with ML based suggestions around intents and location.
 */

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  createEngine: "chrome://global/content/ml/EngineProcess.sys.mjs",
  UrlbarPrefs: "resource:///modules/UrlbarPrefs.sys.mjs",
});

// List of prepositions used in subject cleaning.
const PREPOSITIONS = ["in", "at", "on", "for", "to", "near"];

/**
 * Class for handling ML-based suggestions using intent and NER models.
 *
 * @class
 */
class _MLSuggest {
  #modelEngines = {};

  INTENT_OPTIONS = {
    taskName: "text-classification",
    featureId: "suggest-intent-classification",
    engineId: "ml-suggest-intent",
    timeoutMS: -1,
    numThreads: 2,
  };

  NER_OPTIONS = {
    taskName: "token-classification",
    featureId: "suggest-NER",
    engineId: "ml-suggest-ner",
    timeoutMS: -1,
    numThreads: 2,
  };

  // Helper to wrap createEngine for testing purpose
  createEngine(args) {
    return lazy.createEngine(args);
  }

  /**
   * Initializes the intent and NER models.
   */
  async initialize() {
    await Promise.all([
      this.#initializeModelEngine(this.INTENT_OPTIONS),
      this.#initializeModelEngine(this.NER_OPTIONS),
    ]);
  }

  /**
   * Generates ML-based suggestions by finding intent, detecting entities, and
   * combining locations.
   *
   * @param {string} query
   *   The user's input query.
   * @returns {object | null}
   *   The suggestion result including intent, location, and subject, or null if
   *   an error occurs.
   *   {string} intent
   *     The predicted intent label of the query. Possible values include:
   *       - 'information_intent': For queries seeking general information.
   *       - 'yelp_intent': For queries related to local businesses or services.
   *       - 'navigation_intent': For queries with navigation-related actions.
   *       - 'travel_intent': For queries showing travel-related interests.
   *       - 'purchase_intent': For queries with purchase or shopping intent.
   *       - 'weather_intent': For queries asking about weather or forecasts.
   *       - 'translation_intent': For queries seeking translations.
   *       - 'unknown': When the intent cannot be classified with confidence.
   *       - '' (empty string): Returned when model probabilities for all intents
   *         are below the intent threshold.
   *   - {object|null} location: The detected location from the query, which is
   *     an object with `city` and `state` fields:
   *     - {string|null} city: The detected city, or `null` if no city is found.
   *     - {string|null} state: The detected state, or `null` if no state is found.
   *   {string} subject
   *     The subject of the query after location is removed.
   *   {object} metrics
   *     The combined metrics from NER model results, representing additional
   *     information about the model's performance.
   */
  async makeSuggestions(query) {
    let intentRes, nerResult;
    try {
      [intentRes, nerResult] = await Promise.all([
        this._findIntent(query),
        this._findNER(query),
      ]);
    } catch (error) {
      return null;
    }

    if (!intentRes || !nerResult) {
      return null;
    }

    const locationResVal = await this.#combineLocations(
      nerResult,
      lazy.UrlbarPrefs.get("nerThreshold")
    );

    const intentLabel = await this.#applyIntentThreshold(
      intentRes,
      lazy.UrlbarPrefs.get("intentThreshold")
    );

    return {
      intent: intentLabel,
      location: locationResVal,
      subject: this.#findSubjectFromQuery(query, locationResVal),
      metrics: { intent: intentRes.metrics, ner: nerResult.metrics },
    };
  }

  /**
   * Shuts down all initialized engines.
   */
  async shutdown() {
    for (const [key, engine] of Object.entries(this.#modelEngines)) {
      try {
        await engine.terminate?.();
      } finally {
        // Remove each engine after termination
        delete this.#modelEngines[key];
      }
    }
  }

  async #initializeModelEngine(options) {
    const engineId = options.engineId;

    // uses cache if engine was used
    if (this.#modelEngines[engineId]) {
      return this.#modelEngines[engineId];
    }

    const engine = await this.createEngine({ ...options, engineId });
    // Cache the engine
    this.#modelEngines[engineId] = engine;
    return engine;
  }

  /**
   * Finds the intent of the query using the intent classification model.
   * (This has been made public to enable testing)
   *
   * @param {string} query
   *   The user's input query.
   * @param {object} options
   *   The options for the engine pipeline
   * @returns {object[] | null}
   *   The intent results or null if the model is not initialized.
   */
  async _findIntent(query, options = {}) {
    const engineIntentClassifier =
      this.#modelEngines[this.INTENT_OPTIONS.engineId];
    if (!engineIntentClassifier) {
      return null;
    }

    let res;
    try {
      res = await engineIntentClassifier.run({
        args: [query],
        options,
      });
    } catch (error) {
      // engine could timeout or fail, so remove that from cache
      // and reinitialize
      this.#modelEngines[this.INTENT_OPTIONS.engineId] = null;
      this.#initializeModelEngine(this.INTENT_OPTIONS);
      return null;
    }
    return res;
  }

  /**
   * Finds named entities in the query using the NER model.
   * (This has been made public to enable testing)
   *
   * @param {string} query
   *   The user's input query.
   * @param {object} options
   *   The options for the engine pipeline
   * @returns {object[] | null}
   *   The NER results or null if the model is not initialized.
   */
  async _findNER(query, options = {}) {
    const engineNER = this.#modelEngines[this.NER_OPTIONS.engineId];
    try {
      return engineNER?.run({ args: [query], options });
    } catch (error) {
      // engine could timeout or fail, so remove that from cache
      // and reinitialize
      this.#modelEngines[this.NER_OPTIONS.engineId] = null;
      this.#initializeModelEngine(this.NER_OPTIONS);
      return null;
    }
  }

  /**
   * Applies a confidence threshold to determine the intent label.
   *
   * If the highest-scoring intent in the result exceeds the threshold, its label
   * is returned; otherwise, the label defaults to 'unknown'.
   *
   * @param {object[]} intentResult
   *   The result of the intent classification model, where each item includes
   *   a `label` and `score`.
   * @param {number} intentThreshold
   *   The confidence threshold for accepting the intent label.
   * @returns {string}
   *   The determined intent label or 'unknown' if the threshold is not met.
   */
  async #applyIntentThreshold(intentResult, intentThreshold) {
    return intentResult[0]?.score > intentThreshold
      ? intentResult[0].label
      : "";
  }

  /**
   * Combines location tokens detected by NER into separate city and state
   * components. This method processes city, state, and combined city-state
   * entities, returning an object with `city` and `state` fields.
   *
   * Handles the following entity types:
   * - B-CITY, I-CITY: Identifies city tokens.
   * - B-STATE, I-STATE: Identifies state tokens.
   * - B-CITYSTATE, I-CITYSTATE: Identifies tokens that represent a combined
   *   city and state.
   *
   * @param {object[]} nerResult
   *   The NER results containing tokens and their corresponding entity labels.
   * @param {number} nerThreshold
   *   The confidence threshold for including entities. Tokens with a confidence
   *   score below this threshold will be ignored.
   * @returns {object}
   *   An object with `city` and `state` fields:
   *   - {string|null} city: The detected city, or `null` if no city is found.
   *   - {string|null} state: The detected state, or `null` if no state is found.
   */
  async #combineLocations(nerResult, nerThreshold) {
    let cityResult = [];
    let stateResult = [];
    let cityStateResult = [];

    for (let i = 0; i < nerResult.length; i++) {
      const res = nerResult[i];

      // Handle B-CITY, I-CITY
      if (
        (res.entity === "B-CITY" || res.entity === "I-CITY") &&
        res.score > nerThreshold
      ) {
        if (res.word.startsWith("##") && cityResult.length) {
          cityResult[cityResult.length - 1] += res.word.slice(2);
        } else {
          cityResult.push(res.word);
        }
      }
      // Handle B-STATE, I-STATE
      else if (
        (res.entity === "B-STATE" || res.entity === "I-STATE") &&
        res.score > nerThreshold
      ) {
        if (res.word.startsWith("##") && stateResult.length) {
          stateResult[stateResult.length - 1] += res.word.slice(2);
        } else {
          stateResult.push(res.word);
        }
      }
      // Handle B-CITYSTATE, I-CITYSTATE
      else if (
        (res.entity === "B-CITYSTATE" || res.entity === "I-CITYSTATE") &&
        res.score > nerThreshold
      ) {
        if (res.word.startsWith("##") && cityStateResult.length) {
          cityStateResult[cityStateResult.length - 1] += res.word.slice(2);
        } else {
          cityStateResult.push(res.word);
        }
      }
    }

    // Handle city_state as combined and split into city and state
    if (cityStateResult.length) {
      let cityStateSplit = cityStateResult.join(" ").split(",");
      return {
        city: cityStateSplit[0]?.trim() || null,
        state: cityStateSplit[1]?.trim() || null,
      };
    }

    // Return city and state as separate components if detected
    return {
      city: cityResult.join(" ").trim() || null,
      state: stateResult.join(" ").trim() || null,
    };
  }

  #findSubjectFromQuery(query, location) {
    // If location is null or no city/state, return the entire query
    if (!location || (!location.city && !location.state)) {
      return query;
    }

    // Remove the city and state values from the query
    let locValues = Object.values(location).filter(v => !!v);
    let words = query
      .trim()
      .split(/\s+|,/)
      .filter(w => !!w && !locValues.includes(w));

    let subjectWords = this.#cleanSubject(words);
    return subjectWords.join(" ");
  }

  #cleanSubject(words) {
    // Remove trailing prepositions from the list of words
    while (words.length && PREPOSITIONS.includes(words[words.length - 1])) {
      words.pop();
    }
    return words;
  }
}

// Export the singleton instance
export var MLSuggest = new _MLSuggest();
