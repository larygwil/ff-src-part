/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { MozLitElement } from "chrome://global/content/lit-utils.mjs";
import { html } from "chrome://global/content/vendor/lit.all.mjs";
import { Region, ViewDimensions } from "./avatarSelectionHelpers.mjs";

const VIEWS = {
  ICON: "icon",
  CUSTOM: "custom",
  CROP: "crop",
};

const STATES = {
  SELECTED: "selected",
  RESIZING: "resizing",
};

const SCROLL_BY_EDGE = 20;

/**
 * Element used for displaying an avatar on the about:editprofile and about:newprofile pages.
 */
export class ProfileAvatarSelector extends MozLitElement {
  #moverId = "";

  static properties = {
    value: { type: String },
    view: { type: String },
  };

  static queries = {
    input: "#custom-image-input",
    saveButton: "#save-button",
    customAvatarCropArea: ".custom-avatar-crop-area",
    customAvatarImage: "#custom-avatar-image",
    avatarSelectionContainer: "#avatar-selection-container",
    highlight: "#highlight",
    iconTabButton: "#icon",
    customTabButton: "#custom",
    topLeftMover: "#mover-topLeft",
    topRightMover: "#mover-topRight",
    bottomLeftMover: "#mover-bottomLeft",
    bottomRightMover: "#mover-bottomRight",
    avatarPicker: "#avatars",
    avatars: { all: "moz-visual-picker-item" },
  };

  constructor() {
    super();

    this.setView(VIEWS.ICON);
    this.viewDimensions = new ViewDimensions();
    this.avatarRegion = new Region(this.viewDimensions);

    this.state = STATES.SELECTED;
  }

  setView(newView) {
    if (this.view === VIEWS.CROP) {
      this.cropViewEnd();
    }

    switch (newView) {
      case VIEWS.ICON:
        this.view = VIEWS.ICON;
        break;
      case VIEWS.CUSTOM:
        this.view = VIEWS.CUSTOM;
        break;
      case VIEWS.CROP:
        this.view = VIEWS.CROP;
        this.cropViewStart();
        break;
    }
  }

  cropViewStart() {
    window.addEventListener("pointerdown", this);
    window.addEventListener("pointermove", this);
    window.addEventListener("pointerup", this);
    window.addEventListener("keydown", this);
    document.documentElement.classList.add("disable-text-selection");
  }

  cropViewEnd() {
    window.removeEventListener("pointerdown", this);
    window.removeEventListener("pointermove", this);
    window.removeEventListener("pointerup", this);
    window.removeEventListener("keydown", this);
    document.documentElement.classList.remove("disable-text-selection");
  }

  getAvatarL10nId(value) {
    switch (value) {
      case "barbell":
        return "barbell-avatar";
      case "bike":
        return "bike-avatar";
      case "book":
        return "book-avatar";
      case "briefcase":
        return "briefcase-avatar";
      case "canvas":
        return "canvas-avatar";
      case "craft":
        return "craft-avatar";
      case "default-favicon":
        return "default-favicon-avatar";
      case "diamond":
        return "diamond-avatar";
      case "flower":
        return "flower-avatar";
      case "folder":
        return "folder-avatar";
      case "heart":
        return "heart-avatar";
      case "heart-rate":
        return "heart-rate-avatar";
      case "history":
        return "history-avatar";
      case "leaf":
        return "leaf-avatar";
      case "lightbulb":
        return "lightbulb-avatar";
      case "makeup":
        return "makeup-avatar";
      case "message":
        return "message-avatar";
      case "musical-note":
        return "musical-note-avatar";
      case "paw-print":
        return "paw-print-avatar";
      case "sparkle-single":
        return "sparkle-single-avatar";
      case "soccer":
        return "soccer-avatar";
      case "star":
        return "star-avatar";
      case "video-game-controller":
        return "video-game-controller-avatar";
      default:
        return "custom-avatar";
    }
  }

  handleAvatarChange() {
    const selectedAvatar = this.avatarPicker.value;

    document.dispatchEvent(
      new CustomEvent("Profiles:AvatarSelected", {
        detail: { avatar: selectedAvatar },
      })
    );
  }

