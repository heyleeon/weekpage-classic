import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ArchiveToolbarButton from "@/components/archive/ArchiveToolbarButton";
import { OverlayHost } from "@/components/shell/OverlayHost";
import { PopoverHost } from "@/components/shell/PopoverHost";
import { PEEK_DELAY_MS, PEEK_STEP_MS } from "@/components/ui/SwipeRow";
import { useDataStore } from "@/hooks/useDataStore";
import { useEscDispatcher } from "@/hooks/useEscLayer";
import { useUiStore } from "@/hooks/useUiStore";
import { setLang } from "@/i18n";
import fixture from "@/lib/__fixtures__/demo-snapshot.json";
import { shortestColumn } from "@/lib/board";
import { mockApi, resetMockBackend } from "@/lib/mockBackend";
import { isMac } from "@/lib/platform";
import { resolveStepInput } from "@/lib/stepInput";
import type { KeyPoint, Mutation, Snapshot } from "@/types/domain";
import { archiveTiles } from "./ArchiveConfirm";
import { historyText } from "./HistoryView";
import NewTaskPopover from "./NewTaskPopover";
import { findNewTaskButton } from "./openNewTask";
import { focusEnd, initialRange, pastPickable, pickDay, setNoDue } from "./rangePick";
import { kpHeadText } from "./TaskDetail";
import styles from "./TaskDetail.module.css";
import { canReorder, SWIPE_HINT_KEY, SWIPE_HINT_MS } from "./Timeline";
import { archivedToast } from "./taskActions";

const TODAY = "2026-09-30";
const FIXTURE = fixture as Snapshot;
const MEIKA = "01900000-0000-7000-8000-00000000012e";
const KP_WAIT = "01900000-0000-7000-8000-000000000195";
const KP_ACTIVATE = "01900000-0000-7000-8000-000000000196";
const KP_FIRST = "01900000-0000-7000-8000-000000000191";
const INBOX_EN = "01900000-0000-7000-8000-0000000000ca";
const ANCHOR = { top: 100, left: 100, width: 10, height: 10 };

const initialUi = useUiStore.getState();
const initialData = useDataStore.getState();

/** 注册美卡 in its completed state: 等审批 ✓ 9/30, 激活卡 ✓ 9/30, done 9/30. */
function meikaDone(): Snapshot {
  const s = structuredClone(FIXTURE);
  for (const k of s.keyPoints) {
    if (k.id === KP_WAIT || k.id === KP_ACTIVATE) {
      k.doneDate = TODAY;
      k.isCurrent = false;
    }
  }
  const t = s.tasks.find((x) => x.id === MEIKA);
  if (t) {
    t.status = "done";
    t.doneDate = TODAY;
    t.doneAt = Date.UTC(2026, 8, 30, 2);
  }
  return s;
}

async function boot(snap: Snapshot = FIXTURE) {
  resetMockBackend(snap);
  await act(async () => {
    await useDataStore.getState().refresh();
  });
}

function EscRoot() {
  useEscDispatcher();
  return null;
}

beforeEach(() => {
  useUiStore.setState({ ...initialUi, today: TODAY, page: "tasks" }, true);
  useDataStore.setState(initialData, true);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("range picking (ui-spec §11.3)", () => {
  it("opens on today → ?, picking the due date", () => {
    const r = initialRange(TODAY);
    expect(r).toMatchObject({ start: TODAY, end: null, picking: "end" });
  });

  it("10/5 then 10/9 → 10/5–10/9, 共 5 天", () => {
    let r = pickDay(initialRange(TODAY), "2026-10-05");
    expect(r).toMatchObject({ start: TODAY, end: "2026-10-05" });
    r = pickDay(r, "2026-10-09");
    expect(r).toMatchObject({ start: "2026-10-05", end: "2026-10-09", picking: null });
  });

  it("clicking on a finished range starts over: 10/12 becomes the start, due cleared", () => {
    let r = pickDay(pickDay(initialRange(TODAY), "2026-10-05"), "2026-10-09");
    r = pickDay(r, "2026-10-12");
    expect(r).toMatchObject({ start: "2026-10-12", end: null, picking: "end" });
  });

  it("an earlier day while picking the due date becomes the new start", () => {
    let r = focusEnd(pickDay(pickDay(initialRange(TODAY), "2026-10-05"), "2026-10-09"), "end");
    r = pickDay(r, "2026-10-02");
    expect(r).toMatchObject({ start: "2026-10-02", end: null, picking: "end" });
    r = focusEnd({ ...r, end: "2026-10-04" }, "start");
    r = pickDay(r, "2026-10-08");
    expect(r).toMatchObject({ start: "2026-10-08", end: null, picking: "end" });
  });

  it("不设截止: clicks only move the start", () => {
    let r = setNoDue(initialRange(TODAY), true);
    r = pickDay(r, "2026-10-05");
    r = pickDay(r, "2026-10-09");
    expect(r).toMatchObject({ start: "2026-10-09", end: null, noDue: true });
  });

  it("past days can be the start, never the due", () => {
    const opening = initialRange(TODAY);
    expect(pastPickable(opening, TODAY)).toBe(true);
    // A past click while picking the due lands on the start; the next click is the due.
    const pastStart = pickDay(opening, "2026-09-28");
    expect(pastStart).toMatchObject({ start: "2026-09-28", end: null, picking: "end" });
    expect(pastPickable(pastStart, TODAY)).toBe(false);
    expect(pastPickable(focusEnd(pastStart, "start"), TODAY)).toBe(true);
    expect(pastPickable(setNoDue(pastStart, true), TODAY)).toBe(true);
    // One click into the future, then a past one: the two clicks are the range.
    const provisional = pickDay(opening, "2026-10-09");
    expect(pastPickable(provisional, TODAY)).toBe(true);
    expect(pickDay(provisional, "2026-09-29")).toMatchObject({
      start: "2026-09-29",
      end: "2026-10-09",
    });
  });

  it("a past start (popover): past days grey out for the due, the start field brings them back", async () => {
    await boot();
    const create = vi.spyOn(mockApi, "createTask");
    render(<NewTaskPopover title="补见王老师" />);
    const day = (d: string) => screen.getByLabelText(d) as HTMLButtonElement;
    expect(day("2026-09-28").disabled).toBe(false);
    await userEvent.click(day("2026-09-28"));
    expect(screen.getByTestId("new-start").textContent).toBe("开始9/28");
    expect(day("2026-09-29").disabled).toBe(true);
    await userEvent.click(day("2026-10-02"));
    expect(screen.getByTestId("new-due").textContent).toBe("截止10/2");
    await userEvent.click(screen.getByTestId("new-start"));
    expect(day("2026-09-29").disabled).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "建好了" }));
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ startDate: "2026-09-28", dueDate: "2026-10-02" }),
    );
  });

  it("no due date (∞) hides the bell; the due chip brings the due back (popover)", async () => {
    await boot();
    render(<NewTaskPopover title="" />);
    expect(screen.getByTestId("new-due").getAttribute("aria-label")).toBe("截止: 不设截止");
    await userEvent.click(screen.getByLabelText("2026-10-05"));
    await userEvent.click(screen.getByLabelText("2026-10-09"));
    expect(screen.getByTestId("new-due").textContent).toBe("截止10/9");
    const bell = screen.getByRole("button", { name: "截止前一天提醒我（10/8）" });
    await userEvent.click(bell);
    expect(bell.getAttribute("aria-pressed")).toBe("true");
    await userEvent.click(screen.getByRole("button", { name: "不设截止" }));
    expect(screen.queryByRole("button", { name: /截止前一天提醒我/ })).toBeNull();
    await userEvent.click(screen.getByTestId("new-due"));
    await userEvent.click(screen.getByLabelText("2026-10-12"));
    expect(screen.getByTestId("new-due").textContent).toBe("截止10/12");
  });

  it("steps get a type in the popover too: picked by hand or by the classifier", async () => {
    await boot();
    const create = vi.spyOn(mockApi, "createTask");
    render(<NewTaskPopover title="补见王老师" />);
    const box = screen.getByLabelText("加关键点");
    await userEvent.type(box, "约时间");
    await userEvent.click(screen.getByTestId("addbar-kind"));
    // No notes when creating a task: just the three step types.
    expect(screen.getAllByRole("menuitemradio")).toHaveLength(3);
    await userEvent.click(screen.getByRole("menuitemradio", { name: /等别人/ }));
    await waitFor(() => expect(document.activeElement).toBe(box));
    await userEvent.keyboard("{Enter}");
    const row = screen.getByText("约时间").closest("li") as HTMLElement;
    expect(row.dataset.kind).toBe("wait");
    await userEvent.click(screen.getByRole("button", { name: "建好了" }));
    await waitFor(() => expect(create).toHaveBeenCalledOnce());
    expect(create.mock.calls[0][0].keyPoints).toMatchObject([{ kind: "wait", text: "约时间" }]);
  });
});

