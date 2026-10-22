// zh-Hans · ui — source copy (the shape every language must match). See src/i18n/index.ts.
// Plurals: always define both `_one` and `_other` (zh `_one` may repeat `_other`).
//
// Generic components (components/ui). Labels a caller passes in (Capsule / Menu / Popover /
// Toggle / Checkbox names) belong to the caller's section; the modal ✕ uses `common.actions.close`.

const ui = {
  miniCalendar: {
    /** Pager buttons (screen readers / tooltip): pages by `count` weeks. */
    prevWeeks_one: "往前 {{count}} 周",
    prevWeeks_other: "往前 {{count}} 周",
    nextWeeks_one: "往后 {{count}} 周",
    nextWeeks_other: "往后 {{count}} 周",
    /** Header when the visible weeks span two months: 「9月 – 10月」 (from / to = month names). */
    monthRange: "{{from}} – {{to}}",
  },
  /** Step input preview line (StepPreview): only a date was typed, the words are missing. */
  stepPreview: {
    noText: "还差内容",
  },
};

export default ui;
