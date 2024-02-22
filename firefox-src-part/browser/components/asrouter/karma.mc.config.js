/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

const path = require("path");
const webpack = require("webpack");
const { ResourceUriPlugin } = require("../newtab/tools/resourceUriPlugin");

const PATHS = {
  // Where is the entry point for the unit tests?
  testEntryFile: path.resolve(__dirname, "./tests/unit/unit-entry.js"),

  // A glob-style pattern matching all unit tests
  testFilesPattern: "./tests/unit/unit-entry.js",

  // The base directory of all source files (used for path resolution in webpack importing)
  moduleResolveDirectory: __dirname,
  newtabResolveDirectory: "../newtab",

  // a RegEx matching all Cu.import statements of local files
  resourcePathRegEx: /^resource:\/\/activity-stream\//,

  coverageReportingPath: "logs/coverage/",
};

// When tweaking here, be sure to review the docs about the execution ordering
// semantics of the preprocessors array, as they are somewhat odd.
const preprocessors = {};
preprocessors[PATHS.testFilesPattern] = [
  "webpack", // require("karma-webpack")
  "sourcemap", // require("karma-sourcemap-loader")
];

module.exports = function (config) {
  const isTDD = config.tdd;
  const browsers = isTDD ? ["Firefox"] : ["FirefoxHeadless"]; // require("karma-firefox-launcher")
  config.set({
    singleRun: !isTDD,
    browsers,
    customLaunchers: {
      FirefoxHeadless: {
        base: "Firefox",
        flags: ["--headless"],
      },
    },
    frameworks: [
      "chai", // require("chai") require("karma-chai")
      "mocha", // require("mocha") require("karma-mocha")
      "sinon", // require("sinon") require("karma-sinon")
    ],
    reporters: [
      "coverage-istanbul", // require("karma-coverage")
      "mocha", // require("karma-mocha-reporter")

      // for bin/try-runner.js to parse the output easily
      "json", // require("karma-json-reporter")
    ],
    jsonReporter: {
      // So this doesn't get interleaved with other karma output
      stdout: false,
      outputFile: path.join("logs", "karma-run-results.json"),
    },
    coverageIstanbulReporter: {
      reports: ["lcov", "text-summary"], // for some reason "lcov" reallys means "lcov" and "html"
      "report-config": {
        // so the full m-c path gets printed; needed for https://coverage.moz.tools/ integration
        lcov: {
          projectRoot: "../../..",
        },
      },
      dir: PATHS.coverageReportingPath,
      // This will make karma fail if coverage reporting is less than the minimums here
      thresholds: !isTDD && {
        each: {
          statements: 80,
          lines: 80,
          functions: 80,
          branches: 66,
          overrides: {
            "content-src/asrouter-utils.js": {
              statements: 66,
              lines: 66,
              functions: 76,
              branches: 33,
            },
            "content-src/components/ASRouterAdmin/*.jsx": {
              statements: 0,
              lines: 0,
              functions: 0,
              branches: 0,
            },
            "content-src/components/ModalOverlay/ModalOverlay.jsx": {
              statements: 92,
              lines: 92,
              functions: 100,
              branches: 66,
            },
            "modules/ASRouter.sys.mjs": {
              statements: 75,
              lines: 75,
              functions: 64,
              branches: 66,
            },
            "modules/ASRouterParentProcessMessageHandler.sys.mjs": {
              statements: 98,
              lines: 98,
              functions: 100,
              branches: 88,
            },
            "modules/ToolbarPanelHub.sys.mjs": {
              statements: 88,
              lines: 88,
              functions: 94,
              branches: 84,
            },
          },
        },
      },
    },
    files: [PATHS.testEntryFile],
    preprocessors,
    webpack: {
      mode: "none",
      devtool: "inline-source-map",
      // This loader allows us to override required files in tests
      resolveLoader: {
        alias: {
          inject: path.join(__dirname, "../newtab/loaders/inject-loader"),
        },
      },
      // This resolve config allows us to import with paths relative to the root directory
      resolve: {
        extensions: [".js", ".jsx"],
        modules: [
          PATHS.moduleResolveDirectory,
          "node_modules",
          PATHS.newtabResolveDirectory,
        ],
        fallback: {
          stream: require.resolve("stream-browserify"),
          buffer: require.resolve("buffer"),
        },
        alias: {
          newtab: path.join(__dirname, "../newtab"),
        },
      },
      plugins: [
        // The ResourceUriPlugin handles translating resource URIs in import
        // statements in .mjs files to paths on the filesystem.
        new ResourceUriPlugin({
          resourcePathRegExes: [
            [
              new RegExp("^resource://activity-stream/"),
              path.join(__dirname, "../newtab/"),
            ],
            [
              new RegExp("^resource:///modules/asrouter/"),
              path.join(__dirname, "./modules/"),
            ],
          ],
        }),
        new webpack.DefinePlugin({
          "process.env.NODE_ENV": JSON.stringify("development"),
        }),
      ],
      externals: {
        // enzyme needs these for backwards compatibility with 0.13.
        // see https://github.com/airbnb/enzyme/blob/master/docs/guides/webpack.md#using-enzyme-with-webpack
        "react/addons": true,
        "react/lib/ReactContext": true,
        "react/lib/ExecutionEnvironment": true,
      },
      module: {
        rules: [
          {
            test: /\.js$/,
            exclude: [/node_modules\/(?!@fluent\/).*/, /tests/],
            loader: "babel-loader",
          },
          {
            test: /\.jsx$/,
            exclude: /node_modules/,
            loader: "babel-loader",
            options: {
              presets: ["@babel/preset-react"],
            },
          },
          {
            test: /\.md$/,
            use: "raw-loader",
          },
          {
            enforce: "post",
            test: /\.js[mx]?$/,
            loader: "@jsdevtools/coverage-istanbul-loader",
            options: { esModules: true },
            include: [path.resolve("content-src"), path.resolve("modules")],
            exclude: [
              path.resolve("tests"),
              path.resolve("../newtab"),
              path.resolve("modules/ASRouterTargeting.sys.mjs"),
              path.resolve("modules/ASRouterTriggerListeners.sys.mjs"),
              path.resolve("modules/CFRMessageProvider.sys.mjs"),
              path.resolve("modules/CFRPageActions.sys.mjs"),
              path.resolve("modules/OnboardingMessageProvider.sys.mjs"),
            ],
          },
        ],
      },
    },
    // Silences some overly-verbose logging of individual module builds
    webpackMiddleware: { noInfo: true },
  });
};