describe("变成任务 / 新建任务 (ui-spec §11)", () => {
  it("prefills the inbox text; KP input classifies 「10/7 让 Tom 看一遍」 as a checkpoint", async () => {
    await boot();
    render(<NewTaskPopover fromInboxId={INBOX_EN} title="orbit 官网要不要做英文版" />);
    const title = screen.getByLabelText("任务标题") as HTMLInputElement;
    expect(title.value).toBe("orbit 官网要不要做英文版");
    expect(document.activeElement).toBe(title);
    expect(title.selectionStart).toBe(title.value.length);
    expect(screen.getByRole("dialog", { name: "变成任务" })).toBeTruthy();
    await userEvent.type(screen.getByLabelText("加关键点"), "10/7 让 Tom 看一遍{Enter}");
    // The date leaves the text and sits at the row end.
    const row = screen.getByText("让 Tom 看一遍").closest("li") as HTMLElement;
    expect(row.dataset.kind).toBe("check");
    expect(row.textContent).toContain("10/7");
    await userEvent.click(within(row).getByRole("button", { name: /删掉/ }));
    expect(screen.queryByText("让 Tom 看一遍")).toBeNull();
  });

  it("turning into a task merges the inbox toast and uses shortestColumn", async () => {
    await boot();
    useUiStore.setState({ columnHeights: [500, 120, 300] });
    const expected = shortestColumn(useDataStore.getState().snap as Snapshot, [500, 120, 300]);
    expect(expected).toBe(1);
    const createTask = vi.spyOn(mockApi, "createTask");
    const realMutate = useDataStore.getState().mutate;
    const mutate = vi.fn((run: () => Promise<Mutation>, opts?: Parameters<typeof realMutate>[1]) =>
      realMutate(run, opts),
    );
    useDataStore.setState({ mutate });
    useUiStore.getState().openPopover({
      kind: "newTask",
      fromInboxId: INBOX_EN,
      title: "orbit 官网做英文版",
      anchor: ANCHOR,
    });
    render(<PopoverHost />);
    await userEvent.click(screen.getByLabelText("2026-10-05"));
    await userEvent.click(screen.getByLabelText("2026-10-09"));
    await userEvent.click(screen.getByRole("button", { name: "变成任务" }));
    await waitFor(() => expect(useUiStore.getState().popover).toBeNull());
    expect(mutate).toHaveBeenCalledOnce();
    const opts = mutate.mock.calls[0][1];
    expect(opts?.toast?.mergeKey).toBe("inbox");
    expect(createTask).toHaveBeenCalledOnce();
    const input = createTask.mock.calls[0][0];
    expect(input).toMatchObject({
      title: "orbit 官网做英文版",
      startDate: "2026-10-05",
      dueDate: "2026-10-09",
      column: expected,
      fromInboxId: INBOX_EN,
    });
    const snap = useDataStore.getState().snap as Snapshot;
    const created = snap.tasks.find((t) => t.title === "orbit 官网做英文版");
    expect(created?.boardColumn).toBe(1);
    expect(snap.inbox.some((i) => i.id === INBOX_EN)).toBe(false);
    expect(useUiStore.getState().highlight).toMatchObject({ id: created?.id, reason: "fromInbox" });
    expect(useUiStore.getState().toast?.text).toBe("已变成任务");
  });

  it("新建任务: a step typed but not Entered is still created with the task", async () => {
    await boot();
    const create = vi.spyOn(mockApi, "createTask");
    render(<NewTaskPopover title="补见王老师" />);
    await userEvent.type(screen.getByLabelText("加关键点"), "带上材料 10/9");
    await userEvent.click(screen.getByRole("button", { name: "建好了" }));
    await waitFor(() => expect(create).toHaveBeenCalledOnce());
    expect(create.mock.calls[0][0].keyPoints).toMatchObject([
      { text: "带上材料", date: "2026-10-09" },
    ]);
  });

  it("新建任务: without a title the main button points at the title; mod+Enter submits", async () => {
    await boot();
    const create = vi.spyOn(mockApi, "createTask");
    useUiStore.getState().openPopover({ kind: "newTask", title: "", anchor: ANCHOR });
    render(<PopoverHost />);
    expect(screen.getByRole("dialog", { name: "新建任务" })).toBeTruthy();
    const main = screen.getByRole("button", { name: "建好了" }) as HTMLButtonElement;
    const title = screen.getByLabelText("任务标题");
    expect(main.getAttribute("aria-disabled")).toBe("true");
    // Pressing it anyway: nothing is created, the title shakes and takes the focus.
    await userEvent.click(main);
    expect(create).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(title);
    expect(title.className).toMatch(/attention/);
    await userEvent.type(title, "整理书架");
    expect(main.getAttribute("aria-disabled")).toBe("false");
    fireEvent.keyDown(title, { key: "Enter", metaKey: isMac(), ctrlKey: !isMac() });
    await waitFor(() => expect(useUiStore.getState().popover).toBeNull());
    const snap = useDataStore.getState().snap as Snapshot;
    const t = snap.tasks.find((x) => x.title === "整理书架");
    expect(t).toMatchObject({ startDate: TODAY, dueDate: null });
    expect(useUiStore.getState().toast?.mergeKey).toBeUndefined();
    expect(useUiStore.getState().highlight).toMatchObject({ id: t?.id, reason: "new" });
  });

  it("mod+N on the task / archive page opens 新建任务 (dispatchEvent)", async () => {
    await boot();
    render(
      <>
        <ArchiveToolbarButton />
        <PopoverHost />
      </>,
    );
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "n",
          code: "KeyN",
          metaKey: isMac(),
          ctrlKey: !isMac(),
          bubbles: true,
        }),
      );
    });
    expect(useUiStore.getState().popover).toMatchObject({ kind: "newTask", title: "" });
    expect(screen.getByRole("dialog", { name: "新建任务" })).toBeTruthy();
  });
});

