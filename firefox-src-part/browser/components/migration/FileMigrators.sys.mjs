/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const lazy = {};
import { XPCOMUtils } from "resource://gre/modules/XPCOMUtils.sys.mjs";

ChromeUtils.defineESModuleGetters(lazy, {
  BookmarkHTMLUtils: "resource://gre/modules/BookmarkHTMLUtils.sys.mjs",
  BookmarkJSONUtils: "resource://gre/modules/BookmarkJSONUtils.sys.mjs",
  LoginCSVImport: "resource://gre/modules/LoginCSVImport.sys.mjs",
  MigrationWizardConstants:
    "chrome://browser/content/migration/migration-wizard-constants.mjs",
});

XPCOMUtils.defineLazyGetter(lazy, "gFluentStrings", function () {
  return new Localization([
    "branding/brand.ftl",
    "browser/migrationWizard.ftl",
  ]);
});

/**
 * Base class for a migration that involves reading a single file off of
 * the disk that the user picks using a file picker. The file might be
 * generated by another browser or some other application.
 */
export class FileMigratorBase {
  /**
   * This must be overridden to return a simple string identifier for the
   * migrator, for example "password-csv". This key is what
   * is used as an identifier when calling MigrationUtils.getFileMigrator.
   *
   * @type {string}
   */
  static get key() {
    throw new Error("FileMigrator.key must be overridden.");
  }

  /**
   * This must be overridden to return a Fluent string ID mapping to the display
   * name for this migrator. These strings should be defined in migrationWizard.ftl.
   *
   * @type {string}
   */
  static get displayNameL10nID() {
    throw new Error("FileMigrator.displayNameL10nID must be overridden.");
  }

  /**
   * This getter should get overridden to return an icon url to represent the
   * file to be imported from. By default, this will just use the default Favicon
   * image.
   *
   * @type {string}
   */
  static get brandImage() {
    return "chrome://global/skin/icons/defaultFavicon.svg";
  }

  /**
   * Returns true if the migrator is configured to be enabled.
   *
   * @type {boolean}
   *   true if the migrator should be shown in the migration wizard.
   */
  get enabled() {
    throw new Error("FileMigrator.enabled must be overridden.");
  }

  /**
   * This getter should be overridden to return a Fluent string ID for what
   * the migration wizard header should be while the file migration is
   * underway.
   *
   * @type {string}
   */
  get progressHeaderL10nID() {
    throw new Error("FileMigrator.progressHeaderL10nID must be overridden.");
  }

  /**
   * This getter should be overridden to return a Fluent string ID for what
   * the migration wizard header should be while the file migration is
   * done.
   *
   * @type {string}
   */
  get successHeaderL10nID() {
    throw new Error("FileMigrator.progressHeaderL10nID must be overridden.");
  }

  /**
   * @typedef {object} FilePickerConfiguration
   * @property {string} title
   *   The title that should be assigned to the native file picker window.
   * @property {FilePickerConfigurationFilter[]} filters
   *   One or more extension filters that should be applied to the native
   *   file picker window to make selection easier.
   */

  /**
   * @typedef {object} FilePickerConfigurationFilter
   * @property {string} title
   *   The title for the filter. Example: "CSV Files"
   * @property {string} extensionPattern
   *   A matching pattern for the filter. Example: "*.csv"
   */

  /**
   * A subclass of FileMigratorBase will eventually open a native file picker
   * for the user to select the file from their file system.
   *
   * Subclasses need to override this method in order to configure the
   * native file picker.
   *
   * @returns {Promise<FilePickerConfiguration>}
   */
  async getFilePickerConfig() {
    throw new Error("FileMigrator.getFilePickerConfig must be overridden.");
  }

  /**
   * Returns a list of one or more resource types that should appear to be
   * in progress of migrating while the file migration occurs. Notably,
   * this does not need to match the resource types that are returned by
   * `FileMigratorBase.migrate`.
   *
   * @type {string[]}
   *   An array of resource types from the
   *   MigrationWizardConstants.DISPLAYED_RESOURCE_TYPES set.
   */
  get displayedResourceTypes() {
    throw new Error("FileMigrator.displayedResourceTypes must be overridden");
  }

  /**
   * Called to perform the file migration once the user makes a selection
   * from the native file picker. This will not be called if the user
   * chooses to cancel the native file picker.
   *
   * @param {string} filePath
   *   The path that the user selected from the native file picker.
   */
  // eslint-disable-next-line no-unused-vars
  async migrate(filePath) {
    throw new Error("FileMigrator.migrate must be overridden.");
  }
}

/**
 * A file migrator for importing passwords from CSV or TSV files. CSV
 * files are more common, so this is what we show as the file type for
 * the display name, but this FileMigrator accepts both.
 */
