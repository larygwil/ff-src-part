/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const XHTML_NS = "http://www.w3.org/1999/xhtml";

const STYLE_INSPECTOR_PROPERTIES =
  "devtools/shared/locales/styleinspector.properties";

loader.lazyGetter(this, "STYLE_INSPECTOR_L10N", function () {
  const { LocalizationHelper } = require("resource://devtools/shared/l10n.js");
  return new LocalizationHelper(STYLE_INSPECTOR_PROPERTIES);
});
loader.lazyGetter(this, "L10N_EMPTY", function () {
  return STYLE_INSPECTOR_L10N.getStr("rule.variableEmpty");
});

class CssQueryContainerTooltipHelper {
  /**
   * Fill the tooltip with container information.
   */
  async setContentAndShowContainerHighlighter(data, tooltip) {
    const res = await data.rule.domRule.getQueryContainerForNode(
      data.ancestorIndex,
      data.rule.inherited ||
        data.rule.elementStyle.ruleView.inspector.selection.nodeFront,
      data.conditionIndex
    );

    if (res.node) {
      const inspector = data.rule.elementStyle.ruleView.inspector;
      await inspector.highlighters.showHighlighterTypeForNode(
        inspector.highlighters.TYPES.BOXMODEL,
        res.node
      );
      tooltip.once("hidden", () => {
        inspector.highlighters.hideHighlighterType(
          inspector.highlighters.TYPES.BOXMODEL
        );
      });
    }

    const fragment = this.#getTemplate(res, tooltip);
    await tooltip.setLocalizedFragment(fragment, { width: "auto" });
  }

  /**
   * Get the template of the tooltip.
   *
   * @param {object} data: returned value of StyleRuleActor.getQueryContainerForNode
   * @param {NodeFront|null} data.node
   * @param {string} data.containerType
   * @param {Array<object>} data.queryFeatures
   * @param {HTMLTooltip} tooltip
   *        The tooltip we are targetting.
   */
  #getTemplate(data, tooltip) {
    const { doc } = tooltip;

    const templateNode = doc.createElementNS(XHTML_NS, "template");

    const tooltipContainer = doc.createElementNS(XHTML_NS, "div");
    tooltipContainer.classList.add("devtools-tooltip-query-container");
    templateNode.content.appendChild(tooltipContainer);