describe("TaskDetail (ui-spec §10)", () => {
  function openDetail(focusKeyPointId?: string) {
    useUiStore.getState().openOverlay({ kind: "taskDetail", taskId: MEIKA, focusKeyPointId });
    return render(
      <>
        <EscRoot />
        <OverlayHost />
      </>,
    );
  }

  it("shows the time block, counts without notes; done rows grey, no current row", async () => {
    await boot();
    openDetail();
    const dialog = screen.getByRole("dialog");
    const text = dialog.textContent ?? "";
    expect(text).toContain("今天 · 第 11 / 42 天");
    expect(text).toContain("还剩 31 天");
    expect(text).toContain("关键点5 个 · 已完成 3");
    expect(text).not.toContain("随时可以加");
    expect(text).not.toContain("滚动查看更多");
    // The reminder is a bell button now (no sentence): its name carries the date.
    expect(screen.getByRole("button", { name: "截止前一天提醒我（10/30）" })).toBeTruthy();
    expect(text).not.toContain("不设截止");
    // 2026-10-02: no 「current」 row any more (no tint, no data-current, no 当前).
    expect(dialog.querySelector("[data-current]")).toBeNull();
    const wait = dialog.querySelector(`[data-kp-id="${KP_WAIT}"]`) as HTMLElement;
    // One line: date, text, then the type chip.
    expect(wait.textContent).toBe("10/1等审批 · 10/1 查等别人");
    expect(wait.dataset.late).toBeUndefined();
    expect(within(wait).getByText("等审批 · 10/1 查").className).not.toContain(
      styles.entryTextDone,
    );
    const first = dialog.querySelector(`[data-kp-id="${KP_FIRST}"]`) as HTMLElement;
    expect(within(first).getByText("查资料选卡").className).toContain(styles.entryTextDone);
    expect(text).not.toContain("当前");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useUiStore.getState().overlay).toBeNull();
  });

  it("AddBar: 「等管局回复 10/9」 switches to 等别人 + 10/9, previews the cut text; Enter adds it", async () => {
    await boot();
    const add = vi.spyOn(mockApi, "addKeyPoint");
    openDetail();
    const input = screen.getByLabelText("加一个关键点") as HTMLInputElement;
    expect(screen.queryByTestId("step-preview")).toBeNull();
    await userEvent.type(input, "等管局回复 10/9");
    expect(screen.getByTestId("addbar-kind").getAttribute("title")).toBe("等别人");
    expect(screen.getByTestId("addbar-date").textContent).toBe("10/9");
    // Like the calendar input: 「↳ 10/9 周五 等管局回复」 inside the box.
    expect(screen.getByTestId("step-preview").textContent).toBe("↳ 10/9 周五 等管局回复");
    await userEvent.type(input, "{Enter}");
    await waitFor(() => expect(input.value).toBe(""));
    expect(add).toHaveBeenCalledWith(MEIKA, {
      kind: "wait",
      text: "等管局回复",
      date: "2026-10-09",
      who: null,
    });
    expect(screen.getByText("等管局回复")).toBeTruthy();
    expect(screen.getByRole("dialog").textContent).toContain("6 个 · 已完成 3");
    expect(screen.getByTestId("addbar-date").textContent).toBe("");
    expect(screen.queryByTestId("step-preview")).toBeNull();
  });

  it("AddBar: 「12.2」 and 「下周五」 are dates too; a lone date waits for words", async () => {
    await boot();
    const add = vi.spyOn(mockApi, "addKeyPoint");
    openDetail();
    const input = screen.getByLabelText("加一个关键点") as HTMLInputElement;
    await userEvent.type(input, "12.2");
    expect(screen.getByTestId("step-preview").textContent).toBe("↳ 12/2 周三 还差内容");
    await userEvent.type(input, "{Enter}");
    expect(add).not.toHaveBeenCalled();
    expect(input.value).toBe("12.2");
    await userEvent.type(input, " cdn 证书过期，记得续签{Enter}");
    await waitFor(() => expect(add).toHaveBeenCalledOnce());
    expect(add.mock.calls[0][1]).toMatchObject({
      kind: "do",
      text: "cdn 证书过期，记得续签",
      date: "2026-12-02",
    });
    await waitFor(() => expect(input.value).toBe(""));
    await userEvent.type(input, "下周五 交材料");
    expect(screen.getByTestId("step-preview").textContent).toBe("↳ 10/9 周五 交材料");
  });

  it("AddBar: a date cleared by hand keeps the text as typed (no preview)", async () => {
    await boot();
    const add = vi.spyOn(mockApi, "addKeyPoint");
    openDetail();
    const input = screen.getByLabelText("加一个关键点") as HTMLInputElement;
    await userEvent.type(input, "升级 Python 3.12");
    expect(screen.getByTestId("step-preview").textContent).toBe("↳ 3/12 周五 升级 Python");
    await userEvent.click(screen.getByRole("button", { name: "清掉日期" }));
    expect(screen.queryByTestId("step-preview")).toBeNull();
    await userEvent.type(input, "{Enter}");
    await waitFor(() => expect(add).toHaveBeenCalledOnce());
    expect(add.mock.calls[0][1]).toMatchObject({ text: "升级 Python 3.12", date: null });
  });

  it("AddBar: after picking a type by hand the caret is back in the box, so Enter adds", async () => {
    await boot();
    const add = vi.spyOn(mockApi, "addKeyPoint");
    openDetail();
    const input = screen.getByLabelText("加一个关键点") as HTMLInputElement;
    await userEvent.type(input, "撤地方");
    await userEvent.click(screen.getByTestId("addbar-kind"));
    await userEvent.click(screen.getByRole("menuitemradio", { name: /检查点/ }));
    await waitFor(() => expect(document.activeElement).toBe(input));
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(add).toHaveBeenCalledOnce());
    expect(add.mock.calls[0][1]).toMatchObject({ kind: "check", text: "撤地方" });
  });

  it("AddBar: the round add button shows with text and adds the step", async () => {
    await boot();
    const add = vi.spyOn(mockApi, "addKeyPoint");
    openDetail();
    expect(screen.queryByRole("button", { name: "添加" })).toBeNull();
    await userEvent.type(screen.getByLabelText("加一个关键点"), "找同事过一遍");
    await userEvent.click(screen.getByRole("button", { name: "添加" }));
    await waitFor(() => expect(add).toHaveBeenCalledOnce());
    expect(screen.queryByRole("button", { name: "添加" })).toBeNull();
  });

  it("a step added past the due date offers to move the due date there, once", async () => {
    await boot();
    const setDates = vi.spyOn(mockApi, "setTaskDates");
    openDetail();
    expect(screen.queryByRole("button", { name: /^截止改到/ })).toBeNull();
    const input = screen.getByLabelText("加一个关键点") as HTMLInputElement;
    await userEvent.type(input, "11/5 回看一眼{Enter}");
    const yes = await screen.findByRole("button", { name: "截止改到 11/5？" });
    // The track stretches: a dashed tail after the due dot.
    expect(screen.getByTestId("detail-track").className).toContain(styles.trackStretched);
    await userEvent.click(yes);
    await waitFor(() => expect(setDates).toHaveBeenCalledWith(MEIKA, "2026-09-20", "2026-11-05"));
    expect(screen.queryByRole("button", { name: "截止改到 11/5？" })).toBeNull();
  });

  it("the due-date offer can be waved off; reopening the task doesn't bring it back", async () => {
    await boot();
    const { unmount } = openDetail();
    await userEvent.type(screen.getByLabelText("加一个关键点"), "11/5 回看一眼{Enter}");
    await screen.findByRole("button", { name: "截止改到 11/5？" });
    await userEvent.click(screen.getByRole("button", { name: "不改截止" }));
    expect(screen.queryByRole("button", { name: /^截止改到/ })).toBeNull();
    unmount();
    openDetail();
    expect(screen.queryByRole("button", { name: "截止改到 11/5？" })).toBeNull();
  });

  it("a manual type sticks; 「记一笔」 adds a note that is not counted", async () => {
    expect(resolveStepInput("等管局回复 10/9", TODAY, "check", undefined)).toEqual({
      kind: "check",
      date: "2026-10-09",
      text: "等管局回复",
      cut: true,
    });
    expect(resolveStepInput("对方回信了", TODAY, "note", undefined)).toEqual({
      kind: "note",
      date: TODAY,
      text: "对方回信了",
      cut: false,
    });
    await boot();
    openDetail();
    await userEvent.click(screen.getByTestId("addbar-kind"));
    await userEvent.click(screen.getByRole("menuitemradio", { name: /记一笔/ }));
    const input = screen.getByLabelText("加一个关键点");
    await userEvent.type(input, "等对方电话确认{Enter}");
    await waitFor(() => expect(screen.getByText("等对方电话确认")).toBeTruthy());
    const snap = useDataStore.getState().snap as Snapshot;
    const note = snap.keyPoints.find((k) => k.text === "等对方电话确认");
    expect(note).toMatchObject({ kind: "note", who: "them", date: TODAY });
    expect(screen.getByRole("dialog").textContent).toContain("5 个 · 已完成 3");
    expect(kpHeadText(snap.keyPoints.filter((k) => k.taskId === MEIKA))).toBe("5 个 · 已完成 3");
    // §10.9: no key points → just the 「关键点」 title.
    expect(kpHeadText([])).toBe("");
  });

  it("status dropdown has three items; choosing 已完成 shows the solid 归档 button", async () => {
    await boot();
    openDetail();
    await userEvent.click(screen.getByRole("button", { name: /等待中/ }));
    const items = screen.getAllByRole("menuitemradio");
    expect(items.map((i) => i.textContent)).toEqual(["推进中", "等待中", "已完成"]);
    await userEvent.click(items[2]);
    await waitFor(() => expect(screen.getByRole("button", { name: "归档" })).toBeTruthy());
    expect(screen.getByRole("button", { name: /已完成/ })).toBeTruthy();
  });

  it("history lines follow ui-spec §10.7", () => {
    const ev = (type: string, payload: object) => ({
      id: "e",
      taskId: MEIKA,
      type: type as never,
      payload: JSON.stringify(payload),
      at: 0,
    });
    expect(historyText(ev("status", { from: "waiting", to: "done" }))).toBe("状态 等待中 → 已完成");
    expect(historyText(ev("kp_done", { text: "提交申请" }))).toBe("勾掉「提交申请」");
    expect(
      historyText(
        ev("dates", {
          from: { startDate: "2026-09-20", dueDate: "2026-10-24" },
          to: { startDate: "2026-09-20", dueDate: "2026-10-31" },
        }),
      ),
    ).toBe("截止 10/24 → 10/31");
    expect(historyText(ev("note_added", { text: "邮件：申请已收到", who: "them" }))).toBe(
      "记一笔（对方）：邮件：申请已收到",
    );
    expect(historyText(ev("created", { fromInbox: true }))).toBe("从收件箱变成任务");
  });
});

