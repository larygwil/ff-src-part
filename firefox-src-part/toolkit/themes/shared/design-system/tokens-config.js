/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* eslint-env node */

const StyleDictionary = require("style-dictionary");
const { createPropertyFormatter } = StyleDictionary.formatHelpers;
const figmaConfig = require("./figma-tokens-config");

const TOKEN_SECTIONS = {
  "Attention Dot": "attention-dot",
  "Background Color": "background-color",
  Border: "border",
  "Box Shadow": "box-shadow",
  Button: "button",
  Checkbox: "checkbox",
  Color: ["brand-color", "color", "platform-color"],
  "Focus Outline": "focus-outline",
  "Font Size": "font-size",
  "Font Weight": "font-weight",
  Icon: "icon",
  "Input - Text": "input-text",
  "Input - Space": "input-space",
  Link: "link",
  "Outline Color": "outline-color",
  Size: "size",
  Space: "space",
  Text: "text",
  Unspecified: "",
};
const TSHIRT_ORDER = [
  "circle",
  "xxxsmall",
  "xxsmall",
  "xsmall",
  "small",
  "medium",
  "large",
  "xlarge",
  "xxlarge",
  "xxxlarge",
];
const STATE_ORDER = [
  "base",
  "default",
  "root",
  "hover",
  "active",
  "focus",
  "disabled",
];

/**
 * Adds the Mozilla Public License header in one comment and
 * how to make changes in the generated output files via the
 * design-tokens.json file in another comment. Also imports
 * tokens-shared.css when applicable.
 *
 * @param {string} surface
 *  Desktop surface, either "brand" or "platform". Determines
 *  whether or not we need to import tokens-shared.css.
 * @returns {string} Formatted comment header string
 */
let customFileHeader = ({ surface, platform }) => {
  let licenseString = [
    "/* This Source Code Form is subject to the terms of the Mozilla Public",
    " * License, v. 2.0. If a copy of the MPL was not distributed with this",
    " * file, You can obtain one at http://mozilla.org/MPL/2.0/. */",
  ].join("\n");

  let commentString = [
    "/* DO NOT EDIT this file directly, instead modify design-tokens.json",
    " * and run `npm run build` to see your changes. */",
  ].join("\n");

  let cssImport = surface
    ? `@import url("chrome://global/skin/design-system/tokens-shared.css");\n\n`
    : "";
  let layerString =
    !surface && !platform
      ? `@layer tokens-foundation, tokens-prefers-contrast, tokens-forced-colors;\n\n`
      : "";

  return [
    licenseString + "\n\n" + commentString + "\n\n" + cssImport + layerString,
  ];
};

const NEST_MEDIA_QUERIES_COMMENT = `/* Bug 1879900: Can't nest media queries inside of :host, :root selector
   until Bug 1879349 lands */`;

const MEDIA_QUERY_PROPERTY_MAP = {
  "forced-colors": "forcedColors",
  "prefers-contrast": "prefersContrast",
};

function formatBaseTokenNames(str) {
  return str.replaceAll(/(?<tokenName>\w+)-base(?=\b)/g, "$<tokenName>");
}

/**
 * Creates a surface-specific formatter. The formatter is used to build
 * our different CSS files, including "prefers-contrast" and "forced-colors"
 * media queries. See more at
 * https://amzn.github.io/style-dictionary/#/formats?id=formatter
 *
 * @param {string} surface
 *  Which desktop area we are generating CSS for.
 *  Either "brand" (i.e. in-content) or "platform" (i.e. chrome).
 * @returns {Function} - Formatter function that returns a CSS string.
 */
const createDesktopFormat = surface => args => {
  return formatBaseTokenNames(
    customFileHeader({ surface }) +
      formatTokens({
        surface,
        args,
      }) +
      formatTokens({
        mediaQuery: "prefers-contrast",
        surface,
        args,
      }) +
      formatTokens({
        mediaQuery: "forced-colors",
        surface,
        args,
      })
  );
};

