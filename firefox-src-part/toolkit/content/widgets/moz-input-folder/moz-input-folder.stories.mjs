/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { html, ifDefined } from "../vendor/lit.all.mjs";
import "./moz-input-folder.mjs";

export default {
  title: "UI Widgets/Input Folder",
  component: "moz-input-folder",
  argTypes: {
    l10nId: {
      options: [
        "moz-input-folder-label",
        "moz-input-folder-placeholder",
        "moz-input-folder-description",
      ],
      control: { type: "select" },
    },
  },
  parameters: {
    status: "in-development",
    handles: ["change", "click"],
    fluent: `
moz-input-folder-label =
  .label = Save files to
moz-input-folder-placeholder =
  .label = Save files to
  .placeholder = Select folder
moz-input-folder-description =
  .label = Save files to
  .description = Description text
  .placeholder = Select folder
    `,
  },
};

const Template = ({
  name,
  value,
  iconSrc,
  disabled,
  l10nId,
  description,
  supportPage,
  hasSlottedDescription,
  hasSlottedSupportLink,
}) => html`
  <div style="width: 400px;">
    <moz-input-folder
      name=${name}
      value=${ifDefined(value || null)}
      iconsrc=${ifDefined(iconSrc || null)}
      ?disabled=${disabled}
      data-l10n-id=${l10nId}
      support-page=${ifDefined(supportPage || null)}
      @click=${{
        handleEvent: e => {
          if (e.composedPath().some(el => el.localName == "moz-button")) {
            e.stopPropagation();
            alert("This would open the file picker");
          }
        },
        capture: true,
      }}
    >
      ${hasSlottedDescription
        ? html`<div slot="description">${description}</div>`
        : ""}
      ${hasSlottedSupportLink
        ? html`<a slot="support-link" href="www.example.com">Click me!</a>`
        : ""}
    </moz-input-folder>
  </div>
`;

export const Default = Template.bind({});
Default.args = {
  name: "example-moz-input-folder",
  value: "",
  iconSrc: "",
  disabled: false,
  l10nId: "moz-input-folder-label",
  supportPage: "",
  hasSlottedDescription: false,
  hasSlottedSupportLink: false,
};

export const WithValue = Template.bind({});
WithValue.args = {
  ...Default.args,
  value: "/User/Downloads",
};

export const WithPlaceholder = Template.bind({});
WithPlaceholder.args = {
  ...Default.args,
  l10nId: "moz-input-folder-placeholder",
};

export const WithIcon = Template.bind({});
WithIcon.args = {
  ...Default.args,
  iconSrc: "chrome://global/skin/icons/highlights.svg",
};

export const withDescription = Template.bind({});
withDescription.args = {
  ...Default.args,
  l10nId: "moz-input-folder-description",
};

export const WithSlottedDescription = Template.bind({});
WithSlottedDescription.args = {
  ...Default.args,
  description: "This is a custom slotted description.",
  hasSlottedDescription: true,
};

export const Disabled = Template.bind({});
Disabled.args = {
  ...Default.args,
  l10nId: "moz-input-folder-description",
  disabled: true,
};

export const WithSupportLink = Template.bind({});
WithSupportLink.args = {
  ...Default.args,
  supportPage: "support-page",
  l10nId: "moz-input-folder-description",
};

export const WithSlottedSupportLink = Template.bind({});
WithSlottedSupportLink.args = {
  ...Default.args,
  hasSlottedSupportLink: true,
  l10nId: "moz-input-folder-description",
};
