import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PopoverHost } from "@/components/shell/PopoverHost";
import { ToastHost } from "@/components/shell/ToastHost";
import { useDataStore } from "@/hooks/useDataStore";
import { useEscDispatcher } from "@/hooks/useEscLayer";
import { IME_GRACE_MS } from "@/hooks/useImeSafeEnter";
import { useUiStore } from "@/hooks/useUiStore";
import { setLang } from "@/i18n";
import { features } from "@/lib/features";
import { mockApi, resetMockBackend } from "@/lib/mockBackend";
import { inboxTriageToast } from "@/lib/toasts";
import type { ToastSpec } from "@/types/domain";
import { quickDates } from "./DatePickerPopover";
import { provisionalKey } from "./helpers";
import { InlineAddKeyPoint } from "./InlineAddKeyPoint";
import { KeyPointList } from "./KeyPointList";
import { boardColumns, TaskGrid } from "./TaskGrid";
import TasksPage from "./TasksPage";
import { CHECK_MOVE_MS } from "./TodoRow";

const initialUi = useUiStore.getState();
const initialData = useDataStore.getState();
const TODAY = "2026-09-30";

beforeEach(async () => {
  resetMockBackend();
  useUiStore.setState({ ...initialUi, today: TODAY, page: "tasks", leftTab: "today" }, true);
  useDataStore.setState(initialData, true);
  await useDataStore.getState().refresh();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Expected text after 今天 + 定日期 + 删掉, merged by lib/toasts.ts itself. */
function mergedTriageText(): string {
  const specs: ToastSpec[] = [
    inboxTriageToast("todo"),
    inboxTriageToast("scheduled", "2026-10-05"),
    inboxTriageToast("deleted"),
  ];
  let state = {
    text: specs[0].text,
    meta: specs[0].meta ?? {},
    opIds: [],
    until: 0,
    undone: false,
  };
  for (const next of specs.slice(1)) {
    const merged = next.merge?.(state, next);
    if (merged) state = { ...state, ...merged };
  }
  return state.text;
}

function EscRoot() {
  useEscDispatcher();
  return null;
}

const snap = () => {
  const s = useDataStore.getState().snap;
  if (!s) throw new Error("no snapshot");
  return s;
};

/** The toast (dnd-kit also renders an empty role=status live region). */
function toastEl(): HTMLElement {
  const el = screen.getAllByRole("status").find((s) => s.textContent);
  if (!el) throw new Error("no toast");
  return el;
}

/** Enter on an input the way an IME sends it while composing, then a real Enter. */
async function expectImeSafe(input: HTMLElement, spy: { mock: { calls: unknown[] } }) {
  fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
  fireEvent.keyDown(input, { key: "Enter", isComposing: true });
  fireEvent.compositionStart(input);
  fireEvent.keyDown(input, { key: "Enter" });
  fireEvent.compositionEnd(input);
  fireEvent.keyDown(input, { key: "Enter" }); // the late keydown right after compositionend
  expect(spy.mock.calls.length).toBe(0);
  await new Promise((r) => setTimeout(r, IME_GRACE_MS + 10));
  await act(async () => {
    fireEvent.keyDown(input, { key: "Enter" });
  });
  expect(spy.mock.calls.length).toBe(1);
}

/** Pointer at (x, y) (one finger / mouse, primary button). */
const at = (x: number, y = 100) => ({
  pointerId: 1,
  isPrimary: true,
  button: 0,
  clientX: x,
  clientY: y,
});

/** Pointer swipe on `el` from x0 to x1: one move, then release. Moves go to the document, where
 *  dnd-kit listens (they bubble on to SwipeRow's window listeners). */
function swipe(el: HTMLElement, x0: number, x1: number) {
  fireEvent.pointerDown(el, at(x0));
  fireEvent.pointerMove(document, at(x1));
  fireEvent.pointerUp(document, at(x1));
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** What a card says beyond its bare text: the accessible names its icons carry (their tips). */
const cardWords = (card: HTMLElement) =>
  [...card.querySelectorAll("[aria-label]")].map((e) => e.getAttribute("aria-label")).join(" | ");

describe("TodoPanel", () => {
  it("renders the todo tags of the demo data (ui-spec §5.4)", () => {
    render(<TasksPage />);
    const list = screen.getByTestId("todo-list");
    const row = (title: string) =>
      within(list).getByText(title).closest("[data-todo-id]") as HTMLElement;
    expect(row("回复房东关于续租的邮件").textContent).toContain("今天 18:00");
    // Added yesterday, no reminder: no carried-over tag (2026-10-02).
    expect(row("修复 orbit 托盘图标闪烁 bug").textContent).not.toMatch(/\d+\/\d+|顺延/);
    expect(row("问会计：LLC 每年报什么税").textContent).toContain("10/9");
    expect(row("研究 Tauri 全局快捷键").textContent).not.toMatch(/\d+\/\d+|顺延/);
    expect(screen.getByText("今天完成 1")).toBeTruthy();
    expect(screen.getByRole("button", { name: /待办\s*4/ })).toBeTruthy();
    expect(screen.queryByText("上下拖动排序 · 越靠上越重要")).toBeNull();
    expect(screen.getByTestId("inbox-badge").textContent).toBe("3");
  });

  it("add todo input ignores IME Enter", async () => {
    const spy = vi.spyOn(mockApi, "createTodo");
    render(<TasksPage />);
    // The round 「+」 in the panel head opens the add row on the 今天 tab.
    await userEvent.click(screen.getAllByRole("button", { name: "添加待办" })[0]);
    const input = screen.getByRole("textbox", { name: "添加待办" });
    fireEvent.change(input, { target: { value: "买牛奶" } });
    await expectImeSafe(input, spy);
    expect(spy).toHaveBeenCalledWith({ title: "买牛奶" });
  });

  it("inbox input ignores IME Enter and saves to the top", async () => {
    const spy = vi.spyOn(mockApi, "createInboxItem");
    useUiStore.setState({ leftTab: "inbox" });
    render(<TasksPage />);
    const input = screen.getByRole("textbox", { name: "收件箱输入" });
    fireEvent.change(input, { target: { value: "申请海外学校（UCL / 港大）" } });
    await expectImeSafe(input, spy);
    await waitFor(() => expect(snap().inbox).toHaveLength(4));
    const first = screen.getByTestId("inbox-list").querySelector("[data-inbox-id]");
    expect(first?.textContent).toContain("申请海外学校");
    expect(screen.getByTestId("inbox-badge").textContent).toBe("4");
  });

  it("three triages merge into one toast and one undo reverts all 3 ops (ui-spec §6.4)", async () => {
    const undo = vi.spyOn(mockApi, "undo");
    useUiStore.setState({ leftTab: "inbox" });
    render(
      <>
        <TasksPage />
        <PopoverHost />
        <ToastHost />
      </>,
    );
    const firstRow = () =>
      screen.getByTestId("inbox-list").querySelector("[data-inbox-id]") as HTMLElement;

    const firstText = () => firstRow().querySelector("span") as HTMLElement;

    // 1. 今天 = swipe right
    swipe(firstText(), 100, 200);
    await waitFor(() => expect(snap().inbox).toHaveLength(2));
    expect(toastEl().textContent).toContain("已进待办");

    // 2. 定日期 → 10/5 → 确定
    await userEvent.hover(firstRow());
    await userEvent.click(within(firstRow()).getByRole("button", { name: /定日期/ }));
    const picker = screen.getByRole("dialog", { name: "选日期" });
    expect(picker.textContent).toContain("排到哪天？");
    await userEvent.click(picker.querySelector('[data-date="2026-10-05"]') as HTMLElement);
    expect(picker.textContent).toContain("10/5 周一 · 进待办 + 日历");
    await userEvent.click(within(picker).getByRole("button", { name: "确定" }));
    await waitFor(() => expect(snap().inbox).toHaveLength(1));
    const scheduled = snap().todos.find((t) => t.remindDate === "2026-10-05");
    expect(scheduled?.title).toBe("orbit 官网要不要做英文版");

    // 3. 删掉 = swipe left, then the red 删除
    swipe(firstText(), 300, 200);
    const del = screen
      .getByTestId("inbox-list")
      .querySelector("[data-swipe-delete]") as HTMLElement;
    expect(del.textContent).toBe("删除");
    await userEvent.click(del);
    await waitFor(() => expect(snap().inbox).toHaveLength(0));

    const toast = toastEl();
    // The merged wording lives only in lib/toasts.ts; compute it from there.
    expect(toast.textContent).toContain(mergedTriageText());
    expect(toast.textContent).toContain("3 条：2 条进待办 · 1 条删掉");
    await userEvent.click(within(toast).getByRole("button", { name: "撤销" }));
    expect(undo).toHaveBeenCalledTimes(1);
    const opIds = undo.mock.calls[0][0];
    expect(opIds).toHaveLength(3);
    expect(new Set(opIds).size).toBe(3);
    await waitFor(() => expect(snap().inbox).toHaveLength(3));
    expect(snap().todos.some((t) => t.title === "orbit 官网要不要做英文版")).toBe(false);
    expect(toastEl().textContent).toBe("已撤销");
  });
});

describe("DatePickerPopover", () => {
  it("quick dates: 周五 this week, 下周五 from Friday on (ui-spec §12.1)", () => {
    expect(quickDates("2026-09-30").map((q) => `${q.label}=${q.date}`)).toEqual([
      "今天=2026-09-30",
      "明天=2026-10-01",
      "周五=2026-10-02",
      "下周一=2026-10-05",
    ]);
    expect(quickDates("2026-10-03")[2]).toEqual({ label: "下周五", date: "2026-10-09" });
  });

  it("todo reminder: pick 10/9 + 「6点」 → 18:00, then 确定 saves", async () => {
    const spy = vi.spyOn(mockApi, "updateTodo");
    const todo = snap().todos.find((t) => t.title === "研究 Tauri 全局快捷键");
    if (!todo) throw new Error("seed todo missing");
    useUiStore.getState().openPopover({
      kind: "datePicker",
      purpose: "todoReminder",
      targetId: todo.id,
      anchor: { top: 100, left: 32, width: 300, height: 32 },
    });
    render(<PopoverHost />);
    const picker = screen.getByRole("dialog", { name: "选日期" });
    expect(picker.textContent).toContain("哪天提醒？");
    // Not ready yet: dimmed but clickable; a press points at the calendar instead.
    const ok = within(picker).getByRole("button", { name: "确定" });
    expect(ok.getAttribute("aria-disabled")).toBe("true");
    await userEvent.click(ok);
    expect(useUiStore.getState().popover).not.toBeNull();
    expect(document.activeElement?.contains(picker.querySelector('[data-date="2026-10-09"]'))).toBe(
      true,
    );
    expect((picker.querySelector('[data-date="2026-09-29"]') as HTMLButtonElement).disabled).toBe(
      true,
    );
    await userEvent.click(picker.querySelector('[data-date="2026-10-09"]') as HTMLElement);
    expect(picker.textContent).toContain("10/9 周五 提醒");
    await userEvent.click(within(picker).getByRole("switch", { name: "具体时间" }));
    fireEvent.change(within(picker).getByRole("textbox", { name: "提醒时间" }), {
      target: { value: "6点" },
    });
    expect(picker.textContent).toContain("10/9 周五 18:00 提醒");
    await userEvent.click(within(picker).getByRole("button", { name: "确定" }));
    expect(spy).toHaveBeenCalledWith(todo.id, {
      title: todo.title,
      remindDate: "2026-10-09",
      remindTime: "18:00",
    });
    expect(useUiStore.getState().popover).toBeNull();
  });
});

describe("TaskGrid", () => {
  it("lays the 9 seed cards out as in V3-A and writes the measured column heights", () => {
    const setColumnHeights = vi.fn();
    useUiStore.setState({ setColumnHeights });
    const { container, unmount } = render(<TaskGrid snap={snap()} today={TODAY} />);
    const titles = Array.from(container.querySelectorAll("[data-column]")).map((col) =>
      Array.from(col.querySelectorAll("[data-task-id] h3")).map((h) => h.textContent),
    );
    expect(titles).toEqual([
      ["交报销单", "注册美卡", "landing 文案"],
      ["课程作业", "交会议 PPT", "注册美国公司"],
      ["写 Q3 季度总结", "orbit 域名备案", "orbit 美国商标"],
    ]);
    expect(setColumnHeights).toHaveBeenCalled();
    const heights = setColumnHeights.mock.calls[0][0];
    expect(heights).toHaveLength(3);
    for (const h of heights) expect(typeof h).toBe("number");
    unmount();
    expect(setColumnHeights).toHaveBeenLastCalledWith(null);
  });

  it("re-measures the columns synchronously when the snapshot changes", () => {
    const setColumnHeights = vi.fn();
    useUiStore.setState({ setColumnHeights });
    const first = snap();
    const { rerender } = render(<TaskGrid snap={first} today={TODAY} />);
    const before = setColumnHeights.mock.calls.length;
    rerender(<TaskGrid snap={{ ...first, tasks: first.tasks.slice(1) }} today={TODAY} />);
    expect(setColumnHeights.mock.calls.length).toBeGreaterThan(before);
  });

  it("card texts follow the time bar rules (ui-spec §20)", () => {
    render(<TasksPage />);
    const card = (title: string) => screen.getByRole("group", { name: title }) as HTMLElement;
    // The card shows one sentence, the day count set large on the left, and the bare date range;
    // both full sentences are the tip / accessible name (ui-spec §8.1, §8.4).
    expect(card("交报销单").textContent).toBe("交报销单已过 2 天9/24–9/28");
    const headline = within(card("交报销单")).getByTestId("time-headline");
    expect(headline.textContent).toBe("已过 2 天");
    expect(headline.querySelector("span")?.textContent).toBe("2");
    expect(card("课程作业").textContent).toContain("还剩 2 天");
    expect(card("landing 文案").textContent).toContain("还有 8 天");
    expect(card("orbit 域名备案").textContent).toContain("已进行 19 天");
    expect(cardWords(card("交报销单"))).toContain("截止 9/28 周一 · 已过 2 天");
    expect(cardWords(card("交报销单"))).toContain("归档");
    expect(cardWords(card("课程作业"))).toContain("今天 · 第 2 / 4 天 · 还剩 2 天");
    expect(cardWords(card("landing 文案"))).toContain("10/8 开始 · 共 9 天 · 还有 8 天");
    expect(cardWords(card("orbit 域名备案"))).toContain("已进行 19 天");
    // No due date: the range ends in ∞, not a date.
    expect(card("orbit 域名备案").textContent).toMatch(/^orbit 域名备案已进行 19 天9\/12–域名/);
    // Up to 7 rows show in full (more scroll inside the card); the footer is ✓ a/b.
    expect(card("orbit 域名备案").textContent).toContain("4/7");
    expect(cardWords(card("orbit 域名备案"))).toContain("已完成 4 / 7");
    expect(cardWords(card("注册美卡"))).toContain("已完成 3 / 5");
    expect(screen.getByText("9 件")).toBeTruthy();
    expect(screen.getByText("1 件逾期")).toBeTruthy();
    // No 「当前」 badge any more (2026-10-02), and nothing is overdue on 9/30.
    expect(screen.queryByText("当前")).toBeNull();
    expect(screen.queryByText(/步逾期/)).toBeNull();
  });

  it("notes (记一笔) show on the card in timeline order: static marker, date at the end, not counted (ui-spec §8.6)", () => {
    render(<TasksPage />);
    const card = screen.getByRole("group", { name: "注册美卡" }) as HTMLElement;
    const rows = [...card.querySelectorAll<HTMLElement>("[data-kp-id]")];
    expect(rows.map((r) => r.textContent)).toEqual([
      "查资料选卡",
      "准备材料",
      "提交申请",
      "邮件：申请已收到，7–10 个工作日内答复9/25",
      "等审批 · 10/1 查",
      "激活卡",
    ]);
    const note = rows[3];
    // Not tickable: the marker is an image, not a button, and only the text opens the detail.
    expect(within(note).getByRole("img", { name: "对方" })).toBeTruthy();
    expect(within(note).queryByRole("button", { name: /^勾掉|^取消勾/ })).toBeNull();
    // Progress counts key points only.
    expect(cardWords(card)).toContain("已完成 3 / 5");
  });

  it("overdue steps: 「N 步逾期」 in the title row, 「!」 marker and 「逾期 N 天」 on the row (ui-spec §9.3)", () => {
    act(() => useUiStore.setState({ today: "2026-10-03" }));
    render(<TasksPage />);
    const card = (title: string) => screen.getByRole("group", { name: title }) as HTMLElement;
    // 注册美卡: 等审批 · 10/1 查 is two days late.
    // 「⚠ 1」 in the title row; 「1 步逾期」 is its name / tip.
    expect(within(card("注册美卡")).getByRole("img", { name: "1 步逾期" }).textContent).toBe("1");
    // The row: red 「!」 marker, its date in red at the end, 「逾期 2 天」 in its name / tip.
    const lateRow = within(card("注册美卡"))
      .getByRole("button", { name: "等审批 · 10/1 查 · 逾期 2 天" })
      .closest("[data-kp-id]") as HTMLElement;
    expect(lateRow.querySelector("[role=img]")?.className).toMatch(/overdue/);
    expect(lateRow.textContent).toBe("等审批 · 10/1 查10/1");
    // 交会议 PPT: 10/2 检查一遍初稿 is a day late; undated steps never are.
    expect(cardWords(card("交会议 PPT"))).toContain("逾期 1 天");
    // A step dated later (等管局 · 10/9 查) is not overdue yet.
    expect(within(card("orbit 域名备案")).queryByRole("img", { name: /步逾期/ })).toBeNull();
  });

  it("a card's steps change only in the detail: no tick, no swipe, no Delete; a click opens the detail", () => {
    const done = vi.spyOn(mockApi, "setKeyPointDone");
    const del = vi.spyOn(mockApi, "deleteKeyPoint");
    render(<TasksPage />);
    const card = screen.getByRole("group", { name: "注册美卡" }) as HTMLElement;
    expect(within(card).queryByRole("button", { name: /^勾掉|^取消勾/ })).toBeNull();
    const text = within(card).getByText("激活卡");
    const row = text.closest("[data-kp-id]") as HTMLElement;
    // The marker is a picture, not a button.
    expect(within(row).getByRole("img")).toBeTruthy();
    swipe(text, 100, 200);
    swipe(text, 300, 200);
    fireEvent.keyDown(text, { key: "Delete" });
    expect(done).not.toHaveBeenCalled();
    expect(row.querySelector("[data-swipe-delete]")).toBeNull();
    expect(del).not.toHaveBeenCalled();
    fireEvent.click(text);
    expect(useUiStore.getState().overlay).toMatchObject({
      kind: "taskDetail",
      focusKeyPointId: row.dataset.kpId,
    });
  });

  it("with features.cardStepActions on (kept for later): marker and swipe tick, swipe left deletes", async () => {
    features.cardStepActions = true;
    try {
      const done = vi.spyOn(mockApi, "setKeyPointDone");
      render(<TasksPage />);
      const card = () => screen.getByRole("group", { name: "注册美卡" }) as HTMLElement;
      await userEvent.click(within(card()).getByRole("button", { name: "勾掉 激活卡" }));
      await waitFor(() => expect(done).toHaveBeenCalledWith(expect.any(String), true));
      expect(within(card()).getAllByRole("button", { name: /^取消勾/ }).length).toBeGreaterThan(0);
      swipe(within(card()).getByText("准备材料"), 100, 200);
      await waitFor(() => expect(done).toHaveBeenCalledTimes(2));
      const text = within(card()).getByText("激活卡");
      swipe(text, 300, 200);
      expect(text.closest("[data-kp-id]")?.querySelector("[data-swipe-delete]")).toBeTruthy();
    } finally {
      features.cardStepActions = false;
    }
  });

  it("archiving a card without key points archives directly with an undo toast", async () => {
    const spy = vi.spyOn(mockApi, "archiveTask");
    render(
      <>
        <TasksPage />
        <ToastHost />
      </>,
    );
    await userEvent.click(
      within(screen.getByRole("group", { name: "交报销单" })).getByRole("button", {
        name: /归档/,
      }),
    );
    // The card collapses for 200ms first (§8.8), then it is archived.
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(toastEl().textContent).toContain("已归档「交报销单」"));
    expect(useUiStore.getState().overlay).toBeNull();
  });

  it("boardColumns ignores archived tasks; provisional keys sort between neighbours", () => {
    const cols = boardColumns(snap());
    expect(cols.flat()).toHaveLength(9);
    const k = provisionalKey("V", "l");
    expect(k > "V" && k < "l").toBe(true);
    expect(provisionalKey(null, "V") < "V").toBe(true);
  });
});

/** dnd-kit's hidden screen-reader instructions (one per drag surface). */
function dragInstructions(): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>("[id^='DndDescribedBy']")).map(
    (el) => el.textContent ?? "",
  );
}