/**
 * Formats a subset of tokens into CSS. Wraps token CSS in a media query when
 * applicable.
 *
 * @param {object} tokenArgs
 * @param {string} [tokenArgs.mediaQuery]
 *  Media query formatted CSS should be wrapped in. This is used
 *  to determine what property we are parsing from the token values.
 * @param {string} [tokenArgs.surface]
 *  Specifies a desktop surface, either "brand" or "platform".
 * @param {object} tokenArgs.args
 *  Formatter arguments provided by style-dictionary. See more at
 *  https://amzn.github.io/style-dictionary/#/formats?id=formatter
 * @returns {string} Tokens formatted into a CSS string.
 */
function formatTokens({ mediaQuery, surface, args }) {
  let prop = MEDIA_QUERY_PROPERTY_MAP[mediaQuery] ?? "default";
  let dictionary = Object.assign({}, args.dictionary);
  let tokens = [];

  dictionary.allTokens.forEach(token => {
    let originalVal = getOriginalTokenValue(token, prop, surface);
    if (originalVal != undefined) {
      let formattedToken = transformTokenValue(token, originalVal, dictionary);
      tokens.push(formattedToken);
    }
  });

  if (!tokens.length) {
    return "";
  }

  dictionary.allTokens = dictionary.allProperties = tokens;

  let formattedVars = formatVariables({
    format: "css",
    dictionary,
    outputReferences: args.options.outputReferences,
    formatting: {
      indentation: mediaQuery ? "      " : "    ",
    },
  });

  let layer = `tokens-${mediaQuery ?? "foundation"}`;
  // Weird spacing below is unfortunately necessary for formatting the built CSS.
  if (mediaQuery) {
    return `
${NEST_MEDIA_QUERIES_COMMENT}
@layer ${layer} {
  @media (${mediaQuery}) {
    :root,
    :host(.anonymous-content-host) {
${formattedVars}
    }
  }
}
`;
  }

  return `@layer ${layer} {
  :root,
  :host(.anonymous-content-host) {
${formattedVars}
  }
}
`;
}

/**
 * Finds the original value of a token for a given media query and surface.
 *
 * @param {object} token - Token object parsed by style-dictionary.
 * @param {string} prop - Name of the property we're querying for.
 * @param {string} surface
 *  The desktop surface we're generating CSS for, either "brand" or "platform".
 * @returns {string} The original token value based on our parameters.
 */
function getOriginalTokenValue(token, prop, surface) {
  if (surface) {
    return token.original.value[surface]?.[prop];
  } else if (prop == "default" && typeof token.original.value != "object") {
    return token.original.value;
  }
  return token.original.value?.[prop];
}

/**
 * Updates a token's value to the relevant original value after resolving
 * variable references.
 *
 * @param {object} token - Token object parsed from JSON by style-dictionary.
 * @param {string} originalVal
 *  Original value of the token for the combination of surface and media query.
 * @param {object} dictionary
 *  Object of transformed tokens and helper fns provided by style-dictionary.
 * @returns {object} Token object with an updated value.
 */
function transformTokenValue(token, originalVal, dictionary) {
  let value = originalVal;
  if (dictionary.usesReference(value)) {
    dictionary.getReferences(value).forEach(ref => {
      value = value.replace(`{${ref.path.join(".")}}`, `var(--${ref.name})`);
    });
  }
  return { ...token, value };
}

/**
 * Creates a light-dark transform that works for a given surface. Registers
 * the transform with style-dictionary and returns the transform's name.
 *
 * @param {string} surface
 *  The desktop surface we're generating CSS for, either "brand", "platform",
 *  or "shared".
 * @returns {string} Name of the transform that was registered.
 */
