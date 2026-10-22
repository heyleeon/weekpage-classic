import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OverlayHost } from "@/components/shell/OverlayHost";
import { useDataStore } from "@/hooks/useDataStore";
import { useEscDispatcher } from "@/hooks/useEscLayer";
import { useUiStore } from "@/hooks/useUiStore";
import { setLang } from "@/i18n";
import fixture from "@/lib/__fixtures__/demo-snapshot.json";
import { shortestColumn } from "@/lib/board";
import { mockApi, resetMockBackend } from "@/lib/mockBackend";
import type { Snapshot } from "@/types/domain";
import ArchivePage from "./ArchivePage";
import { highlight } from "./ArchiveRow";
import ArchiveToolbarButton from "./ArchiveToolbarButton";

const TODAY = "2026-09-30";
const FIXTURE = fixture as Snapshot;
const MEIKA = "01900000-0000-7000-8000-00000000012e";

const initialUi = useUiStore.getState();
const initialData = useDataStore.getState();

/** Demo state after 注册美卡 done 9/30 and archived with its summary. */
function meikaArchived(): Snapshot {
  const s = structuredClone(FIXTURE);
  for (const k of s.keyPoints) {
    if (k.taskId === MEIKA && k.kind !== "note" && k.doneDate === null) {
      k.doneDate = TODAY;
      k.isCurrent = false;
    }
  }
  const t = s.tasks.find((x) => x.id === MEIKA);
  if (!t) throw new Error("fixture");
  t.status = "done";
  t.doneDate = TODAY;
  t.doneAt = Date.UTC(2026, 8, 30, 3);
  t.archivedDate = TODAY;
  t.archivedAt = Date.UTC(2026, 8, 30, 4);
  t.summary = "比预期快，Capital One 一周内就批了；下次直接用 ITIN 申请";
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

function renderPage() {
  return render(
    <>
      <EscRoot />
      <ArchivePage />
      <OverlayHost />
    </>,
  );
}

/** A filter capsule segment, e.g. 「待办 7」. */
function seg(label: string): HTMLElement {
  return screen.getByRole("button", { name: new RegExp(`^${label} \\d+$`) });
}

function rows(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-entry-id]"));
}

