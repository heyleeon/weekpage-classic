import { describe, expect, it } from "vitest";
import { pseudoLocalize, pseudoRequested } from "./pseudo";

describe("pseudoLocalize", () => {
  it("accents letters, brackets the text and pads it by ~40 %", () => {
    expect(pseudoLocalize("Settings")).toBe("[Šéţţîñĝš ~~~~]");
    expect(pseudoLocalize("Back to today ↑")).toBe("[Ɓáçķ ţö ţöðáý ↑ ~~~~~~]");
  });

  it("keeps <Trans> tags and {{vars}} intact", () => {
    expect(pseudoLocalize("<b>3</b> due today")).toBe("[<b>3</b> ðûé ţöðáý ~~~~~]");
    expect(pseudoLocalize("Hi {{name}}")).toBe("[Ĥî {{name}} ~~]");
  });

  it("only pads text without Latin letters (the brackets still show)", () => {
    expect(pseudoLocalize("设置")).toBe("[设置 ~]");
    expect(pseudoLocalize("")).toBe("[]");
  });
});

describe("pseudoRequested", () => {
  it("is on for ?pseudo or VITE_PSEUDO_LOCALE=1, off otherwise", () => {
    expect(pseudoRequested("?pseudo", undefined)).toBe(true);
    expect(pseudoRequested("?now=2026-09-30T10:00&pseudo", undefined)).toBe(true);
    expect(pseudoRequested("", "1")).toBe(true);
    expect(pseudoRequested("?now=2026-09-30T10:00", undefined)).toBe(false);
    expect(pseudoRequested("", "0")).toBe(false);
  });
});