describe("timeline gestures (ui-spec §10.14)", () => {
  function openDetail() {
    useUiStore.getState().openOverlay({ kind: "taskDetail", taskId: MEIKA });
    return render(
      <>
        <EscRoot />
        <OverlayHost />
      </>,
    );
  }
  const row = (id: string) =>
    screen.getByRole("dialog").querySelector(`[data-kp-id="${id}"]`) as HTMLElement;
  /** Pointer drag on the row text from x0 to x1 (one move, then release). */
  function drag(id: string, x0: number, x1: number) {
    const text = within(row(id)).getByText(/激活卡/);
    const at = (x: number) => ({
      pointerId: 1,
      isPrimary: true,
      button: 0,
      clientX: x,
      clientY: 100,
    });
    fireEvent.pointerDown(text, at(x0));
    fireEvent.pointerMove(window, at(x1));
    fireEvent.pointerUp(window, at(x1));
  }

  it("key points without a date can be dragged, done or not: grab cursor, no grip, no hint text", async () => {
    const kp = (id: string) => FIXTURE.keyPoints.find((k) => k.id === id) as KeyPoint;
    expect(canReorder(kp(KP_ACTIVATE))).toBe(true);
    expect(canReorder(kp(KP_WAIT))).toBe(false);
    await boot();
    openDetail();
    const draggable = screen
      .getByRole("dialog")
      .querySelectorAll<HTMLElement>(`.${styles.entryDraggable}`);
    // The three done steps have no date of their own: they move too (the note follows its date).
    expect([...draggable].map((li) => li.dataset.kpId?.slice(-3))).toEqual([
      "191",
      "192",
      "193",
      "196",
    ]);
    expect(screen.queryByTitle("拖动调整顺序")).toBeNull();
    const text = screen.getByRole("dialog").textContent ?? "";
    expect(text).not.toContain("右滑完成");
    // No hover buttons on the rows: 设为当前, the calendar icon and the trash are gone.
    expect(text).not.toContain("设为当前");
    expect(within(row(KP_ACTIVATE)).queryByRole("button", { name: "删除" })).toBeNull();
    const buttons = within(row(KP_ACTIVATE)).getAllByRole("button");
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual([
      "设日期",
      "勾掉 激活卡",
      "类型：我来做，点一下改",
    ]);
  });

  it("dragging like a calendar item: 4px lifts it, the row turns into 放到这里 (no extra row), moving away closes it, the drop moves it", async () => {
    await boot();
    const move = vi.spyOn(mockApi, "moveKeyPoint");
    openDetail();
    const text = within(row(KP_ACTIVATE)).getByText("激活卡");
    const at = (y: number) => ({
      pointerId: 1,
      isPrimary: true,
      button: 0,
      clientX: 100,
      clientY: y,
    });
    const rows = () => screen.getByRole("dialog").querySelectorAll("ol > li").length;
    const before = rows();
    fireEvent.pointerDown(text, at(100));
    // jsdom lays nothing out (every midpoint is 0): a pointer below 0 lands after every row (where
    // 激活卡, the last row, already is), one above 0 before every row.
    fireEvent.pointerMove(document, at(97));
    expect(screen.queryByText("放到这里")).toBeNull();
    // The move that passes 4px lifts the row; the next ones move it (dnd-kit). In place, the held
    // row itself is the slot: no row is added, so the list (and the centred detail) keeps its
    // height.
    fireEvent.pointerMove(document, at(95));
    expect(screen.getAllByText("放到这里")).toHaveLength(1);
    expect(row(KP_ACTIVATE).textContent).toBe("放到这里");
    expect(row(KP_ACTIVATE).className).toContain(styles.dropSlot);
    expect(rows()).toBe(before);
    // Moved elsewhere: the slot shows there and the held row's place closes.
    fireEvent.pointerMove(document, at(-40));
    expect(screen.getAllByText("放到这里")).toHaveLength(1);
    expect(row(KP_ACTIVATE).className).toContain(styles.heldAway);
    expect(rows()).toBe(before + 1);
    expect(document.documentElement.dataset.stepCursor).toBe("grabbing");
    fireEvent.pointerUp(document, at(-40));
    await waitFor(() => expect(move).toHaveBeenCalledWith(KP_ACTIVATE, null, KP_FIRST));
    expect(screen.queryByText("放到这里")).toBeNull();
    expect(document.documentElement.dataset.stepCursor).toBeUndefined();
    // dnd-kit swallows clicks for 50ms after a drop; let that pass before the next test clicks.
    await act(() => new Promise<void>((r) => window.setTimeout(r, 60)));
  });

  it("the type chip: 我来做 stays quiet until hover; its menu changes the type", async () => {
    await boot();
    const update = vi.spyOn(mockApi, "updateKeyPoint");
    openDetail();
    const chip = within(row(KP_ACTIVATE)).getByRole("button", { name: "类型：我来做，点一下改" });
    expect(chip.className).toContain(styles.kindQuiet);
    const waitChip = within(row(KP_WAIT)).getByRole("button", { name: "类型：等别人，点一下改" });
    expect(waitChip.className).not.toContain(styles.kindQuiet);
    await userEvent.click(chip);
    expect(chip.className).toContain(styles.kindOpen);
    expect(screen.getAllByRole("menuitemradio").map((i) => i.textContent)).toEqual([
      "我来做",
      "等别人",
      "检查点",
    ]);
    await userEvent.click(screen.getByRole("menuitemradio", { name: /检查点/ }));
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(KP_ACTIVATE, {
        kind: "check",
        text: "激活卡",
        date: null,
        who: null,
      }),
    );
    expect(screen.queryByRole("menuitemradio")).toBeNull();
  });

  it("a swipe to the right past the threshold ticks the key point; a short one does nothing", async () => {
    await boot();
    const done = vi.spyOn(mockApi, "setKeyPointDone");
    openDetail();
    drag(KP_ACTIVATE, 100, 140);
    expect(done).not.toHaveBeenCalled();
    drag(KP_ACTIVATE, 100, 200);
    await waitFor(() => expect(done).toHaveBeenCalledWith(KP_ACTIVATE, true));
  });

  it("a swipe to the left opens 删除; Esc closes it; the button deletes with an undo toast", async () => {
    await boot();
    openDetail();
    drag(KP_ACTIVATE, 300, 200);
    const button = () => row(KP_ACTIVATE).querySelector("[data-swipe-delete]") as HTMLElement;
    expect(button().textContent).toBe("删除");
    fireEvent.keyDown(window, { key: "Escape" });
    // Esc closed the row, not the detail.
    expect(useUiStore.getState().overlay).not.toBeNull();
    drag(KP_ACTIVATE, 300, 200);
    await userEvent.click(button());
    await waitFor(() =>
      expect(useDataStore.getState().snap?.keyPoints.some((k) => k.id === KP_ACTIVATE)).toBe(false),
    );
    expect(useUiStore.getState().toast?.text).toBe("已删除「激活卡」");
  });

  it("a two-finger trackpad swipe to the left opens 删除 once the gesture goes quiet", async () => {
    await boot();
    openDetail();
    const root = row(KP_ACTIVATE).firstElementChild as HTMLElement;
    for (let i = 0; i < 5; i++) fireEvent.wheel(root, { deltaX: 20, deltaY: 0 });
    await waitFor(() =>
      expect(row(KP_ACTIVATE).querySelector("[data-swipe-delete]")?.getAttribute("tabindex")).toBe(
        "0",
      ),
    );
  });

  it("Delete / Backspace on a focused row opens 删除 and focuses it; Esc closes, Enter deletes", async () => {
    await boot();
    openDetail();
    const marker = within(row(KP_ACTIVATE)).getByRole("button", { name: "勾掉 激活卡" });
    marker.focus();
    fireEvent.keyDown(marker, { key: "Delete" });
    const button = row(KP_ACTIVATE).querySelector("[data-swipe-delete]") as HTMLElement;
    expect(button).not.toBeNull();
    expect(document.activeElement).toBe(button);
    expect(within(row(KP_ACTIVATE)).getByRole("button", { name: "删除" })).toBe(button);
    fireEvent.keyDown(window, { key: "Escape" });
    // Esc closed the row (focus back on the marker), not the detail.
    expect(useUiStore.getState().overlay).not.toBeNull();
    expect(document.activeElement).toBe(marker);
    fireEvent.keyDown(marker, { key: "Backspace" });
    expect(document.activeElement?.hasAttribute("data-swipe-delete")).toBe(true);
    await userEvent.keyboard("{Enter}");
    await waitFor(() =>
      expect(useDataStore.getState().snap?.keyPoints.some((k) => k.id === KP_ACTIVATE)).toBe(false),
    );
    expect(useUiStore.getState().toast?.text).toBe("已删除「激活卡」");
  });

  it("Backspace while editing the text stays in the input", async () => {
    await boot();
    openDetail();
    await userEvent.dblClick(within(row(KP_ACTIVATE)).getByText("激活卡"));
    const input = screen.getByLabelText("改关键点") as HTMLInputElement;
    await userEvent.type(input, "{Backspace}");
    expect(input.value).toBe("激活");
    expect(row(KP_ACTIVATE).querySelector("[data-swipe-delete]")).toBeNull();
  });
});

