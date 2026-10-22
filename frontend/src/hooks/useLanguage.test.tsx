import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "@/App";
import { PageTitle } from "@/components/shell/PageTitle";
import { currentLang, i18n } from "@/i18n";
import { resetMockBackend } from "@/lib/mockBackend";
import { useDataStore } from "./useDataStore";
import { useLanguage } from "./useLanguage";
import { useUiStore } from "./useUiStore";

const initialUi = useUiStore.getState();
const initialData = useDataStore.getState();

function setNavigatorLanguages(langs: string[]) {
  Object.defineProperty(navigator, "languages", { value: langs, configurable: true });
  Object.defineProperty(navigator, "language", { value: langs[0] ?? "", configurable: true });
}

/** Same pattern as App: the subtree is keyed by the active language. */
function Harness() {
  const lang = useLanguage();
  return (
    <div key={lang} data-testid="paper">
      <PageTitle />
    </div>
  );
}

beforeEach(() => {
  resetMockBackend();
  useUiStore.setState(
    { ...initialUi, today: "2026-09-30", calendarAnchor: "2026-09-28", page: "calendar" },
    true,
  );
  useDataStore.setState(initialData, true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useLanguage", () => {
  it("keeps zh-Hans until the snapshot arrives", () => {
    setNavigatorLanguages(["en-US"]);
    render(<Harness />);
    expect(currentLang()).toBe("zh-Hans");
    expect(screen.getByRole("heading").textContent).toBe("9月2026");
  });

  it("applies settings.language and re-renders lib text helpers on a switch", async () => {
    await useDataStore.getState().refresh();
    render(<Harness />);
    expect(screen.getByRole("heading").textContent).toBe("9月2026");

    await act(() => useDataStore.getState().saveSettings({ language: "en" }));
    expect(currentLang()).toBe("en");
    expect(document.documentElement.lang).toBe("en");
    expect(screen.getByRole("heading").textContent).toBe("September2026");

    await act(() => useDataStore.getState().saveSettings({ language: "zh-Hans" }));
    expect(screen.getByRole("heading").textContent).toBe("9月2026");
    expect(document.documentElement.lang).toBe("zh-Hans");
  });

  it("system follows navigator.languages, also when the OS language changes", async () => {
    setNavigatorLanguages(["en-US", "zh-CN"]);
    await useDataStore.getState().refresh();
    expect(useDataStore.getState().snap?.settings.language).toBe("system");
    render(<Harness />);
    expect(screen.getByRole("heading").textContent).toBe("September2026");

    setNavigatorLanguages(["zh-Hans-CN"]);
    act(() => {
      window.dispatchEvent(new Event("languagechange"));
    });
    expect(currentLang()).toBe("zh-Hans");
    expect(screen.getByRole("heading").textContent).toBe("9月2026");
  });

  it("an i18n change from elsewhere also re-renders the keyed subtree", async () => {
    render(<Harness />);
    act(() => {
      void i18n.changeLanguage("en");
    });
    expect(screen.getByRole("heading").textContent).toBe("September2026");
  });
});

describe("App · language switch", () => {
  it("re-renders the whole paper in the new language without booting again", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("offline in tests"))),
    );
    window.history.replaceState(null, "", "/?now=2026-09-30T10:00");
    const loadAppInfo = vi.spyOn(useDataStore.getState(), "loadAppInfo");
    render(<App />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(loadAppInfo).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("heading").textContent).toBe("9月2026");
    expect(screen.getAllByText("周三").length).toBeGreaterThan(0);

    await act(() => useDataStore.getState().saveSettings({ language: "en" }));
    expect(screen.getByRole("heading").textContent).toBe("September2026");
    expect(loadAppInfo).toHaveBeenCalledTimes(1);
  });
});