export class PasswordFileMigrator extends FileMigratorBase {
  static get key() {
    return "file-password-csv";
  }

  static get displayNameL10nID() {
    return "migration-wizard-migrator-display-name-file-password-csv";
  }

  static get brandImage() {
    return "chrome://branding/content/document.ico";
  }

  get enabled() {
    return Services.prefs.getBoolPref(
      "signon.management.page.fileImport.enabled",
      false
    );
  }

  get displayedResourceTypes() {
    return [
      lazy.MigrationWizardConstants.DISPLAYED_FILE_RESOURCE_TYPES
        .PASSWORDS_FROM_FILE,
    ];
  }

  get progressHeaderL10nID() {
    return "migration-passwords-from-file-progress-header";
  }

  get successHeaderL10nID() {
    return "migration-passwords-from-file-success-header";
  }

  async getFilePickerConfig() {
    let [title, csvFilterTitle, tsvFilterTitle] =
      await lazy.gFluentStrings.formatValues([
        { id: "migration-passwords-from-file-picker-title" },
        { id: "migration-passwords-from-file-csv-filter-title" },
        { id: "migration-passwords-from-file-tsv-filter-title" },
      ]);

    return {
      title,
      filters: [
        {
          title: csvFilterTitle,
          extensionPattern: "*.csv",
        },
        {
          title: tsvFilterTitle,
          extensionPattern: "*.tsv",
        },
      ],
    };
  }

  async migrate(filePath) {
    let summary = await lazy.LoginCSVImport.importFromCSV(filePath);
    let newEntries = 0;
    let updatedEntries = 0;
    for (let entry of summary) {
      if (entry.result == "added") {
        newEntries++;
      } else if (entry.result == "modified") {
        updatedEntries++;
      }
    }
    let [newMessage, updatedMessage] = await lazy.gFluentStrings.formatValues([
      {
        id: "migration-wizard-progress-success-new-passwords",
        args: { newEntries },
      },
      {
        id: "migration-wizard-progress-success-updated-passwords",
        args: { updatedEntries },
      },
    ]);

    return {
      [lazy.MigrationWizardConstants.DISPLAYED_FILE_RESOURCE_TYPES
        .PASSWORDS_NEW]: newMessage,
      [lazy.MigrationWizardConstants.DISPLAYED_FILE_RESOURCE_TYPES
        .PASSWORDS_UPDATED]: updatedMessage,
    };
  }
}

/**
 * A file migrator for importing bookmarks from a HTML or JSON file.
 *
 * @class BookmarksFileMigrator
 * @augments {FileMigratorBase}
 */
export class BookmarksFileMigrator extends FileMigratorBase {
  static get key() {
    return "file-bookmarks";
  }

  static get displayNameL10nID() {
    return "migration-wizard-migrator-display-name-file-bookmarks";
  }

  static get brandImage() {
    return "chrome://branding/content/document.ico";
  }

  get enabled() {
    return Services.prefs.getBoolPref(
      "browser.migrate.bookmarks-file.enabled",
      false
    );
  }

  get displayedResourceTypes() {
    return [
      lazy.MigrationWizardConstants.DISPLAYED_FILE_RESOURCE_TYPES
        .BOOKMARKS_FROM_FILE,
    ];
  }

  get progressHeaderL10nID() {
    return "migration-bookmarks-from-file-progress-header";
  }

  get successHeaderL10nID() {
    return "migration-bookmarks-from-file-success-header";
  }

  async getFilePickerConfig() {
    let [title, htmlFilterTitle, jsonFilterTitle] =
      await lazy.gFluentStrings.formatValues([
        { id: "migration-bookmarks-from-file-picker-title" },
        { id: "migration-bookmarks-from-file-html-filter-title" },
        { id: "migration-bookmarks-from-file-json-filter-title" },
      ]);

    return {
      title,
      filters: [
        {
          title: htmlFilterTitle,
          extensionPattern: "*.html",
        },
        {
          title: jsonFilterTitle,
          extensionPattern: "*.json",
        },
      ],
    };
  }

  async migrate(filePath) {
    let pathCheck = filePath.toLowerCase();
    let importedCount;

    if (pathCheck.endsWith("html")) {
      importedCount = await lazy.BookmarkHTMLUtils.importFromFile(filePath);
    } else if (pathCheck.endsWith("json") || pathCheck.endsWith("jsonlz4")) {
      importedCount = await lazy.BookmarkJSONUtils.importFromFile(filePath);
    }
    let importedMessage = await lazy.gFluentStrings.formatValue(
      "migration-wizard-progress-success-new-bookmarks",
      {
        newEntries: importedCount,
      }
    );
    return {
      [lazy.MigrationWizardConstants.DISPLAYED_FILE_RESOURCE_TYPES
        .BOOKMARKS_FROM_FILE]: importedMessage,
    };
  }
}