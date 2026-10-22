import { afterEach, describe, expect, it } from "vitest";
import {
  currentLang,
  i18n,
  isSimplifiedChinese,
  resolveLang,
  resources,
  setLang,
  t,
  toLang,
} from "./index";

type Tree = { [k: string]: string | Tree };

function leaves(tree: Tree, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out.set(path, v);
    else for (const [p, s] of leaves(v, path)) out.set(p, s);
  }
  return out;
}

const zh = leaves(resources["zh-Hans"].translation as unknown as Tree);
const en = leaves(resources.en.translation as unknown as Tree);

describe("i18n resources", () => {
  it("zh-Hans and en have exactly the same keys", () => {
    const zhKeys = [...zh.keys()].sort();
    const enKeys = [...en.keys()].sort();
    expect(enKeys.filter((k) => !zh.has(k))).toEqual([]);
    expect(zhKeys.filter((k) => !en.has(k))).toEqual([]);
  });

  it("every section exists in both languages", () => {
    const sections = [
      "common",
      "shell",
      "settings",
      "ui",
      "toasts",
      "calendar",
      "holidays",
      "tasks",
      "timeBar",
      "detail",
      "archive",
    ];
    expect(Object.keys(resources["zh-Hans"].translation).sort()).toEqual([...sections].sort());
    expect(Object.keys(resources.en.translation).sort()).toEqual([...sections].sort());
  });

  it("plural keys always come as an _one / _other pair", () => {
    for (const keys of [zh, en]) {
      for (const k of keys.keys()) {
        if (k.endsWith("_one")) expect(keys.has(`${k.slice(0, -4)}_other`), k).toBe(true);
        if (k.endsWith("_other")) expect(keys.has(`${k.slice(0, -6)}_one`), k).toBe(true);
      }
    }
  });

  it("no empty strings", () => {
    for (const [k, v] of [...zh, ...en]) expect(v.trim(), k).not.toBe("");
  });
});

describe("i18n runtime", () => {
  afterEach(() => {
    void i18n.changeLanguage("zh-Hans");
  });

  it("starts in zh-Hans and translates synchronously", () => {
    expect(currentLang()).toBe("zh-Hans");
    expect(t("common.appName")).toBe("WeekPage");
    expect(t("common.weeks", { count: 1 })).toBe("1周");
    expect(t("common.weeks", { count: 3 })).toBe("3周");
  });

  it("setLang switches synchronously, plurals follow English rules, <html lang> follows", () => {
    setLang("en");
    expect(currentLang()).toBe("en");
    expect(t("common.appName")).toBe("WeekPage");
    expect(t("common.weeks", { count: 1 })).toBe("1 week");
    expect(t("common.weeks", { count: 3 })).toBe("3 weeks");
    expect(document.documentElement.lang).toBe("en");
    expect(document.title).toBe("WeekPage");
    setLang("zh-Hans");
    expect(t("common.actions.undo")).toBe("撤销");
    expect(document.documentElement.lang).toBe("zh-Hans");
    expect(document.title).toBe("WeekPage");
  });

  it("resolveLang: explicit choice wins; system → first Simplified Chinese / English OS tag", () => {
    // Inputs are OS tags (navigator.languages), outputs are the app's language ids.
    expect(resolveLang("zh-Hans", ["en-US"])).toBe("zh-Hans");
    expect(resolveLang("en", ["zh-CN"])).toBe("en");
    expect(resolveLang("system", ["zh-CN", "en"])).toBe("zh-Hans");
    expect(resolveLang("system", ["zh-Hans-CN"])).toBe("zh-Hans");
    expect(resolveLang("system", ["zh-SG"])).toBe("zh-Hans");
    expect(resolveLang("system", ["ZH"])).toBe("zh-Hans");
    // Traditional Chinese has no copy: skipped like any other language without text.
    expect(resolveLang("system", ["zh-TW"])).toBe("en");
    expect(resolveLang("system", [" ", "zh-Hant-TW"])).toBe("en");
    expect(resolveLang("system", ["zh-HK", "zh-CN"])).toBe("zh-Hans");
    expect(resolveLang("system", ["en-US", "zh-CN"])).toBe("en");
    expect(resolveLang("system", ["ja-JP"])).toBe("en");
    // The first language we have text for decides (same rule as the backend's i18n::resolve).
    expect(resolveLang("system", ["ja-JP", "zh-CN", "en"])).toBe("zh-Hans");
    expect(resolveLang("system", ["fr-FR", "en-GB", "zh-CN"])).toBe("en");
    expect(resolveLang("system", [])).toBe("zh-Hans");
    expect(resolveLang(undefined, ["fr"])).toBe("en");
  });

  it("isSimplifiedChinese goes by script, not region", () => {
    for (const tag of ["zh", "zh-CN", "zh-SG", "zh-Hans", "zh-Hans-HK", "zh_CN", "ZH-cn"]) {
      expect(isSimplifiedChinese(tag), tag).toBe(true);
    }
    for (const tag of ["zh-TW", "zh-HK", "zh-MO", "zh-Hant", "zh-Hant-CN", "en", "zhx", ""]) {
      expect(isSimplifiedChinese(tag), tag).toBe(false);
    }
  });

  it("toLang normalises tags", () => {
    expect(toLang("en-GB")).toBe("en");
    expect(toLang("zh-Hans")).toBe("zh-Hans");
    expect(toLang("zh-CN")).toBe("zh-Hans");
    expect(toLang(undefined)).toBe("zh-Hans");
  });
});
