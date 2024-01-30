/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at <http://mozilla.org/MPL/2.0/>. */

/**
 * Tabs reducer
 * @module reducers/tabs
 */

import { isOriginalId } from "devtools/client/shared/source-map-loader/index";

import { isSimilarTab } from "../utils/tabs";

export function initialTabState() {
  return { tabs: [] };
}

function update(state = initialTabState(), action) {
  switch (action.type) {
    case "ADD_TAB":
      return updateTabList(state, action.source, action.sourceActor);

    case "MOVE_TAB":
      return moveTabInList(state, action);

    case "MOVE_TAB_BY_SOURCE_ID":
      return moveTabInListBySourceId(state, action);

    case "CLOSE_TAB":
      return removeSourceFromTabList(state, action);

    case "CLOSE_TABS":
      return removeSourcesFromTabList(state, action);

    case "ADD_ORIGINAL_SOURCES":
      return addVisibleTabsForOriginalSources(
        state,
        action.originalSources,
        action.generatedSourceActor
      );

    case "INSERT_SOURCE_ACTORS":
      return addVisibleTabsForSourceActors(state, action.sourceActors);

    case "REMOVE_THREAD": {
      return resetTabsForThread(state, action.threadActorID);
    }

    default:
      return state;
  }
}

function matchesSource(tab, source) {
  return tab.source?.id === source.id || matchesUrl(tab, source);
}

function matchesUrl(tab, source) {
  return tab.url === source.url && tab.isOriginal == isOriginalId(source.id);
}

function addVisibleTabsForSourceActors(state, sourceActors) {
  let changed = false;
  // Lookups for tabs matching any source actor's URL
  // and reference their source and sourceActor attribute
  // so that the tab becomes visible.
  const tabs = state.tabs.map(tab => {
    const sourceActor = sourceActors.find(actor =>
      matchesUrl(tab, actor.sourceObject)
    );
    if (!sourceActor) {
      return tab;
    }
    changed = true;
    return {
      ...tab,
      source: sourceActor.sourceObject,
      sourceActor,
    };
  });

  return changed ? { tabs } : state;
}

function addVisibleTabsForOriginalSources(
  state,
  sources,
  generatedSourceActor
) {
  let changed = false;

  // Lookups for tabs matching any source's URL
  // and reference their source and sourceActor attribute
  // so that the tab becomes visible.
  const tabs = state.tabs.map(tab => {
    const source = sources.find(s => matchesUrl(tab, s));
    if (!source) {
      return tab;
    }
    changed = true;
    return {
      ...tab,
      source,
      // All currently reported original sources are related to a single source actor
      sourceActor: generatedSourceActor,
    };
  });

  return changed ? { tabs } : state;
}

function removeSourceFromTabList(state, { source }) {
  const newTabs = state.tabs.filter(tab => !matchesSource(tab, source));
  if (newTabs.length == state.tabs.length) {
    return state;
  }
  return { tabs: newTabs };
}

function removeSourcesFromTabList(state, { sources }) {
  const newTabs = sources.reduce(
    (tabList, source) => tabList.filter(tab => !matchesSource(tab, source)),
    state.tabs
  );
  if (newTabs.length == state.tabs.length) {
    return state;
  }

  return { tabs: newTabs };
}

function resetTabsForThread(state, threadActorID) {
  let changed = false;
  // Nullify source and sourceActor attributes of all tabs
  // related to the given thread so that they become hidden.
  //
  // They may later be restored if a source matches their URL again.
  // This is similar to persistTabs, but specific to a unique thread.
  const tabs = state.tabs.map(tab => {
    if (tab.sourceActor?.thread != threadActorID) {
      return tab;
    }
    changed = true;
    return {
      ...tab,
      source: null,
      sourceActor: null,
    };
  });

  return changed ? { tabs } : state;
}

/**
 * Adds the new source to the tab list if it is not already there.
 */
function updateTabList(state, source, sourceActor) {
  const { url } = source;
  const isOriginal = isOriginalId(source.id);

  let { tabs } = state;
  // Set currentIndex to -1 for URL-less tabs so that they aren't
  // filtered by isSimilarTab
  const currentIndex = url
    ? tabs.findIndex(tab => isSimilarTab(tab, url, isOriginal))
    : -1;

  if (currentIndex === -1) {
    const newTab = {
      url,
      source,
      isOriginal,
      sourceActor,
    };
    // New tabs are added first in the list
    tabs = [newTab, ...tabs];
  } else {
    return state;
  }

  return { ...state, tabs };
}

function moveTabInList(state, { url, tabIndex: newIndex }) {
  const { tabs } = state;
  const currentIndex = tabs.findIndex(tab => tab.url == url);
  return moveTab(tabs, currentIndex, newIndex);
}

function moveTabInListBySourceId(state, { sourceId, tabIndex: newIndex }) {
  const { tabs } = state;
  const currentIndex = tabs.findIndex(tab => tab.source?.id == sourceId);
  return moveTab(tabs, currentIndex, newIndex);
}

function moveTab(tabs, currentIndex, newIndex) {
  const item = tabs[currentIndex];

  const newTabs = Array.from(tabs);
  // Remove the item from its current location
  newTabs.splice(currentIndex, 1);
  // And add it to the new one
  newTabs.splice(newIndex, 0, item);

  return { tabs: newTabs };
}

export default update;