  handleTabClick(event) {
    event.stopImmediatePropagation();
    if (event.target.id === "icon") {
      this.setView(VIEWS.ICON);
    } else {
      this.setView(VIEWS.CUSTOM);
    }
  }

  iconTabContentTemplate() {
    let avatars = [
      "star",
      "flower",
      "briefcase",
      "heart",
      "book",
      "shopping",
      "present",
      "plane",
      "barbell",
      "bike",
      "craft",
      "diamond",
      "hammer",
      "heart-rate",
      "leaf",
      "makeup",
      "palette",
      "musical-note",
      "paw-print",
      "sparkle-single",
      "soccer",
      "video-game-controller",
      "default-favicon",
      "canvas",
      "history",
      "folder",
      "message",
      "lightbulb",
    ];

    return html`<moz-visual-picker
      type="listbox"
      value=${this.avatar}
      name="avatar"
      id="avatars"
      @change=${this.handleAvatarChange}
      >${avatars.map(
        avatar =>
          html`<moz-visual-picker-item
            l10nId=${this.getAvatarL10nId(avatar)}
            value=${avatar}
            ?checked=${this.value === avatar}
            ><moz-button
              class="avatar-button"
              type="ghost"
              iconSrc="chrome://browser/content/profiles/assets/16_${avatar}.svg"
              tabindex="-1"
            ></moz-button
          ></moz-visual-picker-item>`
      )}</moz-visual-picker
    >`;
  }

  customTabUploadFileContentTemplate() {
    return html`<div
        class="custom-avatar-add-image-header"
        data-l10n-id="avatar-selector-add-image"
      ></div>
      <div class="custom-avatar-upload-area">
        <input
          @change=${this.handleFileUpload}
          id="custom-image-input"
          type="file"
          accept="image/*"
          label="Upload a file"
        />
        <div id="file-messages">
          <img src="chrome://browser/skin/open.svg" />
          <span
            id="upload-text"
            data-l10n-id="avatar-selector-upload-file"
          ></span>
          <span id="drag-text" data-l10n-id="avatar-selector-drag-file"></span>
        </div>
      </div>`;
  }

  customTabViewImageTemplate() {
    return html`<div class="custom-avatar-crop-header">
        <moz-button
          id="back-button"
          @click=${this.handleCancelClick}
          type="icon ghost"
          iconSrc="chrome://global/skin/icons/arrow-left.svg"
        ></moz-button>
        <span data-l10n-id="avatar-selector-crop"></span>
        <div id="spacer"></div>
      </div>
      <div class="custom-avatar-crop-area">
        <div id="avatar-selection-container">
          <div id="highlight" class="highlight" tabindex="0">
            <div id="highlight-background"></div>
            <div
              id="mover-topLeft"
              class="mover-target direction-topLeft"
              tabindex="0"
            >
              <div class="mover"></div>
            </div>

            <div
              id="mover-topRight"
              class="mover-target direction-topRight"
              tabindex="0"
            >
              <div class="mover"></div>
            </div>

            <div
              id="mover-bottomRight"
              class="mover-target direction-bottomRight"
              tabindex="0"
            >
              <div class="mover"></div>
            </div>

            <div
              id="mover-bottomLeft"
              class="mover-target direction-bottomLeft"
              tabindex="0"
            >
              <div class="mover"></div>
            </div>
          </div>
        </div>
        <img
          id="custom-avatar-image"
          src=${this.blobURL}
          @load=${this.imageLoaded}
        />
      </div>
      <moz-button-group class="custom-avatar-actions"
        ><moz-button
          @click=${this.handleCancelClick}
          data-l10n-id="avatar-selector-cancel-button"
        ></moz-button
        ><moz-button
          type="primary"
          id="save-button"
          @click=${this.handleSaveClick}
          data-l10n-id="avatar-selector-save-button"
        ></moz-button
      ></moz-button-group>`;
  }

