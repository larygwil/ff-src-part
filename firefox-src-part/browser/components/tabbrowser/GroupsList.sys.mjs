/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const MAX_INITIAL_ITEMS = 6;

export class GroupsPanel {
  constructor({ view, containerNode }) {
    this.view = view;

    this.containerNode = containerNode;
    this.win = containerNode.ownerGlobal;
    this.doc = containerNode.ownerDocument;
    this.panelMultiView = null;
    this.view.addEventListener("ViewShowing", this);
  }

  handleEvent(event) {
    switch (event.type) {
      case "ViewShowing":
        if (event.target == this.view) {
          this.#showAll = false;
          this.panelMultiView = this.view.panelMultiView;
          this.#populate();
        }
        break;
      case "PanelMultiViewHidden":
        if ((this.panelMultiView = event.target)) {
          this.#cleanup();
          this.panelMultiView = null;
        }

        break;
      case "command":
        this.#handleCommand(event);
        break;
    }
  }

  #handleCommand(event) {
    let { tabGroupId } = event.target.dataset;

    switch (event.target.dataset.command) {
      case "allTabsGroupView_selectGroup": {
        let group = this.win.gBrowser.getTabGroupById(tabGroupId);
        group.select();
        group.ownerGlobal.focus();
        break;
      }

      case "allTabsGroupView_restoreGroup":
        this.win.SessionStore.openSavedTabGroup(tabGroupId, this.win);
        break;

      case "allTabsGroupView_showAll":
        this.#showAll = true;
        this.#populate();
        break;
    }
  }

  #setupListeners() {
    this.view.addEventListener("command", this);
    this.view.panelMultiView.addEventListener("PanelMultiViewHidden", this);
  }

  #cleanup() {
    this.containerNode.innerHTML = "";
    this.view.removeEventListener("command", this);
  }

  #showAll = false;
  #populate() {
    let fragment = this.doc.createDocumentFragment();

    let otherWindowGroups = this.win.gBrowser
      .getAllTabGroups()
      .filter(group => {
        return group.ownerGlobal !== this.win;
      });
    otherWindowGroups.sort(
      (group1, group2) => group2.lastSeenActive - group1.lastSeenActive
    );

    let savedGroups = this.win.SessionStore.savedGroups.toSorted(
      (group1, group2) => group2.closedAt - group1.closedAt
    );

    let totalItemCount = savedGroups.length + otherWindowGroups.length;
    if (totalItemCount) {
      let header = this.doc.createElement("h2");
      header.setAttribute("class", "subview-subheader");
      this.doc.l10n.setAttributes(header, "tab-group-menu-header");
      fragment.appendChild(header);
    }

    let showAll = this.#showAll || totalItemCount <= MAX_INITIAL_ITEMS;
    let itemCount = 1; // Start with 1 to account for "show more" button
    for (let groupData of otherWindowGroups) {
      if (itemCount >= MAX_INITIAL_ITEMS && !showAll) {
        continue;
      }
      itemCount++;
      let row = this.#createRow(groupData);
      let button = row.querySelector("toolbarbutton");
      button.dataset.command = "allTabsGroupView_selectGroup";
      button.dataset.tabGroupId = groupData.id;
      button.setAttribute("context", "open-tab-group-context-menu");
      fragment.appendChild(row);
    }

    for (let groupData of savedGroups) {
      if (itemCount >= MAX_INITIAL_ITEMS && !showAll) {
        continue;
      }
      itemCount++;
      let row = this.#createRow(groupData, { isOpen: false });
      let button = row.querySelector("toolbarbutton");
      button.dataset.command = "allTabsGroupView_restoreGroup";
      button.dataset.tabGroupId = groupData.id;
      button.classList.add("all-tabs-group-saved-group");
      button.setAttribute("context", "saved-tab-group-context-menu");
      fragment.appendChild(row);
    }

    if (!showAll) {
      let button = this.doc.createXULElement("toolbarbutton");
      button.setAttribute("id", "allTabsMenu-groupsViewShowMore");
      button.setAttribute("class", "subviewbutton");
      button.dataset.command = "allTabsGroupView_showAll";
      button.setAttribute("flex", "1");
      this.doc.l10n.setAttributes(
        button,
        "tabbrowser-manager-tab-groups-show-more"
      );
      fragment.appendChild(button);
    }

    this.containerNode.replaceChildren(fragment);
    this.#setupListeners();
  }

  /**
   * @param {TabGroupStateData} group
   * @param {object} [options]
   * @param {boolean} [options.isOpen]
   *   Set to true if the group is currently open, and false if it's saved
   * @returns {XULElement}
   */
  #createRow(group, { isOpen = true } = {}) {
    let { doc } = this;
    let row = doc.createXULElement("toolbaritem");
    row.setAttribute("class", "all-tabs-item all-tabs-group-item");

    row.style.setProperty(
      "--tab-group-color",
      `var(--tab-group-color-${group.color})`
    );
    row.style.setProperty(
      "--tab-group-color-invert",
      `var(--tab-group-color-${group.color}-invert)`
    );
    row.style.setProperty(
      "--tab-group-color-pale",
      `var(--tab-group-color-${group.color}-pale)`
    );
    let button = doc.createXULElement("toolbarbutton");
    button.setAttribute(
      "class",
      "all-tabs-button subviewbutton subviewbutton-iconic all-tabs-group-action-button"
    );
    if (!isOpen) {
      button.classList.add(
        "all-tabs-group-saved-group",
        "tab-group-icon-closed"
      );
      button.dataset.command = "allTabsGroupView_restoreGroup";
    } else {
      button.classList.add(
        group.collapsed ? "tab-group-icon-collapsed" : "tab-group-icon"
      );
      button.dataset.command = "allTabsGroupView_selectGroup";
    }
    button.setAttribute("flex", "1");
    button.setAttribute("crop", "end");

    let setName = tabGroupName => {
      if (group.saved) {
        doc.l10n.setAttributes(button, "tabbrowser-manager-closed-tab-group", {
          tabGroupName,
        });
      } else {
        button.setAttribute("label", tabGroupName);
        button.setAttribute("tooltiptext", tabGroupName);
      }
    };

    if (group.name) {
      setName(group.name);
    } else {
      doc.l10n
        .formatValues([{ id: "tab-group-name-default" }])
        .then(([msg]) => {
          setName(msg);
        });
    }
    row.appendChild(button);
    return row;
  }
}
