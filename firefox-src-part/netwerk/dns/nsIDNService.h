/* -*- Mode: C++; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef nsIDNService_h__
#define nsIDNService_h__

#include "nsIIDNService.h"
#include "nsCOMPtr.h"

#include "mozilla/RWLock.h"
#include "mozilla/intl/UnicodeScriptCodes.h"
#include "mozilla/net/IDNBlocklistUtils.h"
#include "mozilla/intl/IDNA.h"
#include "mozilla/UniquePtr.h"

#include "nsString.h"
#include "nsStringFwd.h"

class nsIPrefBranch;

//-----------------------------------------------------------------------------
// nsIDNService
//-----------------------------------------------------------------------------

namespace mozilla::net {
enum ScriptCombo : int32_t;
}

class nsIDNService final : public nsIIDNService {
 public:
  NS_DECL_THREADSAFE_ISUPPORTS
  NS_DECL_NSIIDNSERVICE

  nsIDNService();

  nsresult Init();

 protected:
  virtual ~nsIDNService();

 private:
  enum stringPrepFlag {
    eStringPrepForDNS,
    eStringPrepForUI,
    eStringPrepIgnoreErrors
  };

  /**
   * Convert the following characters that must be recognized as label
   *  separators per RFC 3490 to ASCII full stop characters
   *
   * U+3002 (ideographic full stop)
   * U+FF0E (fullwidth full stop)
   * U+FF61 (halfwidth ideographic full stop)
   */
  void normalizeFullStops(nsAString& s);

  /**
   * Convert and encode a DNS label in ACE/punycode.
   * @param flag
   *        if eStringPrepIgnoreErrors, all non-ASCII labels are
   *           converted to punycode.
   *        if eStringPrepForUI, only labels that are considered safe
   *           for display are converted.
   *           @see isLabelSafe
   *        if eStringPrepForDNS and stringPrep finds an illegal
   *           character, returns NS_FAILURE and out is empty
   */
  nsresult stringPrepAndACE(const nsAString& in, nsACString& out,
                            stringPrepFlag flag);

  /**
   * Convert a DNS label using the stringprep profile defined in RFC 3454
   */
  nsresult stringPrep(const nsAString& in, nsAString& out, stringPrepFlag flag);

  /**
   * Decode an ACE-encoded DNS label to UTF-8
   *
   * @param flag
   *        if eStringPrepForUI and the label is not considered safe to
   *           display, the output is the same as the input
   *        @see isLabelSafe
   */
  nsresult decodeACE(const nsACString& in, nsACString& out, stringPrepFlag flag,
                     const nsACString& tld);

  /**
   * Convert complete domain names between UTF8 and ACE and vice versa
   *
   * @param flag is passed to decodeACE or stringPrepAndACE for each
   *  label individually, so the output may contain some labels in
   *  punycode and some in UTF-8
   */
  nsresult UTF8toACE(const nsACString& input, nsACString& ace,
                     stringPrepFlag flag);
  nsresult ACEtoUTF8(const nsACString& input, nsACString& _retval,
                     stringPrepFlag flag);

  nsresult Normalize(const nsACString& input, nsACString& output);

  void prefsChanged(const char* pref);

  static void PrefChanged(const char* aPref, void* aSelf) {
    auto* self = static_cast<nsIDNService*>(aSelf);
    self->prefsChanged(aPref);
  }

  /**
   * Determine whether a label is considered safe to display to the user
   * according to the algorithm defined in UTR 39 and the profile
   * selected in mRestrictionProfile.
   *
   * For the ASCII-only profile, returns false for all labels containing
   * non-ASCII characters.
   *
   * For the other profiles, returns false for labels containing any of
   * the following:
   *
   *  Characters in scripts other than the "recommended scripts" and
   *   "aspirational scripts" defined in
   *   http://www.unicode.org/reports/tr31/#Table_Recommended_Scripts
   *   and http://www.unicode.org/reports/tr31/#Aspirational_Use_Scripts
   *  This includes codepoints that are not defined as Unicode
   *   characters
   *
   *  Illegal combinations of scripts (@see illegalScriptCombo)
   *
   *  Numbers from more than one different numbering system
   *
   *  Sequences of the same non-spacing mark
   *
   *  Both simplified-only and traditional-only Chinese characters
   *   XXX this test was disabled by bug 857481
   */
  bool isLabelSafe(const nsAString& label, const nsAString& tld)
      MOZ_EXCLUDES(mLock);

  /**
   * Restriction-level Detection profiles defined in UTR 39
   * http://www.unicode.org/reports/tr39/#Restriction_Level_Detection,
   * and selected by the pref network.IDN.restriction_profile
   */
  enum restrictionProfile {
    eASCIIOnlyProfile,
    eHighlyRestrictiveProfile,
    eModeratelyRestrictiveProfile
  };

  /**
   * Determine whether a combination of scripts in a single label is
   * permitted according to the algorithm defined in UTR 39 and the
   * profile selected in mRestrictionProfile.
   *
   * For the "Highly restrictive" profile, all characters in each
   * identifier must be from a single script, or from the combinations:
   *  Latin + Han + Hiragana + Katakana;
   *  Latin + Han + Bopomofo; or
   *  Latin + Han + Hangul
   *
   * For the "Moderately restrictive" profile, Latin is also allowed
   *  with other scripts except Cyrillic and Greek
   */
  bool illegalScriptCombo(restrictionProfile profile,
                          mozilla::intl::Script script,
                          mozilla::net::ScriptCombo& savedScript);

  /**
   * Convert a DNS label from ASCII to Unicode using IDNA2008
   */
  nsresult IDNA2008ToUnicode(const nsACString& input, nsAString& output);

  /**
   * Convert a DNS label to a normalized form conforming to IDNA2008
   */
  nsresult IDNA2008StringPrep(const nsAString& input, nsAString& output,
                              stringPrepFlag flag);

  // never mutated after initializing.
  mozilla::UniquePtr<mozilla::intl::IDNA> mIDNA;

  // We use this rwlock to guard access to:
  // |mIDNBlocklist|, |mRestrictionProfile|
  mozilla::RWLock mLock{"nsIDNService"};

  // guarded by mLock
  nsTArray<mozilla::net::BlocklistRange> mIDNBlocklist MOZ_GUARDED_BY(mLock);

  // guarded by mLock;
  restrictionProfile mRestrictionProfile MOZ_GUARDED_BY(mLock){
      eASCIIOnlyProfile};
};

#endif  // nsIDNService_h__
