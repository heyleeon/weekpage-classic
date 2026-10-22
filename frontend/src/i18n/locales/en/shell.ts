// en · shell — typed against the zh-Hans twin: a missing or extra key fails tsc.

import type { Messages } from "../../types";
import type zh from "../zh-Hans/shell";

const shell: Messages<typeof zh> = {
  pageSwitch: {
    label: "Pages",
    calendar: "Calendar",
    tasks: "Tasks",
  },
  closeOverlay: "Close panel",
  settings: {
    label: "Settings",
    tooltip: "Settings {{combo}}",
  },
  backToToday: {
    label: "Today",
    tooltip: "Back to today (T)",
  },
};

export default shell;