describe("drag screen-reader texts", () => {
  it("to-do rows and task cards describe their drag in the UI language, not dnd-kit's English", () => {
    render(<TasksPage />);
    expect(dragInstructions().sort()).toEqual([
      "拖动任务卡可调整顺序，或拖到别的列",
      "按住拖动可调整顺序，越靠上越重要",
    ]);
  });

  it("English", () => {
    setLang("en");
    render(<TasksPage />);
    expect(dragInstructions().sort()).toEqual([
      "Drag a card to reorder it or move it to another column",
      "Drag up or down to reorder; the top is the most important",
    ]);
  });
});

describe("KeyPointList", () => {
  it("shows up to 7 rows in full; from the 8th the list scrolls inside 7 × 24 px", () => {
    const base = snap().keyPoints[0];
    const rows = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ ...base, id: `kp${i}`, text: `step ${i}` }));
    const { container, rerender } = render(
      <KeyPointList taskId={base.taskId} entries={rows(7)} overdue={new Map()} />,
    );
    expect(container.querySelectorAll("[data-kp-id]")).toHaveLength(7);
    expect(container.querySelector<HTMLElement>("[style*='max-height']")).toBeNull();
    rerender(<KeyPointList taskId={base.taskId} entries={rows(8)} overdue={new Map()} />);
    expect(container.querySelector<HTMLElement>("[style*='max-height']")?.style.maxHeight).toBe(
      "168px",
    );
  });
});

