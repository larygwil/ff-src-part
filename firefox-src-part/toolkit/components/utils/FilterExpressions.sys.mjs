/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  mozjexl: "resource://gre/modules/components-utils/mozjexl.sys.mjs",
  Sampling: "resource://gre/modules/components-utils/Sampling.sys.mjs",
});

function getPrefValue(prefKey, defaultValue) {
  switch (Services.prefs.getPrefType(prefKey)) {
    case Ci.nsIPrefBranch.PREF_STRING:
      return Services.prefs.getStringPref(prefKey);

    case Ci.nsIPrefBranch.PREF_INT:
      return Services.prefs.getIntPref(prefKey);

    case Ci.nsIPrefBranch.PREF_BOOL:
      return Services.prefs.getBoolPref(prefKey);

    case Ci.nsIPrefBranch.PREF_INVALID:
      return defaultValue;

    default:
      throw new Error(`Error getting pref ${prefKey}.`);
  }
}

ChromeUtils.defineLazyGetter(lazy, "jexl", () => {
  const jexl = new lazy.mozjexl.Jexl();
  jexl.addTransforms({
    date: dateString => new Date(dateString),
    stableSample: lazy.Sampling.stableSample,
    bucketSample: lazy.Sampling.bucketSample,
    preferenceValue: getPrefValue,
    preferenceIsUserSet: prefKey => Services.prefs.prefHasUserValue(prefKey),
    preferenceExists: prefKey =>
      Services.prefs.getPrefType(prefKey) != Ci.nsIPrefBranch.PREF_INVALID,
    keys,
    values,
    length,
    mapToProperty,
    regExpMatch,
    versionCompare,
  });
  jexl.addBinaryOp("intersect", 40, operatorIntersect);
  return jexl;
});

export var FilterExpressions = {
  getAvailableTransforms() {
    return Object.keys(lazy.jexl._transforms);
  },

  eval(expr, context = {}) {
    const onelineExpr = expr.replace(/[\t\n\r]/g, " ");
    return lazy.jexl.eval(onelineExpr, context);
  },
};

/**
 * Return an array of the given object's own keys (specifically, its enumerable
 * properties), or undefined if the argument isn't an object.
 * @param {Object} obj
 * @return {Array[String]|undefined}
 */
function keys(obj) {
  if (typeof obj !== "object" || obj === null) {
    return undefined;
  }

  return Object.keys(obj);
}

/**
 * Return an array of the given object's values (specifically, its own
 * enumerable string-keyed property values), or undefined if the argument isn't
 * an object.
 * @param {Object} obj
 * @return {Array|undefined}
 */
function values(obj) {
  if (typeof obj !== "object" || obj === null) {
    return undefined;
  }

  return Object.values(obj);
}

/**
 * Return the length of an array
 * @param {Array} arr
 * @return {number}
 */
function length(arr) {
  return Array.isArray(arr) ? arr.length : undefined;
}

/**
 * Given an input array and property name, return an array with each element of
 * the original array replaced with the given property of that element.
 * @param {Array} arr
 * @param {string} prop
 * @return {Array}
 */
function mapToProperty(arr, prop) {
  return Array.isArray(arr) ? arr.map(elem => elem[prop]) : undefined;
}

/**
 * Find all the values that are present in both lists. Returns undefined if
 * the arguments are not both Arrays.
 * @param {Array} listA
 * @param {Array} listB
 * @return {Array|undefined}
 */
function operatorIntersect(listA, listB) {
  if (!Array.isArray(listA) || !Array.isArray(listB)) {
    return undefined;
  }

  return listA.filter(item => listB.includes(item));
}

/**
 * Matches a string against a regular expression. Returns null if there are
 * no matches or an Array of matches.
 * @param {string} str
 * @param {string} pattern
 * @param {string} flags
 * @return {Array|null}
 */
function regExpMatch(str, pattern, flags) {
  const re = new RegExp(pattern, flags);
  return str.match(re);
}

/**
 * Compares v1 to v2 and returns 0 if they are equal, a negative number if
 * v1 < v2 or a positive number if v1 > v2.
 * @param {string} v1
 * @param {string} v2
 * @return {number}
 */
function versionCompare(v1, v2) {
  return Services.vc.compare(v1, v2);
}
