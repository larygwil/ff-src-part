/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

const path = require("path");
const config = require("../newtab/webpack.system-addon.config.js");
const webpack = require("webpack");
const absolute = relPath => path.join(__dirname, relPath);
const banner = `
 NOTE: This file is generated by webpack from ASRouterAdmin.jsx
 using the npm bundle task.
 `;
module.exports = Object.assign({}, config(), {
  entry: absolute("content-src/components/ASRouterAdmin/ASRouterAdmin.jsx"),
  output: {
    path: absolute("content"),
    filename: "asrouter-admin.bundle.js",
    library: "ASRouterAdminRenderUtils",
  },
  externals: {
    "prop-types": "PropTypes",
    react: "React",
    "react-dom": "ReactDOM",
  },
  plugins: [new webpack.BannerPlugin(banner)],
  // This resolve config allows us to import with paths relative to the root directory
  resolve: {
    extensions: [".js", ".jsx"],
    alias: {
      newtab: absolute("../newtab"),
      common: absolute("../newtab/common"),
      modules: absolute("modules"),
    },
  },
});
