/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
"use strict";

const {
  RetVal,
  Arg,
  generateActorSpec,
  types,
} = require("devtools/shared/protocol");

types.addDictType("screenshot-content.args", {
  fullpage: "nullable:boolean",
  selector: "nullable:string",
  nodeActorID: "nullable:number",
});

const screenshotContentSpec = generateActorSpec({
  typeName: "screenshot-content",

  methods: {
    prepareCapture: {
      request: {
        args: Arg(0, "screenshot-content.args"),
      },
      response: {
        value: RetVal("json"),
      },
    },
  },
});

exports.screenshotContentSpec = screenshotContentSpec;