describe("timeline date cell (ui-spec §10.2)", () => {
  function openDetail(readOnly = false) {
    useUiStore.getState().openOverlay({ kind: "taskDetail", taskId: MEIKA, readOnly });
    return render(
      <>
        <EscRoot />
        <OverlayHost />
      </>,
    );
  }
  const row = (id: string) =>
    screen.getByRole("dialog").querySelector(`[data-kp-id="${id}"]`) as HTMLElement;

  it("a dated row: the date opens the calendar; picking a day or 清掉日期 saves", async () => {
    await boot();
    const update = vi.spyOn(mockApi, "updateKeyPoint");
    openDetail();
    const cell = within(row(KP_WAIT)).getByRole("button", { name: "改日期（现在是 10/1）" });
    expect(cell.textContent).toBe("10/1");
    await userEvent.click(cell);
    expect(cell.getAttribute("aria-expanded")).toBe("true");
    await userEvent.click(screen.getByLabelText("2026-10-05"));
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(KP_WAIT, {
        kind: "wait",
        text: "等审批 · 10/1 查",
        date: "2026-10-05",
        who: null,
      }),
    );
    expect(screen.queryByLabelText("2026-10-05")).toBeNull();
    const moved = within(row(KP_WAIT)).getByRole("button", { name: "改日期（现在是 10/5）" });
    await userEvent.click(moved);
    await userEvent.click(screen.getByRole("button", { name: "清掉日期" }));
    await waitFor(() =>
      expect(update).toHaveBeenLastCalledWith(KP_WAIT, expect.objectContaining({ date: null })),
    );
  });

  it("an undated row shows only a faint 设日期 (no 清掉日期); done rows too; a note keeps its date", async () => {
    await boot();
    const update = vi.spyOn(mockApi, "updateKeyPoint");
    openDetail();
    const cell = within(row(KP_ACTIVATE)).getByRole("button", { name: "设日期" });
    expect(cell.querySelector(`.${styles.datePlaceholder}`)?.textContent).toBe("设日期");
    await userEvent.click(cell);
    expect(screen.queryByRole("button", { name: "清掉日期" })).toBeNull();
    await userEvent.click(screen.getByLabelText("2026-10-12"));
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(
        KP_ACTIVATE,
        expect.objectContaining({ date: "2026-10-12" }),
      ),
    );
    // A done row without a date of its own shows no done date (2026-10-02): an empty 设日期 like
    // any undated row. A note shows its own date, which it always keeps (no 清掉日期).
    const snap = useDataStore.getState().snap as Snapshot;
    const doneRow = snap.keyPoints.find((k) => k.taskId === MEIKA && k.doneDate && !k.date);
    const note = snap.keyPoints.find((k) => k.taskId === MEIKA && k.kind === "note");
    if (!doneRow || !note) throw new Error("fixture");
    const doneCell = within(row(doneRow.id)).getAllByRole("button")[0];
    expect(doneCell.getAttribute("aria-label")).toBe("设日期");
    expect(doneCell.textContent).toBe("设日期");
    const noteCell = within(row(note.id)).getAllByRole("button")[0];
    expect(noteCell.hasAttribute("data-date-cell")).toBe(true);
    expect(noteCell.textContent).toBe("9/25");
    await userEvent.click(noteCell);
    expect(screen.getByLabelText("2026-10-05")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "清掉日期" })).toBeNull();
  });

  it("read-only: the date is plain text", async () => {
    await boot();
    openDetail(true);
    expect(row(KP_WAIT).querySelector("[data-date-cell]")).toBeNull();
    expect(row(KP_WAIT).textContent).toContain("10/1");
  });
});