const createLightDarkTransform = surface => {
  let name = `lightDarkTransform/${surface}`;

  // Matcher function for determining if a token's value needs to undergo
  // a light-dark transform.
  let matcher = token => {
    if (surface != "shared") {
      return (
        token.original.value[surface]?.light &&
        token.original.value[surface]?.dark
      );
    }
    return token.original.value.light && token.original.value.dark;
  };

  // Function that uses the token's original value to create a new "default"
  // light-dark value and updates the original value object.
  let transformer = token => {
    if (surface != "shared") {
      let lightDarkVal = `light-dark(${token.original.value[surface].light}, ${token.original.value[surface].dark})`;
      token.original.value[surface].default = lightDarkVal;
      return token.value;
    }
    let value = `light-dark(${token.original.value.light}, ${token.original.value.dark})`;
    token.original.value.default = value;
    return value;
  };

  StyleDictionary.registerTransform({
    type: "value",
    transitive: true,
    name,
    matcher,
    transformer,
  });

  return name;
};

/**
 * Format the tokens dictionary to a string. This mostly defers to
 * StyleDictionary.createPropertyFormatter but first it sorts the tokens based
 * on the groupings in TOKEN_SECTIONS and adds comment headers to CSS output.
 *
 * @param {object} options
 *  Options for tokens to format.
 * @param {string} options.format
 *  The format to output. Supported: "css"
 * @param {object} options.dictionary
 *  The tokens dictionary.
 * @param {string} options.outputReferences
 *  Whether to output variable references.
 * @param {object} options.formatting
 *  The formatting settings to be passed to createPropertyFormatter.
 * @returns {string} The formatted tokens.
 */
function formatVariables({ format, dictionary, outputReferences, formatting }) {
  let lastSection = [];
  let propertyFormatter = createPropertyFormatter({
    outputReferences,
    dictionary,
    format,
    formatting,
  });

  let outputParts = [];
  let remainingTokens = [...dictionary.allTokens];
  let isFirst = true;

  function tokenParts(name) {
    let lastDash = name.lastIndexOf("-");
    let suffix = name.substring(lastDash + 1);
    if (TSHIRT_ORDER.includes(suffix) || STATE_ORDER.includes(suffix)) {
      return [name.substring(0, lastDash), suffix];
    }
    return [name, ""];
  }

  for (let [label, selector] of Object.entries(TOKEN_SECTIONS)) {
    let sectionMatchers = Array.isArray(selector) ? selector : [selector];
    let sectionParts = [];

    remainingTokens = remainingTokens.filter(token => {
      if (
        sectionMatchers.some(m =>
          m.test ? m.test(token.name) : token.name.startsWith(m)
        )
      ) {
        sectionParts.push(token);
        return false;
      }
      return true;
    });

    if (sectionParts.length) {
      sectionParts.sort((a, b) => {
        let aName = formatBaseTokenNames(a.name);
        let bName = formatBaseTokenNames(b.name);
        let [aToken, aSuffix] = tokenParts(aName);
        let [bToken, bSuffix] = tokenParts(bName);
        if (aSuffix || bSuffix) {
          if (aToken == bToken) {
            let aSize = TSHIRT_ORDER.indexOf(aSuffix);
            let bSize = TSHIRT_ORDER.indexOf(bSuffix);
            if (aSize != -1 && bSize != -1) {
              return aSize - bSize;
            }
            let aState = STATE_ORDER.indexOf(aSuffix);
            let bState = STATE_ORDER.indexOf(bSuffix);
            if (aState != -1 && bState != -1) {
              return aState - bState;
            }
          }
        }
        return aToken.localeCompare(bToken, undefined, { numeric: true });
      });

      let headingParts = [];
      if (!isFirst) {
        headingParts.push("");
      }
      isFirst = false;

      let sectionLevel = "**";
      let labelParts = label.split("/");
      for (let i = 0; i < labelParts.length; i++) {
        if (labelParts[i] != lastSection[i]) {
          headingParts.push(
            `${formatting.indentation}/${sectionLevel} ${labelParts[i]} ${sectionLevel}/`
          );
        }
        sectionLevel += "*";
      }
      lastSection = labelParts;

      outputParts = outputParts.concat(
        headingParts.concat(sectionParts.map(propertyFormatter))
      );
    }
  }

  return outputParts.join("\n");
}

// Easy way to grab variable values later for display.
let variableLookupTable = {};

