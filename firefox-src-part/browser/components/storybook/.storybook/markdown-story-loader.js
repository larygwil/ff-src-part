/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
/* eslint-env node */

/**
 * This file contains a Webpack loader that takes markdown as its source and
 * outputs a docs only MDX Storybook story. This enables us to write docs only
 * pages in plain markdown by specifying a `.stories.md` extension.
 *
 * For more context on docs only stories, see:
 * https://storybook.js.org/docs/web-components/writing-docs/mdx#documentation-only-mdx
 *
 * The MDX generated by the loader will then get run through the same loaders
 * Storybook usually uses to transform MDX files.
 */

const path = require("path");
const fs = require("fs");

const projectRoot = path.resolve(__dirname, "../../../../");

/**
 * Takes a file path and returns a string to use as the story title, capitalized
 * and split into multiple words. The file name gets transformed into the story
 * name, which will be visible in the Storybook sidebar. For example, either:
 *
 * /stories/hello-world.stories.md or /stories/helloWorld.md
 *
 * will result in a story named "Hello World".
 *
 * @param {string} filePath - path of the file being processed.
 * @returns {string} The title of the story.
 */
function getStoryTitle(filePath) {
  let fileName = path.basename(filePath, ".stories.md");
  if (fileName != "README") {
    try {
      let relatedFilePath = path.resolve(
        "../../../",
        filePath.replace(".md", ".mjs")
      );
      let relatedFile = fs.readFileSync(relatedFilePath).toString();
      let relatedTitle = relatedFile.match(/title: "(.*)"/)[1];
      if (relatedTitle) {
        return relatedTitle + "/README";
      }
    } catch {}
  }
  return separateWords(fileName);
}

/**
 * Splits a string into multiple capitalized words e.g. hello-world, helloWorld,
 * and hello.world all become "Hello World."
 * @param {string} str - String in any case.
 * @returns {string} The string split into multiple words.
 */
function separateWords(str) {
  return (
    str
      .match(/[A-Z]?[a-z0-9]+/g)
      ?.map(text => text[0].toUpperCase() + text.substring(1))
      .join(" ") || str
  );
}

/**
 * Enables rendering code in our markdown docs by parsing the source for
 * annotated code blocks and replacing them with Storybook's Canvas component.
 * @param {string} source - Stringified markdown source code.
 * @returns {string} Source with code blocks replaced by Canvas components.
 */
function parseStoriesFromMarkdown(source) {
  let storiesRegex = /```(?:js|html) story\n(?<code>[\s\S]*?)```/g;
  // $code comes from the <code> capture group in the regex above. It consists
  // of any code in between backticks and gets run when used in a Canvas component.
  return source.replace(
    storiesRegex,
    "<Canvas withSource='none'><with-common-styles>\n$<code></with-common-styles></Canvas>"
  );
}

/**
 * The WebpackLoader export. Takes markdown as its source and returns a docs
 * only MDX story. Falls back to filing stories under "Docs" for everything
 * outside of `toolkit/content/widgets`.
 *
 * @param {string} source - The markdown source to rewrite to MDX.
 */
module.exports = function markdownStoryLoader(source) {
  // Currently we sort docs only stories under "Docs" by default.
  let storyPath = "Docs";

  // `this.resourcePath` is the path of the file being processed.
  let relativePath = path
    .relative(projectRoot, this.resourcePath)
    .replaceAll(path.sep, "/");
  let componentName;

  if (relativePath.includes("toolkit/content/widgets")) {
    let storyNameRegex = /(?<=\/widgets\/)(?<name>.*?)(?=\/)/g;
    componentName = storyNameRegex.exec(relativePath)?.groups?.name;
    if (componentName) {
      // Get the common name for a component e.g. Toggle for moz-toggle
      storyPath =
        "UI Widgets/" + separateWords(componentName).replace(/^Moz/g, "");
    }
  }

  let storyTitle = getStoryTitle(relativePath);
  let title = storyTitle.includes("/")
    ? storyTitle
    : `${storyPath}/${storyTitle}`;

  let componentStories;
  if (componentName) {
    componentStories = this.resourcePath
      .replace("README", componentName)
      .replace(".md", ".mjs");
    try {
      fs.statSync(componentStories);
      componentStories = "./" + path.basename(componentStories);
    } catch {
      componentStories = null;
    }
  }

  // Unfortunately the indentation/spacing here seems to be important for the
  // MDX parser to know what to do in the next step of the Webpack process.
  let mdxSource = `
import { Meta, Description, Canvas, Story } from "@storybook/addon-docs";
${componentStories ? `import * as Stories from "${componentStories}";` : ""}

<Meta
  title="${title}"
  ${componentStories ? `of={Stories}` : ""}
  parameters={{
    previewTabs: {
      canvas: { hidden: true },
    },
    viewMode: "docs",
  }}
/>

${parseStoriesFromMarkdown(source)}`;

  return mdxSource;
};