describe("overdue steps and the swipe peek (ui-spec §9.3, §10.14)", () => {
  function openDetail(readOnly = false) {
    useUiStore.getState().openOverlay({ kind: "taskDetail", taskId: MEIKA, readOnly });
    return render(
      <>
        <EscRoot />
        <OverlayHost />
      </>,
    );
  }
  const swipeRoot = (id: string) =>
    screen.getByRole("dialog").querySelector(`[data-kp-id="${id}"] > div`) as HTMLElement;
  const wait = (ms: number) => act(() => new Promise<void>((r) => window.setTimeout(r, ms)));

  it("no current row: a stored isCurrent is ignored and nothing says 当前", async () => {
    const s = structuredClone(FIXTURE);
    for (const k of s.keyPoints) if (k.id === KP_ACTIVATE) k.isCurrent = true;
    await boot(s);
    openDetail();
    expect(screen.getByRole("dialog").querySelector("[data-current]")).toBeNull();
    expect(screen.queryByText("设为当前")).toBeNull();
    expect(screen.queryByText("当前")).toBeNull();
  });

  it("an open step past its date: red date, 「!」 marker, 「逾期 N 天」, red track dot; ticking clears it", async () => {
    useUiStore.setState({ today: "2026-10-03" });
    await boot();
    openDetail();
    const late = screen
      .getByRole("dialog")
      .querySelector(`[data-kp-id="${KP_WAIT}"]`) as HTMLElement;
    expect(late.dataset.late).toBe("true");
    expect(late.textContent).toContain("逾期 2 天");
    expect(within(late).getByRole("button", { name: /^改日期/ }).className).toContain(
      styles.entryDateLate,
    );
    // The type chip of an overdue row steps back (shown on hover), 逾期 N 天 takes its place.
    expect(within(late).getByText("等别人").className).toContain(styles.kindQuiet);
    expect(screen.getByTestId("detail-track").querySelector(`.${styles.dotWrap}`)).not.toBeNull();
    // Undated steps are never overdue.
    expect(
      (screen.getByRole("dialog").querySelector(`[data-kp-id="${KP_ACTIVATE}"]`) as HTMLElement)
        .dataset.late,
    ).toBeUndefined();
    await userEvent.click(within(late).getByRole("button", { name: "勾掉 等审批 · 10/1 查" }));
    await waitFor(() =>
      expect(
        (screen.getByRole("dialog").querySelector(`[data-kp-id="${KP_WAIT}"]`) as HTMLElement)
          .dataset.late,
      ).toBeUndefined(),
    );
    expect(screen.queryByText("逾期 2 天")).toBeNull();
  });

  it("the first opens peek at the first open row (left, then right) and count it", async () => {
    await boot();
    const setCache = vi.spyOn(mockApi, "setCache");
    openDetail();
    await waitFor(() => expect(setCache).toHaveBeenCalledWith(SWIPE_HINT_KEY, "1"));
    // ~450ms later the surface slides left: 删除 shows underneath.
    await waitFor(() => expect(swipeRoot(KP_WAIT).dataset.swiped).toBe("true"));
    expect(swipeRoot(KP_WAIT).querySelector("[data-swipe-delete]")).not.toBeNull();
    // …then right (the tick), and back to rest.
    await waitFor(() => expect(swipeRoot(KP_WAIT).textContent).toContain("完成"), {
      timeout: 1500,
    });
    await waitFor(() => expect(swipeRoot(KP_WAIT).dataset.swiped).toBeUndefined(), {
      timeout: 1500,
    });
    expect(swipeRoot(KP_ACTIVATE).dataset.swiped).toBeUndefined();
    // Once per detail: back from the history view (the timeline mounts again), no second peek.
    await wait(SWIPE_HINT_MS - PEEK_DELAY_MS - 4 * PEEK_STEP_MS + 50);
    await userEvent.click(screen.getByRole("button", { name: "更多" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "查看历史" }));
    await userEvent.click(await screen.findByRole("button", { name: "返回" }));
    await wait(PEEK_DELAY_MS + PEEK_STEP_MS);
    expect(swipeRoot(KP_WAIT).dataset.swiped).toBeUndefined();
    expect(setCache).toHaveBeenCalledTimes(1);
  });

  it("no peek (and no count) once it was shown twice, nor read-only", async () => {
    await boot();
    await mockApi.setCache(SWIPE_HINT_KEY, "2");
    const setCache = vi.spyOn(mockApi, "setCache");
    const { unmount } = openDetail();
    await wait(700);
    expect(setCache).not.toHaveBeenCalled();
    expect(swipeRoot(KP_WAIT).dataset.swiped).toBeUndefined();
    unmount();
    useUiStore.setState({ overlay: null });

    await mockApi.setCache(SWIPE_HINT_KEY, "0");
    setCache.mockClear();
    openDetail(true);
    await wait(700);
    expect(setCache).not.toHaveBeenCalled();
    expect(swipeRoot(KP_WAIT).dataset.swiped).toBeUndefined();
  });
});