  handleCancelClick(event) {
    event.stopImmediatePropagation();

    this.setView(VIEWS.CUSTOM);
    if (this.blobURL) {
      URL.revokeObjectURL(this.blobURL);
    }
    this.file = null;
  }

  async handleSaveClick(event) {
    event.stopImmediatePropagation();

    const img = new Image();
    img.src = this.blobURL;
    await img.decode();

    const { width: imageWidth, height: imageHeight } = img;
    const scale =
      imageWidth <= imageHeight
        ? imageWidth / this.customAvatarCropArea.clientWidth
        : imageHeight / this.customAvatarCropArea.clientHeight;

    // eslint-disable-next-line no-shadow
    const { left, top, radius } = this.avatarRegion.dimensions;
    // eslint-disable-next-line no-shadow
    const { devicePixelRatio } = this.viewDimensions.dimensions;
    const { scrollTop, scrollLeft } = this.customAvatarCropArea;

    // Create the canvas so it is a square around the selected area.
    const scaledRadius = Math.round(radius * scale * devicePixelRatio);
    const squareSize = scaledRadius * 2;
    const squareCanvas = new OffscreenCanvas(squareSize, squareSize);
    const squareCtx = squareCanvas.getContext("2d");

    // Crop the canvas so it is a circle.
    squareCtx.beginPath();
    squareCtx.arc(scaledRadius, scaledRadius, scaledRadius, 0, Math.PI * 2);
    squareCtx.clip();

    const sourceX = Math.round((left + scrollLeft) * scale);
    const sourceY = Math.round((top + scrollTop) * scale);
    const sourceWidth = Math.round(radius * 2 * scale);

    // Draw the image onto the canvas.
    squareCtx.drawImage(
      img,
      sourceX,
      sourceY,
      sourceWidth,
      sourceWidth,
      0,
      0,
      squareSize,
      squareSize
    );

    const blob = await squareCanvas.convertToBlob({ type: "image/png" });
    const circularFile = new File([blob], this.file.name, {
      type: "image/png",
    });

    document.dispatchEvent(
      new CustomEvent("Profiles:CustomAvatarUpload", {
        detail: { file: circularFile },
      })
    );

    if (this.blobURL) {
      URL.revokeObjectURL(this.blobURL);
    }

    this.setView(VIEWS.CUSTOM);
    this.hidden = true;
  }

  updateViewDimensions() {
    let { width, height } = this.customAvatarImage;

    this.viewDimensions.dimensions = {
      width: this.customAvatarCropArea.clientWidth,
      height: this.customAvatarCropArea.clientHeight,
      devicePixelRatio: window.devicePixelRatio,
    };

    if (width > height) {
      this.customAvatarImage.classList.add("height-full");
    } else {
      this.customAvatarImage.classList.add("width-full");
    }
  }

  imageLoaded() {
    this.updateViewDimensions();
    this.setInitialAvatarSelection();
  }

  setInitialAvatarSelection() {
    // Make initial size a little smaller than the view so the movers aren't
    // behind the scrollbar
    let diameter =
      Math.min(this.viewDimensions.width, this.viewDimensions.height) - 20;

    let left =
      Math.floor(this.viewDimensions.width / 2) - Math.floor(diameter / 2);
    // eslint-disable-next-line no-shadow
    let top =
      Math.floor(this.viewDimensions.height / 2) - Math.floor(diameter / 2);

    let right = left + diameter;
    let bottom = top + diameter;

    this.avatarRegion.resizeToSquare({ left, top, right, bottom });

    this.drawSelectionContainer();
  }

  drawSelectionContainer() {
    // eslint-disable-next-line no-shadow
    let { top, left, width, height } = this.avatarRegion.dimensions;

    this.highlight.style = `top:${top}px;left:${left}px;width:${width}px;height:${height}px;`;
  }

  getCoordinatesFromEvent(event) {
    let { clientX, clientY, movementX, movementY } = event;
    let rect = this.avatarSelectionContainer.getBoundingClientRect();

    return { x: clientX - rect.x, y: clientY - rect.y, movementX, movementY };
  }

