// en · ui — typed against the zh-Hans twin: a missing or extra key fails tsc.

import type { Messages } from "../../types";
import type zh from "../zh-Hans/ui";

const ui: Messages<typeof zh> = {
  miniCalendar: {
    prevWeeks_one: "Previous week",
    prevWeeks_other: "Previous {{count}} weeks",
    nextWeeks_one: "Next week",
    nextWeeks_other: "Next {{count}} weeks",
    monthRange: "{{from}} – {{to}}",
  },
  stepPreview: {
    noText: "Needs some text",
  },
};

export default ui;
