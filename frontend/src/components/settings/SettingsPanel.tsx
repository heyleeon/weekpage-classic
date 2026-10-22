// Settings panel (ui-spec §16): narrow modal with 呼出 / 日历 / 外观 / 窗口 sections, version and
// 「退出 WeekPage」. OverlayHost provides the scrim, Esc and click-outside. Every change is saved
// right away through `saveSettings(patch)` with only the changed field; the two calendar rows go
// through useUiStore (setCalendarWeeks / setCalendarFirstRow), which also move the view and save.

import { type ReactNode, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { Capsule, CapsuleSegment } from "@/components/ui/Capsule";
import { cx } from "@/components/ui/cx";
import { Modal } from "@/components/ui/Modal";
import { Toggle } from "@/components/ui/Toggle";
import { useDataStore } from "@/hooks/useDataStore";
import { useUiStore } from "@/hooks/useUiStore";
import { currentLang, type Lang } from "@/i18n";
import { api } from "@/lib/api";
import { nowMs, systemTimezone } from "@/lib/clock";
import type { CalendarFirstRow, CalendarWeeks, Language, Theme } from "@/types/domain";
import { ShortcutRecorder } from "./ShortcutRecorder";
import styles from "./settings.module.css";

const WEEKS: readonly CalendarWeeks[] = [2, 3, 4];

const FIRST_ROWS = [
  { value: "thisWeek", labelKey: "settings.firstRow.thisWeek" },
  { value: "lastWeek", labelKey: "settings.firstRow.lastWeek" },
] as const satisfies readonly { value: CalendarFirstRow; labelKey: string }[];

const THEMES = [
  { value: "system", labelKey: "settings.theme.system" },
  { value: "light", labelKey: "settings.theme.light" },
  { value: "dark", labelKey: "settings.theme.dark" },
] as const satisfies readonly { value: Theme; labelKey: string }[];

/** The two languages are always named in their own script; `lang` tells assistive tech. */
const LANGUAGES = [
  { value: "system", labelKey: "common.languageNames.system", lang: undefined },
  { value: "zh-Hans", labelKey: "common.languageNames.zhHans", lang: "zh-Hans" },
  { value: "en", labelKey: "common.languageNames.en", lang: "en" },
] as const satisfies readonly {
  value: Language;
  labelKey: string;
  lang: string | undefined;
}[];

/**
 * A language switch re-mounts the whole Paper subtree (App keys it by language), this panel
 * included. The language we switched away from lets the new panel put focus back on the language
 * row instead of the first control.
 */
let refocusLanguageFrom: Lang | null = null;

type Choice<T> = { value: T; label: ReactNode };

/** A row with its label on the left and a small capsule of choices on the right. */
function ChoiceRow<T extends string | number>({
  setting,
  label,
  note,
  options,
  value,
  onChange,
}: {
  /** `data-setting` on the row (focus restore, tests). */
  setting: string;
  label: string;
  /** Shown under the whole row: the capsule is too wide to share the line with it. */
  note?: string;
  options: readonly Choice<T>[];
  /** undefined = not loaded yet: nothing is selected and clicks do nothing. */
  value: T | undefined;
  onChange: (v: T) => void;
}) {
  return (
    <div className={cx(styles.row, note !== undefined && styles.rowWrap)} data-setting={setting}>
      <div className={styles.rowText}>
        <span className={styles.label}>{label}</span>
      </div>
      <div className={styles.control}>
        <Capsule label={label} size="sm">
          {options.map((o) => (
            <CapsuleSegment
              key={o.value}
              selected={value === o.value}
              onClick={() => {
                if (value !== undefined && value !== o.value) onChange(o.value);
              }}
            >
              {o.label}
            </CapsuleSegment>
          ))}
        </Capsule>
      </div>
      {note !== undefined && <span className={cx(styles.note, styles.noteFull)}>{note}</span>}
    </div>
  );
}

let zoneList: string[] | null = null;

/** Every zone the WebView knows, plus UTC (some engines leave it out of the list). */
function allZones(): string[] {
  if (zoneList) return zoneList;
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: "timeZone") => string[] };
  const names = intl.supportedValuesOf?.("timeZone") ?? [];
  zoneList = names.includes("UTC") ? names : [...names, "UTC"];
  return zoneList;
}

/** 「Asia/Shanghai (GMT+8)」: the zone id is the name; the offset is for picking by clock. */
function zoneLabel(zone: string, at: number): string {
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "shortOffset" })
      .formatToParts(at)
      .find((p) => p.type === "timeZoneName");
    return part ? `${zone} (${part.value})` : zone;
  } catch {
    return zone;
  }
}

/** 「时区」 drop-down: 「跟随系统（…）」 first, then every IANA zone. */
function TimezoneRow({
  value,
  onChange,
}: {
  /** undefined = not loaded yet. */
  value: string | undefined;
  onChange: (v: string) => void;
}) {
  const { t } = useTranslation();
  const now = nowMs();
  const zones = allZones();
  // A stored zone this WebView does not list still shows as itself instead of a blank select.
  const extra = value !== undefined && value !== "system" && !zones.includes(value);
  return (
    <div className={cx(styles.row, styles.rowWrap)} data-setting="timezone">
      <div className={styles.rowText}>
        <label className={styles.label} htmlFor="settings-timezone">
          {t("settings.timezone.label")}
        </label>
      </div>
      <div className={styles.control}>
        <select
          id="settings-timezone"
          className={styles.select}
          value={value ?? "system"}
          disabled={value === undefined}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="system">
            {t("settings.timezone.system", { zone: systemTimezone() })}
          </option>
          {extra && <option value={value}>{value}</option>}
          {zones.map((z) => (
            <option key={z} value={z}>
              {zoneLabel(z, now)}
            </option>
          ))}
        </select>
      </div>
      <span className={cx(styles.note, styles.noteFull)}>{t("settings.timezone.note")}</span>
    </div>
  );
}