beforeEach(() => {
  useUiStore.setState({ ...initialUi, today: TODAY, page: "archive" }, true);
  useDataStore.setState(initialData, true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ArchiveToolbarButton (ui-spec §14.1)", () => {
  it("shows 归档 10 on the task page and toggles between tasks and archive", async () => {
    await boot();
    useUiStore.setState({ page: "tasks" });
    render(<ArchiveToolbarButton />);
    const btn = screen.getByRole("button", { name: /归档/ });
    expect(btn.textContent).toBe("归档 10");
    await userEvent.click(btn);
    expect(useUiStore.getState().page).toBe("archive");
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    expect(btn.textContent).toBe("归档");
    await userEvent.click(btn);
    expect(useUiStore.getState().page).toBe("tasks");
  });
});

describe("ArchivePage (ui-spec §14)", () => {
  it("filters, groups and the month sidebar for the seed", async () => {
    await boot();
    renderPage();
    const text = document.body.textContent ?? "";
    expect(seg("全部").textContent).toBe("全部 10");
    expect(seg("待办").textContent).toBe("待办 7");
    expect(seg("任务").textContent).toBe("任务 3");
    expect(text).toContain("昨天 · 9/29 周二");
    expect(text).toContain("上周 · 9/21 – 9/27");
    const earlier = screen.getByRole("button", { name: "更早 · 9 月上旬 4 条" });
    expect(earlier.getAttribute("aria-expanded")).toBe("false");
    expect(rows()).toHaveLength(6);
    await userEvent.click(earlier);
    expect(rows()).toHaveLength(10);
    expect(text).toContain("待办：勾掉后第二天早上自动归档");
  });

  it("after the demo: 全部 12 / 待办 7 / 任务 5 and the three insights", async () => {
    const s = meikaArchived();
    const course = s.tasks.find((t) => t.title === "课程作业");
    if (!course) throw new Error("fixture");
    Object.assign(course, {
      status: "done",
      doneDate: TODAY,
      doneAt: Date.UTC(2026, 8, 30, 5),
      archivedDate: TODAY,
      archivedAt: Date.UTC(2026, 8, 30, 6),
    });
    await boot(s);
    renderPage();
    expect(seg("全部").textContent).toBe("全部 12");
    expect(seg("任务").textContent).toBe("任务 5");
    const side = screen.getByRole("complementary");
    expect(side.textContent).toContain("任务 5 件里 3 件提前完成");
    expect(side.textContent).toContain("有关键点的任务平均用时 14 天，其中等别人占一半");
    expect(side.textContent).toContain("逾期的只有 1 件（续费 orbit…）");
  });

  it("search 「美卡」 keeps only that row with the hit highlighted; counts do not change", async () => {
    await boot(meikaArchived());
    renderPage();
    await userEvent.type(screen.getByLabelText("搜归档"), "美卡");
    await waitFor(() => expect(rows()).toHaveLength(1));
    const row = rows()[0];
    expect(row.dataset.entryId).toBe(MEIKA);
    expect(row.querySelector("mark")?.textContent).toBe("美卡");
    expect(seg("全部").textContent).toBe("全部 11");
    expect(seg("待办").textContent).toBe("待办 7");
  });

  it("search 「ITIN」 finds 注册美卡 through its summary", async () => {
    await boot(meikaArchived());
    renderPage();
    await userEvent.type(screen.getByLabelText("搜归档"), "itin");
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(rows()[0].dataset.entryId).toBe(MEIKA);
    await userEvent.click(within(rows()[0]).getByRole("button", { name: /注册美卡/ }));
    expect(rows()[0].querySelector("mark")?.textContent).toBe("ITIN");
  });

  it("search with no hits shows the empty text; 「更早」 auto-expands on a hit", async () => {
    await boot();
    renderPage();
    const input = screen.getByLabelText("搜归档");
    await userEvent.type(input, "健身");
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(rows()[0].textContent).toContain("续签健身卡");
    await userEvent.clear(input);
    await userEvent.type(input, "不存在的东西");
    await waitFor(() => expect(screen.getByText("没找到「不存在的东西」")).toBeTruthy());
    await userEvent.click(screen.getByText("清空搜索"));
    expect((input as HTMLInputElement).value).toBe("");
  });

  it("filter 待办 keeps 7 todos and the numbers stay", async () => {
    await boot();
    renderPage();
    await userEvent.click(seg("待办"));
    await userEvent.click(screen.getByRole("button", { name: /更早/ }));
    expect(rows()).toHaveLength(7);
    expect(seg("全部").textContent).toBe("全部 10");
  });

  it("expands a task row with key points into timeline + summary + actions", async () => {
    await boot(meikaArchived());
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: /注册美卡/ }));
    const block = rows()[0];
    expect(block.textContent).toContain("9/25");
    expect(block.textContent).toContain("比预期快");
    await userEvent.click(within(block).getByRole("button", { name: "查看全部记录" }));
    expect(useUiStore.getState().overlay).toEqual({
      kind: "taskDetail",
      taskId: MEIKA,
      readOnly: true,
    });
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("已归档");
    expect(dialog.textContent).toContain("恢复到任务页");
    expect(screen.queryByLabelText("加一个关键点")).toBeNull();
  });

  it("restores a todo with restoreTodo and a task to the shortest column, highlighted", async () => {
    await boot(meikaArchived());
    const restoreTodo = vi.spyOn(mockApi, "restoreTodo");
    const setDone = vi.spyOn(mockApi, "setTodoDone");
    const restoreTask = vi.spyOn(mockApi, "restoreTask");
    renderPage();
    const todoRow = rows().find((r) => r.textContent?.includes("订国庆回京的车票"));
    if (!todoRow) throw new Error("row");
    await userEvent.click(within(todoRow).getByRole("button", { name: "恢复" }));
    await waitFor(() => expect(restoreTodo).toHaveBeenCalledOnce());
    expect(setDone).not.toHaveBeenCalled();
    expect(useUiStore.getState().toast?.text).toBe("已恢复到待办");

    const expected = shortestColumn(useDataStore.getState().snap as Snapshot, null);
    const taskRow = rows().find((r) => r.dataset.entryId === MEIKA);
    if (!taskRow) throw new Error("row");
    await userEvent.click(within(taskRow).getByRole("button", { name: "恢复" }));
    await waitFor(() => expect(restoreTask).toHaveBeenCalledWith(MEIKA, expected));
    await waitFor(() =>
      expect(useUiStore.getState().highlight).toMatchObject({ id: MEIKA, reason: "restored" }),
    );
    expect(useUiStore.getState().toast?.text).toBe("已恢复到任务页");
  });

  it("Esc clears the search first, then goes back to the task page", async () => {
    await boot();
    renderPage();
    const input = screen.getByLabelText("搜归档") as HTMLInputElement;
    await userEvent.type(input, "车票");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(input.value).toBe("");
    expect(useUiStore.getState().page).toBe("archive");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useUiStore.getState().page).toBe("tasks");
  });

  it("highlight() wraps every case-insensitive hit", () => {
    const { container } = render(<span>{highlight("ITIN 和 itin", "Itin")}</span>);
    expect(Array.from(container.querySelectorAll("mark")).map((m) => m.textContent)).toEqual([
      "ITIN",
      "itin",
    ]);
  });
});