describe("ArchiveConfirm (ui-spec §13)", () => {
  it("注册美卡 completed: 11 天 / 5 个 / 6 天 / 提前 31 天", () => {
    const s = meikaDone();
    const task = s.tasks.find((t) => t.id === MEIKA);
    if (!task) throw new Error("fixture");
    expect(archiveTiles(task, s.keyPoints, TODAY).map((t) => `${t.value}|${t.label}`)).toEqual([
      "11 天|用时",
      "5 个|关键点",
      "6 天|等别人",
      "提前 31 天|比截止",
    ]);
  });

  it("no due → no 比截止 tile; overdue unfinished → the §13.4 tiles", () => {
    const s = structuredClone(FIXTURE);
    const soft = s.tasks.find((t) => t.title === "orbit 软件著作权登记");
    const late = s.tasks.find((t) => t.title === "交报销单");
    if (!soft || !late) throw new Error("fixture");
    expect(archiveTiles(soft, s.keyPoints, TODAY).map((t) => t.label)).toEqual([
      "用时",
      "关键点",
      "等别人",
    ]);
    expect(archiveTiles(late, s.keyPoints, TODAY).map((t) => `${t.value}|${t.label}`)).toEqual([
      "7 天|已进行",
      "0 / 0|关键点",
      "2 天|已过",
    ]);
  });

  it("auto focuses the summary; Enter archives with an undo toast", async () => {
    await boot(meikaDone());
    const archive = vi.spyOn(mockApi, "archiveTask");
    useUiStore.getState().openOverlay({ kind: "archiveConfirm", taskId: MEIKA });
    render(
      <>
        <EscRoot />
        <OverlayHost />
      </>,
    );
    const tiles = screen.getByTestId("archive-tiles").textContent;
    expect(tiles).toBe("11 天用时5 个关键点6 天等别人提前 31 天比截止");
    const input = screen.getByPlaceholderText("一句话，比如：下次直接用 ITIN 申请");
    expect(document.activeElement).toBe(input);
    await userEvent.type(input, "下次直接用 ITIN 申请{Enter}");
    await waitFor(() => expect(archive).toHaveBeenCalledWith(MEIKA, "下次直接用 ITIN 申请"));
    await waitFor(() => expect(useUiStore.getState().toast?.text).toBe("已归档「注册美卡」"));
    expect(useUiStore.getState().overlay).toBeNull();
  });
});

