// vitest setup: unmount React trees between tests (globals are off, so RTL cannot auto-clean), and
// run every test in zh-Hans: i18n starts in the source language, the "system" language setting
// resolves to zh-Hans (navigator.languages is pinned to the OS tag zh-CN), and a test that
// switches language is reset.
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";
import { i18n } from "@/i18n";

function pinNavigatorLanguages(): void {
  if (typeof navigator === "undefined") return;
  Object.defineProperty(navigator, "languages", { value: ["zh-CN"], configurable: true });
  Object.defineProperty(navigator, "language", { value: "zh-CN", configurable: true });
}

pinNavigatorLanguages();

beforeEach(() => {
  pinNavigatorLanguages();
  if (i18n.language !== "zh-Hans") void i18n.changeLanguage("zh-Hans");
});

afterEach(() => {
  cleanup();
  if (i18n.language !== "zh-Hans") void i18n.changeLanguage("zh-Hans");
});