describe("InlineAddKeyPoint", () => {
  it("shows the live type badge, keeps the input after Enter, ignores IME Enter", async () => {
    const add = vi.spyOn(mockApi, "addKeyPoint");
    const task = snap().tasks.find((t) => t.title === "课程作业");
    if (!task) throw new Error("seed task missing");
    const onClose = vi.fn();
    const onAdded = vi.fn();
    render(<InlineAddKeyPoint taskId={task.id} onAdded={onAdded} onClose={onClose} />);
    const input = screen.getByRole("textbox", { name: "加关键点" });
    fireEvent.change(input, { target: { value: "等助教回复选题" } });
    expect(screen.getByText("等别人")).toBeTruthy();
    fireEvent.change(input, { target: { value: "10/1 查一遍参考文献格式" } });
    expect(screen.getByRole("button", { name: /检查点 · 10\/1/ })).toBeTruthy();
    fireEvent.change(input, { target: { value: "等助教回复选题" } });
    await expectImeSafe(input, add);
    expect(add).toHaveBeenCalledWith(task.id, { kind: "wait", text: "等助教回复选题", date: null });
    await waitFor(() => expect(onAdded).toHaveBeenCalled());
    expect((input as HTMLInputElement).value).toBe("");
    expect(onClose).not.toHaveBeenCalled();
    // A manual kind sticks for this entry.
    fireEvent.change(input, { target: { value: "写引言" } });
    await userEvent.click(screen.getByRole("button", { name: /我来做/ }));
    expect(screen.getByRole("button", { name: /等别人/ })).toBeTruthy();
    fireEvent.change(input, { target: { value: "写引言和结论" } });
    expect(screen.getByRole("button", { name: /等别人/ })).toBeTruthy();
    // Empty Enter closes.
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onClose).toHaveBeenCalled();
  });

  it("a typed date is previewed and cut out; a lone date waits for words", async () => {
    const add = vi.spyOn(mockApi, "addKeyPoint");
    const task = snap().tasks.find((t) => t.title === "课程作业");
    if (!task) throw new Error("seed task missing");
    render(<InlineAddKeyPoint taskId={task.id} onAdded={() => undefined} onClose={() => {}} />);
    const input = screen.getByRole("textbox", { name: "加关键点" });
    fireEvent.change(input, { target: { value: "10/1" } });
    expect(screen.getByTestId("step-preview").textContent).toBe("↳ 10/1 周四 还差内容");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(add).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "10/1 查一遍参考文献格式" } });
    expect(screen.getByTestId("step-preview").textContent).toBe("↳ 10/1 周四 查一遍参考文献格式");
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(add).toHaveBeenCalledOnce());
    expect(add).toHaveBeenCalledWith(task.id, {
      kind: "check",
      text: "查一遍参考文献格式",
      date: "2026-10-01",
    });
  });

  it("Esc closes the input without adding (inline-input layer of the Esc chain)", () => {
    const add = vi.spyOn(mockApi, "addKeyPoint");
    const task = snap().tasks.find((t) => t.title === "课程作业");
    if (!task) throw new Error("seed task missing");
    const onClose = vi.fn();
    render(
      <>
        <EscRoot />
        <InlineAddKeyPoint taskId={task.id} onAdded={() => undefined} onClose={onClose} />
      </>,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "加关键点" }), {
      target: { value: "写引言" },
    });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(add).not.toHaveBeenCalled();
  });
});