describe("English (i18n)", () => {
  const ev = (type: string, payload: object) => ({
    id: "e",
    taskId: MEIKA,
    type: type as never,
    payload: JSON.stringify(payload),
    at: 0,
  });

  function renderOverlay() {
    return render(
      <>
        <EscRoot />
        <OverlayHost />
      </>,
    );
  }

  it("findNewTaskButton falls back to the header label in the active language", () => {
    const root = document.createElement("div");
    root.innerHTML = '<button type="button">＋ 新任务</button>';
    expect(findNewTaskButton(root)?.textContent).toBe("＋ 新任务");
    setLang("en");
    expect(findNewTaskButton(root)).toBeNull();
    root.innerHTML = '<button type="button">+ New task</button>';
    expect(findNewTaskButton(root)?.textContent).toBe("+ New task");
  });

  it("findNewTaskButton skips a tasks page parked off-screen (inert): mod+N on the archive page", () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<div inert><button type="button" data-new-task-button>＋ 新任务</button></div>' +
      '<div inert><button type="button">＋ 新任务</button></div>';
    expect(findNewTaskButton(root)).toBeNull();
    root.insertAdjacentHTML(
      "beforeend",
      '<button type="button" data-new-task-button>live</button>',
    );
    expect(findNewTaskButton(root)?.textContent).toBe("live");
  });

  it("text helpers follow the active language", () => {
    setLang("en");
    expect(kpHeadText([])).toBe("");
    expect(kpHeadText(FIXTURE.keyPoints.filter((k) => k.taskId === MEIKA))).toBe("5 · 3 done");
    expect(archivedToast("Renew passport").text).toBe("Archived “Renew passport”");
    expect(historyText(ev("status", { from: "waiting", to: "done" }))).toBe(
      "Status Waiting → Done",
    );
    expect(historyText(ev("kp_done", { text: "Submit" }))).toBe("Checked off “Submit”");
    expect(
      historyText(
        ev("dates", {
          from: { startDate: "2026-09-20", dueDate: null },
          to: { startDate: "2026-09-21", dueDate: "2026-10-31" },
        }),
      ),
    ).toBe("Start 9/20 → 9/21 · Due no due date → 10/31");
    expect(historyText(ev("note_added", { text: "Got it", who: "me" }))).toBe("Note (Me): Got it");
    expect(historyText(ev("archived", { summary: "Quick" }))).toBe("Archived: Quick");
    expect(historyText(ev("created", {}))).toBe("Created the task");
  });

  it("archive tiles: plural days, 「比截止」 → vs. due date", () => {
    setLang("en");
    const s = meikaDone();
    const task = s.tasks.find((t) => t.id === MEIKA);
    const late = s.tasks.find((t) => t.title === "交报销单");
    if (!task || !late) throw new Error("fixture");
    expect(archiveTiles(task, s.keyPoints, TODAY).map((t) => `${t.value}|${t.label}`)).toEqual([
      "11 days|Took",
      "5|Steps",
      "6 days|Waiting",
      "31 days early|vs. due date",
    ]);
    expect(archiveTiles(late, s.keyPoints, TODAY).map((t) => `${t.value}|${t.label}`)).toEqual([
      "7 days|So far",
      "0 / 0|Steps",
      "2 days|Past due",
    ]);
  });

  it("the detail overlay renders in English", async () => {
    await boot();
    setLang("en");
    useUiStore.getState().openOverlay({ kind: "taskDetail", taskId: MEIKA });
    renderOverlay();
    const dialog = screen.getByRole("dialog");
    const text = dialog.textContent ?? "";
    expect(text).toContain("Steps5 · 3 done");
    expect(text).not.toContain("add more anytime");
    expect(
      screen.getByRole("button", { name: "Remind me the day before it’s due (10/30)" }),
    ).toBeTruthy();
    expect(text).not.toContain("Dated steps show up");
    const wait = dialog.querySelector(`[data-kp-id="${KP_WAIT}"]`) as HTMLElement;
    expect(wait.textContent).toContain("Waiting on");
    expect(dialog.querySelector("[data-current]")).toBeNull();
    expect(screen.getByLabelText("Add a step")).toBeTruthy();
    expect(screen.getByTestId("addbar-kind").getAttribute("title")).toBe("My move");
    await userEvent.click(screen.getByRole("button", { name: /^Waiting/ }));
    expect(screen.getAllByRole("menuitemradio").map((i) => i.textContent)).toEqual([
      "Active",
      "Waiting",
      "Done",
    ]);
    fireEvent.keyDown(window, { key: "Escape" });
    await userEvent.click(screen.getByRole("button", { name: "More" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "View history" }));
    await waitFor(() => expect(screen.getByText("No history yet")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Back" })).toBeTruthy();
  });

  it("the archive confirmation and the new-task popover render in English", async () => {
    await boot(meikaDone());
    setLang("en");
    useUiStore.getState().openOverlay({ kind: "archiveConfirm", taskId: MEIKA });
    const { unmount } = renderOverlay();
    expect(screen.getByText("Archive “注册美卡”?")).toBeTruthy();
    expect(screen.getByText("It’s done. Put it away.")).toBeTruthy();
    expect(screen.getByTestId("archive-tiles").textContent).toBe(
      "11 daysTook5Steps6 daysWaiting31 days earlyvs. due date",
    );
    expect(screen.getByRole("button", { name: "Not now" })).toBeTruthy();
    unmount();
    useUiStore.setState({ overlay: null });

    useUiStore.getState().openPopover({ kind: "newTask", title: "", anchor: ANCHOR });
    render(<PopoverHost />);
    expect(screen.getByRole("dialog", { name: "New task" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create" }).getAttribute("aria-disabled")).toBe(
      "true",
    );
    expect(screen.getByPlaceholderText("What’s the task?")).toBeTruthy();
    await userEvent.click(screen.getByLabelText("2026-10-05"));
    await userEvent.click(screen.getByLabelText("2026-10-09"));
    expect(screen.getByTestId("new-due").textContent).toBe("Due10/9");
    expect(
      screen.getByRole("button", { name: "Remind me the day before it’s due (10/8)" }),
    ).toBeTruthy();
    await userEvent.type(screen.getByLabelText("Task title"), "Shelf");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(useUiStore.getState().toast?.text).toBe("Created “Shelf”"));
  });
});
