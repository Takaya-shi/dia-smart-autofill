"use strict";

const assert = require("node:assert/strict");
const {
  normalize, toKatakana, toHiragana, adaptKanaValue, findBestField, fieldTypeAllows,
  fieldSemanticsAllow
} = require("../matcher.js");

const profile = {
  fullName: "山田 太郎",
  lastName: "山田",
  firstName: "太郎",
  lastNameKana: "ヤマダ",
  firstNameKana: "タロウ",
  email: "taro@example.com",
  phone: "090-1234-5678",
  postalCode: "182-8585",
  prefecture: "東京都",
  company: "サンプル株式会社",
  customFields: [{ id: "member", aliases: "会員番号, member_id", value: "A-123" }]
};

assert.equal(normalize("メール・アドレス"), "メールアドレス");
assert.equal(toKatakana("やまだ たろう"), "ヤマダ タロウ");
assert.equal(toHiragana("ヤマダ タロウ"), "やまだ たろう");
assert.equal(adaptKanaValue("ヤマダ", { label: "せい（ふりがな）" }), "やまだ");
assert.equal(adaptKanaValue("やまだ", { label: "セイ（フリガナ）" }), "ヤマダ");
assert.equal(
  findBestField({ autocomplete: "email", type: "email" }, profile, 100).fieldKey,
  "email"
);
assert.equal(
  findBestField({ label: "姓（必須）", type: "text" }, profile, 70).fieldKey,
  "lastName"
);
assert.deepEqual(
  findBestField({ name: "family_name_kana", label: "姓（フリガナ）", type: "text" }, profile, 70),
  { fieldKey: "lastNameKana", value: "ヤマダ", score: 110 }
);
assert.deepEqual(
  findBestField({ name: "family_name_furigana", label: "姓（ふりがな）", type: "text" }, profile, 70),
  { fieldKey: "lastNameKana", value: "やまだ", score: 110 }
);
assert.equal(
  findBestField({ name: "company_name", type: "text" }, profile, 70).fieldKey,
  "company"
);
assert.equal(
  findBestField({ label: "会社名（必須）", type: "text" }, profile, 70).fieldKey,
  "company"
);
assert.equal(
  findBestField({ name: "member_id", type: "text" }, profile, 70).fieldKey,
  "custom:member"
);
assert.equal(findBestField({ label: "自由記述", type: "text" }, profile, 70), null);
assert.equal(fieldTypeAllows({ type: "password" }, "email"), false);
assert.equal(fieldTypeAllows({ type: "checkbox" }, "custom"), false);
assert.equal(fieldTypeAllows({ type: "email" }, "phone"), false);
assert.equal(
  fieldSemanticsAllow({ name: "family_name_furigana", label: "せい（ふりがな）" }, "lastName"),
  false
);
assert.equal(
  fieldSemanticsAllow({ name: "family_name_furigana", label: "せい（ふりがな）" }, "lastNameKana"),
  true
);

const profileWithoutKana = { ...profile, lastNameKana: "", firstNameKana: "" };
assert.equal(
  findBestField(
    { name: "family_name_furigana", label: "せい（ふりがな）", type: "text" },
    profileWithoutKana,
    70
  ),
  null
);

console.log("matcher tests: ok");