describe("Archive in English (i18n)", () => {
  it("toolbar button: Archive 10, tooltip follows the page", async () => {
    await boot();
    setLang("en");
    useUiStore.setState({ page: "tasks" });
    render(<ArchiveToolbarButton />);
    const btn = screen.getByRole("button", { name: /Archive/ });
    expect(btn.textContent).toBe("Archive 10");
    expect(btn.getAttribute("title")).toBe("Open Archive");
    await userEvent.click(btn);
    expect(btn.textContent).toBe("Archive");
    expect(btn.getAttribute("title")).toBe("Back to Tasks");
  });

  it("filters, group heads, rows and the month sidebar", async () => {
    await boot(meikaArchived());
    setLang("en");
    renderPage();
    expect(seg("All").textContent).toBe("All 11");
    expect(seg("To-dos").textContent).toBe("To-dos 7");
    expect(seg("Tasks").textContent).toBe("Tasks 4");
    const text = document.body.textContent ?? "";
    expect(text).toContain("Today · 9/30 Wed");
    expect(text).toContain("Yesterday · 9/29 Tue");
    expect(text).toContain("Last week · 9/21 – 9/27");
    expect(
      screen.getByRole("button", { name: "Earlier · Early September · 4 items" }),
    ).toBeTruthy();
    const side = screen.getByRole("complementary", { name: "Done this month" });
    expect(side.textContent).toContain("Archive rules");
    expect(side.textContent).toContain(
      "To-dos: archived automatically the morning after you check them off",
    );
    const meika = rows().find((r) => r.dataset.entryId === MEIKA);
    if (!meika) throw new Error("row");
    expect(meika.textContent).toContain("Task");
    expect(meika.textContent).toContain("9/20 → 9/30 · Took 11 days · 31 days early");
    expect(within(meika).getByRole("button", { name: "Restore" })).toBeTruthy();
    await userEvent.click(within(meika).getByRole("button", { name: /注册美卡/ }));
    const block = rows()[0];
    expect(block.textContent).toContain("Them: 邮件");
    expect(within(block).getByRole("button", { name: "View full history" })).toBeTruthy();
    expect(within(block).getByRole("button", { name: "Restore to Tasks" })).toBeTruthy();
  });

  it("search: label, no-hit text and the restore toast", async () => {
    await boot(meikaArchived());
    setLang("en");
    renderPage();
    const input = screen.getByLabelText("Search the archive");
    await userEvent.type(input, "nothing like this");
    await waitFor(() =>
      expect(screen.getByText("No results for “nothing like this”")).toBeTruthy(),
    );
    await userEvent.click(screen.getByText("Clear search"));
    const todoRow = rows().find((r) => r.textContent?.includes("订国庆回京的车票"));
    if (!todoRow) throw new Error("row");
    await userEvent.click(within(todoRow).getByRole("button", { name: "Restore" }));
    await waitFor(() => expect(useUiStore.getState().toast?.text).toBe("Restored to To-dos"));
  });
});