describe("TodoRow", () => {
  it("a ticked todo moves to 今天完成 after ≈600 ms; unticking there restores it", async () => {
    const done = vi.spyOn(mockApi, "setTodoDone");
    render(<TasksPage />);
    const box = screen.getByRole("checkbox", { name: "研究 Tauri 全局快捷键" });
    await userEvent.click(box);
    expect(done).not.toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, CHECK_MOVE_MS + 50));
    await waitFor(() => expect(screen.getByText("今天完成 2")).toBeTruthy());
    expect(done).toHaveBeenCalledWith(expect.any(String), true);
    await userEvent.click(screen.getByRole("checkbox", { name: "研究 Tauri 全局快捷键" }));
    await waitFor(() => expect(screen.getByText("今天完成 1")).toBeTruthy());
    expect(done).toHaveBeenLastCalledWith(expect.any(String), false);
  });
});

describe("todo and inbox gestures (ui-spec §5.6, §6.3, §10.14)", () => {
  const todoTitle = (title: string) =>
    within(screen.getByTestId("todo-list")).getByText(title) as HTMLElement;

  it("a todo swiped right is ticked like its checkbox; swiped right in 今天完成 it comes back", async () => {
    const done = vi.spyOn(mockApi, "setTodoDone");
    render(<TasksPage />);
    swipe(todoTitle("研究 Tauri 全局快捷键"), 100, 200);
    expect(
      (screen.getByRole("checkbox", { name: "研究 Tauri 全局快捷键" }) as HTMLInputElement).checked,
    ).toBe(true);
    expect(done).not.toHaveBeenCalled();
    await wait(CHECK_MOVE_MS + 50);
    await waitFor(() => expect(screen.getByText("今天完成 2")).toBeTruthy());
    expect(done).toHaveBeenCalledWith(expect.any(String), true);
    // A short swipe does nothing.
    swipe(todoTitle("研究 Tauri 全局快捷键"), 100, 140);
    expect(done).toHaveBeenCalledTimes(1);
    swipe(todoTitle("研究 Tauri 全局快捷键"), 100, 200);
    await waitFor(() => expect(screen.getByText("今天完成 1")).toBeTruthy());
    expect(done).toHaveBeenLastCalledWith(expect.any(String), false);
  });

  it("a todo swiped left opens 删除; the button deletes it with an undo toast", async () => {
    render(<TasksPage />);
    swipe(todoTitle("研究 Tauri 全局快捷键"), 300, 200);
    const row = todoTitle("研究 Tauri 全局快捷键").closest("[data-todo-id]") as HTMLElement;
    const button = row.querySelector("[data-swipe-delete]") as HTMLElement;
    expect(button.textContent).toBe("删除");
    expect(useUiStore.getState().dragging).toBe(false);
    await userEvent.click(button);
    await waitFor(() =>
      expect(snap().todos.some((t) => t.title === "研究 Tauri 全局快捷键")).toBe(false),
    );
    expect(useUiStore.getState().toast?.text).toBe("已删除「研究 Tauri 全局快捷键」");
  });

  it("drag: > 4 px up / down; > 6 px sideways first is a swipe instead, even after a pause", async () => {
    const done = vi.spyOn(mockApi, "setTodoDone");
    render(<TasksPage />);
    const title = () => todoTitle("研究 Tauri 全局快捷键");
    // 5 px down: drag.
    fireEvent.pointerDown(title(), at(100, 100));
    fireEvent.pointerMove(document, at(100, 105));
    expect(useUiStore.getState().dragging).toBe(true);
    fireEvent.pointerUp(document, at(100, 105));
    await waitFor(() => expect(useUiStore.getState().dragging).toBe(false));
    // 10 px sideways first: the drag gives up.
    fireEvent.pointerDown(title(), at(100));
    fireEvent.pointerMove(document, at(110, 102));
    expect(useUiStore.getState().dragging).toBe(false);
    fireEvent.pointerUp(document, at(110, 102));
    // No hold to drag: a press that rests, then goes sideways, is a slow swipe (it ticks).
    fireEvent.pointerDown(title(), at(100));
    await wait(400);
    expect(useUiStore.getState().dragging).toBe(false);
    fireEvent.pointerMove(document, at(110));
    fireEvent.pointerMove(document, at(220));
    fireEvent.pointerUp(document, at(220));
    expect(useUiStore.getState().dragging).toBe(false);
    await waitFor(() => expect(done).toHaveBeenCalledTimes(1), { timeout: CHECK_MOVE_MS + 500 });
  });

  it("an inbox item swiped right goes to today's to-dos; swiped left, 删除 deletes it", async () => {
    const create = vi.spyOn(mockApi, "createTodo");
    const remove = vi.spyOn(mockApi, "deleteInboxItem");
    useUiStore.setState({ leftTab: "inbox" });
    render(<TasksPage />);
    const text = (t: string) => within(screen.getByTestId("inbox-list")).getByText(t);
    const [first, second] = snap().inbox;
    swipe(text(first.text), 100, 200);
    await waitFor(() => expect(snap().inbox).toHaveLength(2));
    expect(create).toHaveBeenCalledWith({ title: first.text }, first.id);
    expect(useUiStore.getState().toast?.text).toBe("已进待办");
    swipe(text(second.text), 300, 200);
    const button = screen
      .getByTestId("inbox-list")
      .querySelector("[data-swipe-delete]") as HTMLElement;
    await userEvent.click(button);
    await waitFor(() => expect(snap().inbox).toHaveLength(1));
    expect(remove).toHaveBeenCalledWith(second.id);
  });
});