  handleEvent(event) {
    if (this.view !== VIEWS.CROP) {
      return;
    }

    switch (event.type) {
      case "pointerdown":
        this.handlePointerDown(event);
        break;
      case "pointermove":
        this.handlePointerMove(event);
        break;
      case "pointerup":
        this.handlePointerUp(event);
        break;
      case "keydown":
        this.handleKeyDown(event);
        break;
    }
  }

  handlePointerDown(event) {
    let targetId = event.originalTarget?.id;
    if (
      [
        "highlight",
        "mover-topLeft",
        "mover-topRight",
        "mover-bottomRight",
        "mover-bottomLeft",
      ].includes(targetId)
    ) {
      this.state = STATES.RESIZING;
      this.#moverId = targetId;
    }
  }

  handlePointerMove(event) {
    if (this.state === STATES.RESIZING) {
      let { x, y, movementX, movementY } = this.getCoordinatesFromEvent(event);
      this.handleResizingPointerMove(x, y, movementX, movementY);
    }
  }

  handleResizingPointerMove(x, y, movementX, movementY) {
    switch (this.#moverId) {
      case "highlight": {
        this.avatarRegion.resizeToSquare(
          {
            left: this.avatarRegion.left + movementX,
            top: this.avatarRegion.top + movementY,
            right: this.avatarRegion.right + movementX,
            bottom: this.avatarRegion.bottom + movementY,
          },
          this.#moverId
        );
        break;
      }
      case "mover-topLeft": {
        this.avatarRegion.resizeToSquare(
          {
            left: x,
            top: y,
          },
          this.#moverId
        );
        break;
      }
      case "mover-topRight": {
        this.avatarRegion.resizeToSquare(
          {
            top: y,
            right: x,
          },
          this.#moverId
        );
        break;
      }
      case "mover-bottomRight": {
        this.avatarRegion.resizeToSquare(
          {
            right: x,
            bottom: y,
          },
          this.#moverId
        );
        break;
      }
      case "mover-bottomLeft": {
        this.avatarRegion.resizeToSquare(
          {
            left: x,
            bottom: y,
          },
          this.#moverId
        );
        break;
      }
      default:
        return;
    }

    this.scrollIfByEdge(x, y);
    this.drawSelectionContainer();
  }

  handlePointerUp() {
    this.state = STATES.SELECTED;
    this.#moverId = "";
    this.avatarRegion.sortCoords();
  }

  handleKeyDown(event) {
    switch (event.key) {
      case "ArrowLeft":
        this.handleArrowLeftKeyDown(event);
        break;
      case "ArrowUp":
        this.handleArrowUpKeyDown(event);
        break;
      case "ArrowRight":
        this.handleArrowRightKeyDown(event);
        break;
      case "ArrowDown":
        this.handleArrowDownKeyDown(event);
        break;
      case "Tab":
        return;
      default:
        event.preventDefault();
        return;
    }
    event.preventDefault();
    this.drawSelectionContainer();
  }

  handleArrowLeftKeyDown(event) {
    let targetId = event.originalTarget.id;
    switch (targetId) {
      case "highlight":
        this.avatarRegion.left -= 1;
        this.avatarRegion.right -= 1;

        this.scrollIfByEdge(
          this.avatarRegion.left,
          this.viewDimensions.height / 2
        );
        break;
      case "mover-topLeft":
        this.avatarRegion.left -= 1;
        this.avatarRegion.top -= 1;

        this.scrollIfByEdge(this.avatarRegion.left, this.avatarRegion.top);
        break;
      case "mover-bottomLeft":
        this.avatarRegion.left -= 1;
        this.avatarRegion.bottom += 1;

        this.scrollIfByEdge(this.avatarRegion.left, this.avatarRegion.bottom);
        break;
      case "mover-topRight":
        this.avatarRegion.right -= 1;
        this.avatarRegion.top += 1;

        if (
          this.avatarRegion.x1 >= this.avatarRegion.x2 ||
          this.avatarRegion.y1 >= this.avatarRegion.y2
        ) {
          this.avatarRegion.sortCoords();
          this.bottomLeftMover.focus({ focusVisible: true });
        }
        break;
      case "mover-bottomRight":
        this.avatarRegion.right -= 1;
        this.avatarRegion.bottom -= 1;

        if (
          this.avatarRegion.x1 >= this.avatarRegion.x2 ||
          this.avatarRegion.y1 >= this.avatarRegion.y2
        ) {
          this.avatarRegion.sortCoords();
          this.topLeftMover.focus({ focusVisible: true });
        }
        break;
      default:
        return;
    }

    this.avatarRegion.forceSquare(targetId);
  }