export default function SettingsPanel() {
  const { t } = useTranslation();
  const close = useUiStore((s) => s.closeOverlay);
  const weeks = useUiStore((s) => s.calendarWeeks);
  const setWeeks = useUiStore((s) => s.setCalendarWeeks);
  const firstRow = useUiStore((s) => s.calendarFirstRow);
  const setFirstRow = useUiStore((s) => s.setCalendarFirstRow);
  const settings = useDataStore((s) => s.snap?.settings);
  const appInfo = useDataStore((s) => s.appInfo);
  const save = useDataStore((s) => s.saveSettings);
  const bodyRef = useRef<HTMLDivElement>(null);

  // The tray can flip autostart while the window is hidden: re-read on open.
  useEffect(() => {
    void useDataStore.getState().refresh();
  }, []);

  // Re-mounted by a language switch: focus the selected language again. Runs after Modal's own
  // mount effect (children first), so it wins over Modal's default first-control focus.
  useEffect(() => {
    const from = refocusLanguageFrom;
    refocusLanguageFrom = null;
    if (from === null || from === currentLang()) return;
    bodyRef.current
      ?.querySelector<HTMLElement>('[data-setting="language"] [aria-pressed="true"]')
      ?.focus();
  }, []);

  // 「WeekPage Dev 0.1.0」: product name, build flavour and version are not translated words.
  const name = `${t("common.appName")}${appInfo?.isDev ? " Dev" : ""}`;
  const version = appInfo ? `${name} ${appInfo.version}` : name;

  return (
    <Modal
      title={t("settings.title")}
      onClose={close}
      width="narrow"
      footer={
        <div className={styles.foot}>
          <span className={styles.version}>{version}</span>
          <Button variant="text" danger onClick={() => void api.quitApp().catch(() => undefined)}>
            {t("settings.quit")}
          </Button>
        </div>
      }
    >
      <div ref={bodyRef}>
        <section className={styles.section} aria-labelledby="settings-shortcut">
          <h3 id="settings-shortcut" className={styles.sectionTitle}>
            {t("settings.sections.shortcut")}
          </h3>
          <div className={styles.rows}>
            <ShortcutRecorder />
          </div>
        </section>

        <section className={styles.section} aria-labelledby="settings-calendar">
          <h3 id="settings-calendar" className={styles.sectionTitle}>
            {t("settings.sections.calendar")}
          </h3>
          <div className={styles.rows}>
            <ChoiceRow
              setting="calendarWeeks"
              label={t("settings.calendarWeeks.label")}
              options={WEEKS.map((n) => ({ value: n, label: t("common.weeks", { count: n }) }))}
              value={weeks}
              onChange={setWeeks}
            />
            <ChoiceRow
              setting="calendarFirstRow"
              label={t("settings.firstRow.label")}
              note={t("settings.firstRow.note")}
              options={FIRST_ROWS.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
              value={firstRow}
              onChange={setFirstRow}
            />
          </div>
        </section>

        <section className={styles.section} aria-labelledby="settings-look">
          <h3 id="settings-look" className={styles.sectionTitle}>
            {t("settings.sections.appearance")}
          </h3>
          <div className={styles.rows}>
            <ChoiceRow
              setting="theme"
              label={t("settings.theme.label")}
              options={THEMES.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
              value={settings?.theme}
              onChange={(theme) => void save({ theme })}
            />
          </div>
        </section>

        <section className={styles.section} aria-labelledby="settings-region">
          <h3 id="settings-region" className={styles.sectionTitle}>
            {t("settings.sections.region")}
          </h3>
          <div className={styles.rows}>
            <ChoiceRow
              setting="language"
              label={t("settings.language.label")}
              options={LANGUAGES.map((o) => ({
                value: o.value,
                label: <span lang={o.lang}>{t(o.labelKey)}</span>,
              }))}
              value={settings?.language}
              onChange={(language) => {
                refocusLanguageFrom = currentLang();
                void save({ language });
              }}
            />
            <TimezoneRow
              value={settings?.timezone}
              onChange={(timezone) => void save({ timezone })}
            />
          </div>
        </section>

        <section className={styles.section} aria-labelledby="settings-window">
          <h3 id="settings-window" className={styles.sectionTitle}>
            {t("settings.sections.window")}
          </h3>
          <div className={styles.rows}>
            <div className={styles.row}>
              <div className={styles.rowText}>
                <span className={styles.label}>{t("settings.hideOnBlur.label")}</span>
                <span className={styles.note}>{t("settings.hideOnBlur.note")}</span>
              </div>
              <div className={styles.control}>
                <Toggle
                  label={t("settings.hideOnBlur.label")}
                  checked={settings?.hideOnBlur ?? true}
                  disabled={!settings}
                  onChange={(v) => void save({ hideOnBlur: v })}
                />
              </div>
            </div>
            <div className={styles.row}>
              <div className={styles.rowText}>
                <span className={styles.label}>{t("settings.autostart.label")}</span>
                <span className={styles.note}>
                  {appInfo?.isDev ? t("settings.autostart.noteDev") : t("settings.autostart.note")}
                </span>
              </div>
              <div className={styles.control}>
                <Toggle
                  label={t("settings.autostart.label")}
                  checked={settings?.autostart ?? false}
                  disabled={!settings}
                  onChange={(v) => void save({ autostart: v })}
                />
              </div>
            </div>
          </div>
        </section>
      </div>
    </Modal>
  );
}
