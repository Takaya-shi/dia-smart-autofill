(function (root) {
  "use strict";

  const FIELD_RULES = {
    fullName: {
      autocomplete: ["name"],
      aliases: ["fullname", "yourname", "name", "氏名", "お名前", "姓名", "名前"]
    },
    lastName: {
      autocomplete: ["family-name"],
      aliases: ["lastname", "familyname", "surname", "sei", "姓", "名字"]
    },
    firstName: {
      autocomplete: ["given-name"],
      aliases: ["firstname", "givenname", "forename", "mei", "名"]
    },
    fullNameKana: {
      aliases: [
        "fullnamekana", "namekana", "fullnamefurigana", "namefurigana", "kana", "furigana",
        "氏名カナ", "お名前カナ", "氏名フリガナ", "お名前フリガナ", "氏名ふりがな", "お名前ふりがな",
        "フリガナ", "ふりがな"
      ]
    },
    lastNameKana: {
      aliases: [
        "lastnamekana", "familynamekana", "lastkana", "familykana", "seikana", "kanasei",
        "lastnamefurigana", "familynamefurigana", "姓カナ", "姓フリガナ", "姓ふりがな", "セイ", "せい"
      ]
    },
    firstNameKana: {
      aliases: [
        "firstnamekana", "givennamekana", "firstkana", "givenkana", "meikana", "kanamei",
        "firstnamefurigana", "givennamefurigana", "名カナ", "名フリガナ", "名ふりがな", "メイ", "めい"
      ]
    },
    email: {
      autocomplete: ["email"],
      aliases: ["email", "emailaddress", "mail", "mailaddress", "メール", "メールアドレス"]
    },
    phone: {
      autocomplete: ["tel", "tel-national"],
      aliases: ["phone", "telephone", "tel", "mobile", "phonenumber", "電話", "電話番号", "携帯番号"]
    },
    postalCode: {
      autocomplete: ["postal-code"],
      aliases: ["postalcode", "zipcode", "zip", "postcode", "郵便番号"]
    },
    prefecture: {
      autocomplete: ["address-level1"],
      aliases: ["prefecture", "state", "province", "都道府県"]
    },
    city: {
      autocomplete: ["address-level2"],
      aliases: ["city", "municipality", "locality", "市区町村", "市町村"]
    },
    address1: {
      autocomplete: ["street-address", "address-line1"],
      aliases: ["address1", "streetaddress", "street", "住所1", "町名番地", "番地", "住所"]
    },
    address2: {
      autocomplete: ["address-line2", "address-line3"],
      aliases: ["address2", "building", "apartment", "suite", "住所2", "建物名", "部屋番号"]
    },
    company: {
      autocomplete: ["organization"],
      aliases: ["company", "organization", "organisation", "employer", "会社", "会社名", "法人名", "組織名"]
    },
    department: {
      autocomplete: ["organization-unit"],
      aliases: ["department", "division", "section", "部署", "部署名", "所属"]
    },
    jobTitle: {
      autocomplete: ["organization-title"],
      aliases: ["jobtitle", "title", "position", "role", "役職", "肩書"]
    },
    website: {
      autocomplete: ["url"],
      aliases: ["website", "homepage", "url", "サイト", "ウェブサイト", "ホームページ"]
    },
    birthDate: {
      autocomplete: ["bday"],
      aliases: ["birthdate", "birthday", "dateofbirth", "dob", "生年月日", "誕生日"]
    }
  };

  const EXACT_ONLY_ALIASES = new Set([
    "name", "title", "role", "tel", "zip", "url", "姓", "名", "セイ", "メイ", "せい", "めい", "住所"
  ]);

  function normalize(value) {
    return String(value || "")
      .normalize("NFKC")
      .toLowerCase()
      .replace(/必須|required|任意|optional/g, "")
      .replace(/[\s\-_:.・／/\\()[\]{}]+/g, "");
  }

  function allowsPartialMatch(alias) {
    return !EXACT_ONLY_ALIASES.has(alias) && alias.length > 2;
  }

  function toKatakana(value) {
    return String(value || "").replace(/[ぁ-ゖ]/g, (character) =>
      String.fromCharCode(character.charCodeAt(0) + 0x60)
    );
  }

  function toHiragana(value) {
    return String(value || "").replace(/[ァ-ヶ]/g, (character) =>
      String.fromCharCode(character.charCodeAt(0) - 0x60)
    );
  }

  function adaptKanaValue(value, meta) {
    const hint = `${meta.name || ""} ${meta.id || ""} ${meta.label || ""} ${meta.placeholder || ""} ${meta.ariaLabel || ""}`;
    if (/ひらがな|ふりがな|せい|めい/.test(hint)) return toHiragana(value);
    if (/カタカナ|フリガナ|カナ|セイ|メイ/i.test(hint)) return toKatakana(value);
    return String(value || "");
  }

  function scoreCandidate(meta, fieldKey) {
    const rule = FIELD_RULES[fieldKey];
    if (!rule) return 0;

    const autocompleteTokens = String(meta.autocomplete || "")
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    if ((rule.autocomplete || []).some((token) => autocompleteTokens.includes(token))) {
      return 140;
    }

    const identity = [meta.name, meta.id].filter(Boolean).map(normalize);
    const descriptive = [meta.label, meta.placeholder, meta.ariaLabel].filter(Boolean).map(normalize);
    let best = 0;

    for (const rawAlias of rule.aliases || []) {
      const alias = normalize(rawAlias);
      if (!alias) continue;
      if (identity.includes(alias)) best = Math.max(best, 110);
      else if (allowsPartialMatch(alias) && identity.some((text) => text.includes(alias))) best = Math.max(best, 82);
      if (descriptive.includes(alias)) best = Math.max(best, 105);
      else if (allowsPartialMatch(alias) && descriptive.some((text) => text.includes(alias))) best = Math.max(best, 74);
    }

    return best;
  }

  function fieldTypeAllows(meta, fieldKey) {
    const type = String(meta.type || "text").toLowerCase();
    if (!["text", "email", "tel", "url", "date", "number", "select", "textarea"].includes(type)) {
      return false;
    }
    const sensitiveHint = `${meta.name || ""} ${meta.id || ""} ${meta.label || ""} ${meta.autocomplete || ""}`.normalize("NFKC");
    if (/cc-|one-time-code|password|passwd|credit.?card|card.?number|cvv|cvc|otp|api.?key|APIキー|銀行口座|口座番号|カード番号|暗証番号|認証コード|パスワード/i.test(sensitiveHint)) return false;
    if (type === "email" && fieldKey !== "email") return false;
    if (type === "tel" && fieldKey !== "phone") return false;
    if (type === "url" && fieldKey !== "website") return false;
    if (type === "date" && fieldKey !== "birthDate") return false;
    return true;
  }

  function fieldSemanticsAllow(meta, fieldKey) {
    const hint = `${meta.name || ""} ${meta.id || ""} ${meta.label || ""} ${meta.placeholder || ""} ${meta.ariaLabel || ""}`
      .normalize("NFKC")
      .toLowerCase();
    const requestsKana = /kana|furigana|phonetic|カタカナ|ひらがな|フリガナ|ふりがな|ヨミ|読み|姓カナ|名カナ|セイ|メイ|せい|めい/.test(hint);
    const plainNameFields = new Set(["fullName", "lastName", "firstName"]);
    if (requestsKana && plainNameFields.has(fieldKey)) return false;
    return true;
  }

  function resolveFieldValue(fieldKey, profile, meta) {
    if (!fieldTypeAllows(meta, fieldKey) || !fieldSemanticsAllow(meta, fieldKey)) return null;
    let value = fieldKey === "fullAddress"
      ? [profile.prefecture, profile.city, profile.address1, profile.address2].filter(Boolean).join("")
      : profile[fieldKey];
    if (!value || typeof value !== "string") return null;
    if (fieldKey.endsWith("Kana")) {
      value = value.normalize("NFKC");
      if (!/^[ぁ-ゖァ-ヶー・\s]+$/.test(value)) return null;
      value = adaptKanaValue(value, meta);
    }
    return value;
  }

  function findBestField(meta, profile, threshold) {
    let winner = null;
    let winnerScore = threshold - 1;

    for (const fieldKey of Object.keys(FIELD_RULES)) {
      const value = resolveFieldValue(fieldKey, profile, meta);
      if (!value) continue;
      const score = scoreCandidate(meta, fieldKey);
      if (score > winnerScore) {
        winner = { fieldKey, value, score };
        winnerScore = score;
      }
    }

    for (const custom of profile.customFields || []) {
      if (!custom || !custom.value || !custom.aliases || !fieldTypeAllows(meta, "custom")) continue;
      const identity = normalize(`${meta.name || ""} ${meta.id || ""}`);
      const descriptive = normalize(
        `${meta.label || ""} ${meta.placeholder || ""} ${meta.ariaLabel || ""}`
      );
      for (const rawAlias of String(custom.aliases).split(/[,、\n]/)) {
        const alias = normalize(rawAlias);
        if (!alias) continue;
        let score = 0;
        if (identity === alias) score = 108;
        else if (alias.length > 2 && identity.includes(alias)) score = 80;
        if (descriptive === alias) score = Math.max(score, 103);
        else if (alias.length > 2 && descriptive.includes(alias)) score = Math.max(score, 72);
        if (score > winnerScore) {
          winner = { fieldKey: `custom:${custom.id || alias}`, value: String(custom.value), score };
          winnerScore = score;
        }
      }
    }

    return winner;
  }

  root.AutoFillMatcher = {
    FIELD_RULES, normalize, toKatakana, toHiragana, adaptKanaValue,
    scoreCandidate, fieldTypeAllows, fieldSemanticsAllow, resolveFieldValue, findBestField
  };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = root.AutoFillMatcher;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
