/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

class PictureInPictureVideoWrapper {
  setVolume(video, volume) {
    video.volume = volume;
  }

  isMuted(video) {
    return video.volume === 0;
  }

  setMuted(video, shouldMute) {
    if (shouldMute) {
      this.setVolume(video, 0);
    } else {
      this.setVolume(video, 1);
    }
  }

  setCaptionContainerObserver(video, updateCaptionsFunction) {
    let container = document.querySelector(
      '[data-testid="CueBoxContainer"]'
    ).parentElement;

    if (container) {
      updateCaptionsFunction("");
      const callback = function () {
        let text = container.querySelector(
          '[data-testid="CueBoxContainer"]'
        )?.innerText;
        updateCaptionsFunction(text);
      };

      callback([1], null);

      this.captionsObserver = new MutationObserver(callback);

      this.captionsObserver.observe(container, {
        attributes: false,
        childList: true,
        subtree: true,
      });
    }
  }

  removeCaptionContainerObserver() {
    this.captionsObserver?.disconnect();
  }
}

this.PictureInPictureVideoWrapper = PictureInPictureVideoWrapper;
