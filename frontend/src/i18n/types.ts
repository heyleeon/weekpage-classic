// i18n typing: the zh-Hans resources are the source shape; i18next's `t` keys are checked by tsc
// through the CustomTypeOptions augmentation below, and every English section is declared as
// `Messages<typeof zhSection>` so a missing or extra English key is a type error.

import type zhHans from "./locales/zh-Hans";

/** UI languages with resources. The 语言 setting adds "system" (see resolveLang). */
export type Lang = "zh-Hans" | "en";

/** Same keys as `T`, every leaf a string (the English twin of a zh-Hans section). */
export type Messages<T> = {
  [K in keyof T]: T[K] extends string ? string : Messages<T[K]>;
};

/** The whole "translation" namespace (zh-Hans shape). */
export type Translation = typeof zhHans;

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: { translation: Translation };
  }
}
