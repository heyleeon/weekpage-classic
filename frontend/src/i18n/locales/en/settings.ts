// en · settings — typed against the zh-Hans twin: a missing or extra key fails tsc.
// macOS menu names are quoted exactly as System Settings shows them in English.

import type { Messages } from "../../types";
import type zh from "../zh-Hans/settings";

const settings: Messages<typeof zh> = {
  title: "Settings",
  quit: "Quit WeekPage",
  sections: {
    shortcut: "Shortcut",
    calendar: "Calendar",
    appearance: "Appearance",
    region: "Language & time zone",
    window: "Window",
  },
  calendarWeeks: {
    label: "Weeks shown",
  },
  firstRow: {
    label: "Top row",
    thisWeek: "This week",
    lastWeek: "Last week",
    note: "The week the calendar starts with when the window opens and when you go back to today",
  },
  theme: {
    label: "Theme",
    system: "System",
    light: "Light",
    dark: "Dark",
  },
  language: {
    label: "Language",
  },
  timezone: {
    label: "Time zone",
    system: "System ({{zone}})",
    note: 'Decides when "today" starts, and the times in reminders and history',
  },
  hideOnBlur: {
    label: "Hide when you click away",
    note: "When off, the window stays on top of everything",
  },
  autostart: {
    label: "Open at login",
    note: "When off, the shortcut and reminders won't work after a restart until you open WeekPage",
    noteDev:
      "When off, the shortcut and reminders won't work after a restart until you open WeekPage (development builds don't register a login item)",
  },
  shortcut: {
    label: "Show WeekPage",
    record: "Record",
    recording: "Press keys… Esc to cancel",
    changed: "Shortcut changed to {{combo}}",
    saveFailed: "Couldn't change it. Try again.",
    reserved: "That's a system shortcut. Pick another one.",
    taken: "Another app is using that shortcut. Try another one.",
    invalid: "That shortcut can't be used. Try another one.",
    noModifierMac: "Include ⌃, ⌥ or ⌘. Try another one.",
    noModifierWin: "Include Ctrl or Alt. Try another one.",
    systemSettingsPath: "System Settings → Keyboard → Keyboard Shortcuts",
    conflict: {
      inputSourceNext:
        "macOS uses {{combo}} to switch input sources. Turn off “Select next source in Input menu” in {{path}} → Input Sources, or pick another shortcut here.",
      inputSourcePrevious:
        "macOS uses {{combo}} to switch input sources. Turn off “Select the previous input source” in {{path}} → Input Sources, or pick another shortcut here.",
      spotlight:
        "macOS uses {{combo}} for Spotlight. Turn off “Show Spotlight search” in {{path}} → Spotlight, or pick another shortcut here.",
      spotlightWindow:
        "macOS uses {{combo}} for Spotlight. Turn off “Show Finder search window” in {{path}} → Spotlight, or pick another shortcut here.",
      other:
        "A macOS shortcut already uses {{combo}}. Turn it off in {{path}}, or pick another shortcut here.",
    },
  },
  firstRun: {
    label: "Shortcut tip",
    text: "Press {{combo}} to check that it hides the window. If it doesn't, pick another one in Settings.",
    openSettings: "Open Settings",
    gotIt: "Got it",
  },
};

export default settings;