describe("English copy (i18n tasks.* / timeBar.*)", () => {
  // test-setup.ts switches back to zh-Hans after every test.
  beforeEach(() => setLang("en"));

  it("tasks page: header, tabs, todo tags, done section, card texts", () => {
    render(<TasksPage />);
    expect(screen.getByRole("region", { name: "Tasks" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Tasks" })).toBeTruthy();
    expect(screen.getByText("9 tasks")).toBeTruthy();
    expect(screen.getByText("1 overdue")).toBeTruthy();
    expect(screen.getByRole("button", { name: /New task/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /To Do\s*4/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Inbox\s*3/ })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Add to-do" }).length).toBeGreaterThan(0);

    const list = screen.getByTestId("todo-list");
    const row = (title: string) =>
      within(list).getByText(title).closest("[data-todo-id]") as HTMLElement;
    expect(row("回复房东关于续租的邮件").textContent).toContain("Today 18:00");
    expect(row("修复 orbit 托盘图标闪烁 bug").textContent).not.toContain("From yesterday");
    expect(screen.getByText("Done today 1")).toBeTruthy();
    expect(screen.getByText("Archived tomorrow morning")).toBeTruthy();

    const card = (title: string) => screen.getByRole("group", { name: title }) as HTMLElement;
    expect(cardWords(card("交报销单"))).toContain("Due 9/28 Mon · 2 days overdue");
    expect(within(card("交报销单")).getByRole("button", { name: "Overdue" })).toBeTruthy();
    expect(within(card("交报销单")).getByRole("button", { name: "Archive" })).toBeTruthy();
    expect(cardWords(card("课程作业"))).toContain("Today · Day 2 of 4 · 2 days left");
    expect(within(card("课程作业")).getByRole("button", { name: "Active" })).toBeTruthy();
    expect(cardWords(card("landing 文案"))).toContain("Starts 10/8 · 9 days");
    expect(cardWords(card("orbit 域名备案"))).toContain("Day 19");
    expect(cardWords(card("orbit 域名备案"))).toContain("4 / 7 done");
    expect(cardWords(card("注册美卡"))).toContain("3 / 5 done");
    expect(within(card("注册美卡")).getByRole("button", { name: "Add step" })).toBeTruthy();
    expect(within(card("注册美卡")).getByRole("button", { name: /Waiting/ })).toBeTruthy();
    expect(within(card("注册美卡")).queryByText("Now")).toBeNull();
    // Steps change only in the detail (features.cardStepActions off): no tick buttons on cards.
    expect(
      within(card("注册美卡")).queryByRole("button", { name: /^Check off |^Uncheck / }),
    ).toBeNull();
  });

  it("status menu lists the statuses in English", async () => {
    render(<TasksPage />);
    const card = screen.getByRole("group", { name: "课程作业" });
    await userEvent.click(within(card).getByRole("button", { name: /Active/ }));
    const menu = screen.getByRole("menu", { name: "Change status" });
    expect(
      within(menu)
        .getAllByRole("menuitemradio")
        .map((i) => i.textContent),
    ).toEqual(["Active", "Waiting", "Done"]);
  });

  it("inbox: input, triage buttons and tooltips, the swipe's delete button", async () => {
    useUiStore.setState({ leftTab: "inbox" });
    render(<TasksPage />);
    const input = screen.getByRole("textbox", { name: "Add to Inbox" });
    expect(input.getAttribute("placeholder")).toBe("Drop a thought here, press Return");
    const first = screen.getByTestId("inbox-list").querySelector("[data-inbox-id]") as HTMLElement;
    await userEvent.hover(first);
    expect(within(first).getByRole("button", { name: /Date/ }).getAttribute("title")).toBe(
      "Add to to-dos and show it on that day in the calendar",
    );
    expect(within(first).getByRole("button", { name: /Task/ })).toBeTruthy();
    // 今天 and 删掉 are the swipe, not buttons.
    expect(within(first).getAllByRole("button")).toHaveLength(2);
    swipe(first.querySelector("span") as HTMLElement, 300, 200);
    expect(screen.getByTestId("inbox-list").querySelector("[data-swipe-delete]")?.textContent).toBe(
      "Delete",
    );
  });

  it("empty states", () => {
    const empty = { ...snap(), tasks: [], todos: [], inbox: [] };
    useDataStore.setState({ snap: empty });
    const { unmount } = render(<TasksPage />);
    expect(screen.getByText("No tasks yet")).toBeTruthy();
    expect(screen.getByText("No to-dos yet")).toBeTruthy();
    unmount();
    useUiStore.setState({ leftTab: "inbox" });
    render(<TasksPage />);
    expect(screen.getByText("Inbox is empty")).toBeTruthy();
  });

  it("date picker: quick chips, title, time row, summary, buttons", async () => {
    expect(quickDates("2026-09-30").map((q) => q.label)).toEqual([
      "Today",
      "Tomorrow",
      "Fri",
      "Next Mon",
    ]);
    expect(quickDates("2026-10-03")[2].label).toBe("Next Fri");
    const todo = snap().todos.find((t) => t.title === "研究 Tauri 全局快捷键");
    if (!todo) throw new Error("seed todo missing");
    useUiStore.getState().openPopover({
      kind: "datePicker",
      purpose: "todoReminder",
      targetId: todo.id,
      anchor: { top: 100, left: 32, width: 300, height: 32 },
    });
    render(<PopoverHost />);
    const picker = screen.getByRole("dialog", { name: "Pick a date" });
    expect(picker.textContent).toContain("Remind me when?");
    expect(picker.textContent).toContain("Time (optional)");
    expect(picker.textContent).toContain("Pick a day");
    await userEvent.click(within(picker).getByRole("button", { name: "Tomorrow" }));
    expect(picker.textContent).toContain("Remind tomorrow");
    expect(within(picker).getByRole("switch", { name: "Set a time" })).toBeTruthy();
    expect(within(picker).getByRole("button", { name: "No reminder" })).toBeTruthy();
    expect(within(picker).getByRole("button", { name: "OK" })).toBeTruthy();
  });

  it("inline add: placeholder and the type badge", () => {
    const task = snap().tasks.find((t) => t.title === "课程作业");
    if (!task) throw new Error("seed task missing");
    render(<InlineAddKeyPoint taskId={task.id} onAdded={() => undefined} onClose={() => {}} />);
    const input = screen.getByRole("textbox", { name: "Add step" });
    expect(input.getAttribute("placeholder")).toBe("Add a step, press Return");
    fireEvent.change(input, { target: { value: "等助教回复选题" } });
    expect(screen.getByRole("button", { name: /Waiting on/ }).getAttribute("title")).toBe(
      "Click to change the type",
    );
    fireEvent.change(input, { target: { value: "10/1 查一遍参考文献格式" } });
    expect(screen.getByRole("button", { name: /Checkpoint · 10\/1/ })).toBeTruthy();
  });

  it("deleting a todo shows an English toast", async () => {
    render(
      <>
        <TasksPage />
        <ToastHost />
      </>,
    );
    const row = screen.getByTestId("todo-list").querySelector("[data-todo-id]") as HTMLElement;
    fireEvent.contextMenu(row, { clientX: 40, clientY: 40 });
    const menu = screen.getByRole("menu", { name: "To-do menu" });
    expect(within(menu).getByRole("menuitem", { name: "Remind" })).toBeTruthy();
    await userEvent.click(within(menu).getByRole("menuitem", { name: "Delete" }));
    await waitFor(() =>
      expect(toastEl().textContent).toContain("Deleted “回复房东关于续租的邮件”"),
    );
  });
});