function storybookJSFormat(args) {
  let dictionary = Object.assign({}, args.dictionary);
  let resolvedTokens = dictionary.allTokens.map(token => {
    let tokenVal = resolveReferences(dictionary, token.original);
    return {
      name: token.name,
      ...tokenVal,
    };
  });
  dictionary.allTokens = dictionary.allProperties = resolvedTokens;

  let parsedData = JSON.parse(
    formatBaseTokenNames(
      StyleDictionary.format["javascript/module-flat"]({
        ...args,
        dictionary,
      })
    )
      .trim()
      .replaceAll(/(^module\.exports\s*=\s*|\;$)/g, "")
  );
  let storybookTables = formatTokensTablesData(parsedData);

  return `${customFileHeader({ platform: "storybook" })}
  export const storybookTables = ${JSON.stringify(storybookTables)};

  export const variableLookupTable = ${JSON.stringify(variableLookupTable)};
  `;
}

function resolveReferences(dictionary, originalVal) {
  let resolvedValues = {};
  Object.entries(originalVal).forEach(([key, value]) => {
    if (typeof value === "object" && value != null) {
      resolvedValues[key] = resolveReferences(dictionary, value);
    } else {
      let resolvedVal = getValueWithReferences(dictionary, value);
      resolvedValues[key] = resolvedVal;
    }
  });
  return resolvedValues;
}

function getValueWithReferences(dictionary, value) {
  let valWithRefs = value;
  if (dictionary.usesReference(value)) {
    dictionary.getReferences(value).forEach(ref => {
      valWithRefs = valWithRefs.replace(
        `{${ref.path.join(".")}}`,
        `var(--${ref.name})`
      );
    });
  }
  return valWithRefs;
}

function formatTokensTablesData(tokensData) {
  let tokensTables = {};
  Object.entries(tokensData).forEach(([key, value]) => {
    variableLookupTable[key] = value;
    let formattedToken = {
      value,
      name: `--${key}`,
    };

    let tableName = getTableName(key);
    if (tokensTables[tableName]) {
      tokensTables[tableName].push(formattedToken);
    } else {
      tokensTables[tableName] = [formattedToken];
    }
  });
  return tokensTables;
}

const SINGULAR_TABLE_CATEGORIES = [
  "button",
  "color",
  "link",
  "size",
  "space",
  "opacity",
  "outline",
  "padding",
  "margin",
];

function getTableName(tokenName) {
  let replacePattern = /^(button-|input-text-|focus-|checkbox-)/;
  if (tokenName.match(replacePattern)) {
    tokenName = tokenName.replace(replacePattern, "");
  }
  let [category, type] = tokenName.split("-");
  return SINGULAR_TABLE_CATEGORIES.includes(category) || !type
    ? category
    : `${category}-${type}`;
}

module.exports = {
  source: ["design-tokens.json"],
  format: {
    "css/variables/shared": createDesktopFormat(),
    "css/variables/brand": createDesktopFormat("brand"),
    "css/variables/platform": createDesktopFormat("platform"),
    "javascript/storybook": storybookJSFormat,
  },
  platforms: {
    css: {
      options: {
        outputReferences: true,
        showFileHeader: false,
      },
      transforms: [
        ...StyleDictionary.transformGroup.css,
        ...["shared", "platform", "brand"].map(createLightDarkTransform),
      ],
      files: [
        {
          destination: "tokens-shared.css",
          format: "css/variables/shared",
        },
        {
          destination: "tokens-brand.css",
          format: "css/variables/brand",
          filter: token =>
            typeof token.original.value == "object" &&
            token.original.value.brand,
        },
        {
          destination: "tokens-platform.css",
          format: "css/variables/platform",
          filter: token =>
            typeof token.original.value == "object" &&
            token.original.value.platform,
        },
      ],
    },
    storybook: {
      options: {
        outputReferences: true,
        showFileHeader: false,
      },
      transforms: [
        ...StyleDictionary.transformGroup.css,
        ...["shared", "platform", "brand"].map(createLightDarkTransform),
      ],
      files: [
        {
          destination: "tokens-storybook.mjs",
          format: "javascript/storybook",
        },
      ],
    },
    figma: figmaConfig,
  },
};