  handleArrowUpKeyDown(event) {
    let targetId = event.originalTarget.id;
    switch (targetId) {
      case "highlight":
        this.avatarRegion.top -= 1;
        this.avatarRegion.bottom -= 1;

        this.scrollIfByEdge(
          this.viewDimensions.width / 2,
          this.avatarRegion.top
        );
        break;
      case "mover-topLeft":
        this.avatarRegion.left -= 1;
        this.avatarRegion.top -= 1;

        this.scrollIfByEdge(this.avatarRegion.left, this.avatarRegion.top);
        break;
      case "mover-bottomLeft":
        this.avatarRegion.left += 1;
        this.avatarRegion.bottom -= 1;

        if (
          this.avatarRegion.x1 >= this.avatarRegion.x2 ||
          this.avatarRegion.y1 >= this.avatarRegion.y2
        ) {
          this.avatarRegion.sortCoords();
          this.topRightMover.focus({ focusVisible: true });
        }
        break;
      case "mover-topRight":
        this.avatarRegion.right += 1;
        this.avatarRegion.top -= 1;

        this.scrollIfByEdge(this.avatarRegion.right, this.avatarRegion.top);
        break;
      case "mover-bottomRight":
        this.avatarRegion.right -= 1;
        this.avatarRegion.bottom -= 1;

        if (
          this.avatarRegion.x1 >= this.avatarRegion.x2 ||
          this.avatarRegion.y1 >= this.avatarRegion.y2
        ) {
          this.avatarRegion.sortCoords();
          this.topLeftMover.focus({ focusVisible: true });
        }
        break;
      default:
        return;
    }

    this.avatarRegion.forceSquare(targetId);
  }

  handleArrowRightKeyDown(event) {
    let targetId = event.originalTarget.id;
    switch (targetId) {
      case "highlight":
        this.avatarRegion.left += 1;
        this.avatarRegion.right += 1;

        this.scrollIfByEdge(
          this.avatarRegion.right,
          this.viewDimensions.height / 2
        );
        break;
      case "mover-topLeft":
        this.avatarRegion.left += 1;
        this.avatarRegion.top += 1;

        if (
          this.avatarRegion.x1 >= this.avatarRegion.x2 ||
          this.avatarRegion.y1 >= this.avatarRegion.y2
        ) {
          this.avatarRegion.sortCoords();
          this.bottomRightMover.focus({ focusVisible: true });
        }
        break;
      case "mover-bottomLeft":
        this.avatarRegion.left += 1;
        this.avatarRegion.bottom -= 1;

        if (
          this.avatarRegion.x1 >= this.avatarRegion.x2 ||
          this.avatarRegion.y1 >= this.avatarRegion.y2
        ) {
          this.avatarRegion.sortCoords();
          this.topRightMover.focus({ focusVisible: true });
        }
        break;
      case "mover-topRight":
        this.avatarRegion.right += 1;
        this.avatarRegion.top -= 1;

        this.scrollIfByEdge(this.avatarRegion.right, this.avatarRegion.top);
        break;
      case "mover-bottomRight":
        this.avatarRegion.right += 1;
        this.avatarRegion.bottom += 1;

        this.scrollIfByEdge(this.avatarRegion.right, this.avatarRegion.bottom);
        break;
      default:
        return;
    }

    this.avatarRegion.forceSquare(targetId);
  }