    if (!data.node) {
      tooltipContainer.setAttribute(
        "data-l10n-id",
        "css-selector-container-query-condition-no-container"
      );
      tooltipContainer.setAttribute(
        "data-l10n-args",
        JSON.stringify({ name: data.containerName })
      );
    } else {
      const nodeContainer = doc.createElementNS(XHTML_NS, "header");
      tooltipContainer.append(nodeContainer);

      const nodeEl = doc.createElementNS(XHTML_NS, "span");
      nodeEl.classList.add("objectBox-node");
      nodeContainer.append(doc.createTextNode("<"), nodeEl);

      const nodeNameEl = doc.createElementNS(XHTML_NS, "span");
      nodeNameEl.classList.add("tag-name");
      nodeNameEl.appendChild(
        doc.createTextNode(data.node.nodeName.toLowerCase())
      );

      nodeEl.appendChild(nodeNameEl);

      if (data.node.id) {
        const idEl = doc.createElementNS(XHTML_NS, "span");
        idEl.classList.add("attribute-name");
        idEl.appendChild(doc.createTextNode(`#${data.node.id}`));
        nodeEl.appendChild(idEl);
      }

      for (const attr of data.node.attributes) {
        if (attr.name !== "class") {
          continue;
        }
        for (const cls of attr.value.split(/\s/)) {
          const el = doc.createElementNS(XHTML_NS, "span");
          el.classList.add("attribute-name");
          el.appendChild(doc.createTextNode(`.${cls}`));
          nodeEl.appendChild(el);
        }
      }
      nodeContainer.append(doc.createTextNode(">"));

      const ul = doc.createElementNS(XHTML_NS, "ul");
      tooltipContainer.appendChild(ul);

      if (data.containerName) {
        const containerNameEl = doc.createElementNS(XHTML_NS, "li");
        const containerNameLabel = doc.createElementNS(XHTML_NS, "span");
        containerNameLabel.classList.add("property-name");
        containerNameLabel.append(`container-name`);

        const containerNameValue = doc.createElementNS(XHTML_NS, "span");
        containerNameValue.classList.add("property-value");
        containerNameValue.append(data.containerName);

        containerNameEl.append(containerNameLabel, ": ", containerNameValue);
        ul.appendChild(containerNameEl);
      }

      const containerTypeEl = doc.createElementNS(XHTML_NS, "li");
      const containerTypeLabel = doc.createElementNS(XHTML_NS, "span");
      containerTypeLabel.classList.add("property-name");
      containerTypeLabel.appendChild(doc.createTextNode(`container-type`));

      const containerTypeValue = doc.createElementNS(XHTML_NS, "span");
      containerTypeValue.classList.add("property-value");
      containerTypeValue.appendChild(doc.createTextNode(data.containerType));

      containerTypeEl.append(
        containerTypeLabel,
        doc.createTextNode(": "),
        containerTypeValue
      );
      ul.appendChild(containerTypeEl);

      // @backward-compat { version 151 } data.queryFeatures was added in Firefox 151.
      // When it's not present, show what we used to before. Once 151 hits release,
      // this if block can be remove, and we can keep only what's in the else block.
      if (!data.queryFeatures) {
        const inlineSizeEl = doc.createElementNS(XHTML_NS, "li");

        const inlineSizeLabel = doc.createElementNS(XHTML_NS, "span");
        inlineSizeLabel.classList.add("property-name");
        inlineSizeLabel.appendChild(doc.createTextNode(`inline-size`));

        const inlineSizeValue = doc.createElementNS(XHTML_NS, "span");
        inlineSizeValue.classList.add("property-value");
        inlineSizeValue.appendChild(doc.createTextNode(data.inlineSize));

        inlineSizeEl.append(
          inlineSizeLabel,
          doc.createTextNode(": "),
          inlineSizeValue
        );
        ul.appendChild(inlineSizeEl);

        if (data.containerType != "inline-size") {
          const blockSizeEl = doc.createElementNS(XHTML_NS, "li");
          const blockSizeLabel = doc.createElementNS(XHTML_NS, "span");
          blockSizeLabel.classList.add("property-name");
          blockSizeLabel.appendChild(doc.createTextNode(`block-size`));

          const blockSizeValue = doc.createElementNS(XHTML_NS, "span");
          blockSizeValue.classList.add("property-value");
          blockSizeValue.appendChild(doc.createTextNode(data.blockSize));

          blockSizeEl.append(
            blockSizeLabel,
            doc.createTextNode(": "),
            blockSizeValue
          );
          ul.appendChild(blockSizeEl);
        }
      } else {
        let unsetEl;
        for (const { name, value, type } of data.queryFeatures) {
          const el = doc.createElementNS(XHTML_NS, "li");

          // We should display a specific string when the property is not set (i.e.
          // when value is null).
          if (value === null) {
            if (!unsetEl) {
              unsetEl = doc.createElementNS(XHTML_NS, "ul");
              unsetEl.classList.add("unset-properties");
              tooltipContainer.appendChild(unsetEl);
            }
            if (type === "var") {
              el.append(
                STYLE_INSPECTOR_L10N.getFormatStr("rule.variableUnset", name)
              );
            } else if (type === "attr") {
              el.append(
                STYLE_INSPECTOR_L10N.getFormatStr("rule.attributeUnset", name)
              );
            }
            unsetEl.append(el);
            continue;
          }
          const labelEl = doc.createElementNS(XHTML_NS, "span");
          labelEl.classList.add("property-name");
          labelEl.append(name);

          const valueEl = doc.createElementNS(XHTML_NS, "span");
          valueEl.classList.add("property-value");
          // if value is an empty string, let's display <empty>
          valueEl.append(value === "" ? `<${L10N_EMPTY}>` : value);
          if (value === "") {
            valueEl.classList.add("empty");
          }

          el.append(labelEl, ": ", valueEl);

          ul.appendChild(el);
        }
      }
    }

    return doc.importNode(templateNode.content, true);
  }
}

module.exports = CssQueryContainerTooltipHelper;