  handleArrowDownKeyDown(event) {
    let targetId = event.originalTarget.id;
    switch (targetId) {
      case "highlight":
        this.avatarRegion.top += 1;
        this.avatarRegion.bottom += 1;

        this.scrollIfByEdge(
          this.viewDimensions.width / 2,
          this.avatarRegion.bottom
        );
        break;
      case "mover-topLeft":
        this.avatarRegion.left += 1;
        this.avatarRegion.top += 1;

        if (
          this.avatarRegion.x1 >= this.avatarRegion.x2 ||
          this.avatarRegion.y1 >= this.avatarRegion.y2
        ) {
          this.avatarRegion.sortCoords();
          this.bottomRightMover.focus({ focusVisible: true });
        }
        break;
      case "mover-bottomLeft":
        this.avatarRegion.left -= 1;
        this.avatarRegion.bottom += 1;

        this.scrollIfByEdge(this.avatarRegion.left, this.avatarRegion.bottom);
        break;
      case "mover-topRight":
        this.avatarRegion.right -= 1;
        this.avatarRegion.top += 1;

        if (
          this.avatarRegion.x1 >= this.avatarRegion.x2 ||
          this.avatarRegion.y1 >= this.avatarRegion.y2
        ) {
          this.avatarRegion.sortCoords();
          this.bottomLeftMover.focus({ focusVisible: true });
        }
        break;
      case "mover-bottomRight":
        this.avatarRegion.right += 1;
        this.avatarRegion.bottom += 1;

        this.scrollIfByEdge(this.avatarRegion.right, this.avatarRegion.bottom);
        break;
      default:
        return;
    }

    this.avatarRegion.forceSquare(targetId);
  }

  scrollIfByEdge(viewX, viewY) {
    const { width, height } = this.viewDimensions.dimensions;

    if (viewY <= SCROLL_BY_EDGE) {
      // Scroll up
      this.scrollView(0, -(SCROLL_BY_EDGE - viewY));
    } else if (height - viewY < SCROLL_BY_EDGE) {
      // Scroll down
      this.scrollView(0, SCROLL_BY_EDGE - (height - viewY));
    }

    if (viewX <= SCROLL_BY_EDGE) {
      // Scroll left
      this.scrollView(-(SCROLL_BY_EDGE - viewX), 0);
    } else if (width - viewX <= SCROLL_BY_EDGE) {
      // Scroll right
      this.scrollView(SCROLL_BY_EDGE - (width - viewX), 0);
    }
  }

  scrollView(x, y) {
    this.customAvatarCropArea.scrollBy(x, y);
  }

  handleFileUpload(event) {
    const [file] = event.target.files;
    this.file = file;

    if (this.blobURL) {
      URL.revokeObjectURL(this.blobURL);
    }

    this.blobURL = URL.createObjectURL(file);
    this.setView(VIEWS.CROP);
  }

  contentTemplate() {
    switch (this.view) {
      case VIEWS.ICON: {
        return this.iconTabContentTemplate();
      }
      case VIEWS.CUSTOM: {
        return this.customTabUploadFileContentTemplate();
      }
      case VIEWS.CROP: {
        return this.customTabViewImageTemplate();
      }
    }
    return null;
  }

  render() {
    return html`<link
        rel="stylesheet"
        href="chrome://browser/content/profiles/profile-avatar-selector.css"
      />
      <moz-card id="avatar-selector">
        <div id="content">
          <div class="button-group">
            <moz-button
              id="icon"
              type=${this.view === VIEWS.ICON ? "primary" : "default"}
              size="small"
              data-l10n-id="avatar-selector-icon-tab"
              @click=${this.handleTabClick}
            ></moz-button>
            <moz-button
              id="custom"
              type=${this.view === VIEWS.ICON ? "default" : "primary"}
              size="small"
              data-l10n-id="avatar-selector-custom-tab"
              @click=${this.handleTabClick}
            ></moz-button>
          </div>
          ${this.contentTemplate()}
        </div>
      </moz-card>`;
  }
}

customElements.define("profile-avatar-selector", ProfileAvatarSelector);
