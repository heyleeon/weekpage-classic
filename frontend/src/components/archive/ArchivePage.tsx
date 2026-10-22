// Archive page (ui-spec §14): filter capsule (counts ignore the search), debounced
// search with hit highlighting, grouped list (「更早」 collapsed), expandable task rows with the
// key point timeline and summary, restore, read-only detail, month sidebar. mod+F focuses the
// search; Esc clears the search first, then goes back to the task page.

import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Capsule, CapsuleSegment } from "@/components/ui/Capsule";
import { useDataStore } from "@/hooks/useDataStore";
import { ESC_PRIORITY, useEscLayer } from "@/hooks/useEscLayer";
import { useHotkey } from "@/hooks/useHotkeys";
import { useToday } from "@/hooks/useToday";
import { useUiStore } from "@/hooks/useUiStore";
import { archiveEntriesAt, groupArchive, searchArchive } from "@/lib/archive";
import type { ArchiveEntry } from "@/types/domain";
import styles from "./ArchivePage.module.css";
import { ArchiveRow } from "./ArchiveRow";
import { MonthSidebar } from "./MonthSidebar";

export type ArchiveFilter = "all" | "todo" | "task";

/** Search debounce (ui-spec §14.6). */
export const SEARCH_DEBOUNCE_MS = 150;

function useDebounced(value: string, ms: number): string {
  const [v, setV] = useState(value);
  useEffect(() => {
    if (value === "") {
      setV("");
      return;
    }
    const timer = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(timer);
  }, [value, ms]);
  return v;
}

/** Entries of the given type. */
export function filterEntries(entries: ArchiveEntry[], filter: ArchiveFilter): ArchiveEntry[] {
  return filter === "all" ? entries : entries.filter((e) => e.kind === filter);
}

export default function ArchivePage() {
  const { t } = useTranslation();
  const snap = useDataStore((s) => s.snap);
  const today = useToday();
  const setPage = useUiStore((s) => s.setPage);
  const [filter, setFilter] = useState<ArchiveFilter>("all");
  const [input, setInput] = useState("");
  const q = useDebounced(input.trim(), SEARCH_DEBOUNCE_MS);
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const searchRef = useRef<HTMLInputElement>(null);

  useEscLayer(
    true,
    () => {
      if (input !== "") setInput("");
      else setPage("tasks");
    },
    ESC_PRIORITY.archiveBack,
  );
  useHotkey("mod+f", () => {
    searchRef.current?.focus();
    searchRef.current?.select();
    return true;
  });

  const entries = useMemo(() => (snap ? archiveEntriesAt(snap, today) : []), [snap, today]);
  const counts = useMemo(
    () => ({
      all: entries.length,
      todo: entries.filter((e) => e.kind === "todo").length,
      task: entries.filter((e) => e.kind === "task").length,
    }),
    [entries],
  );
  const groups = useMemo(
    () => groupArchive(searchArchive(filterEntries(entries, filter), q), today),
    [entries, filter, q, today],
  );

  const toggle = (set: Set<string>, key: string) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  };

  const segment = (key: ArchiveFilter, label: string) => (
    <CapsuleSegment selected={filter === key} onClick={() => setFilter(key)}>
      <span>
        {label} <span className={styles.segCount}>{counts[key]}</span>
      </span>
    </CapsuleSegment>
  );

  return (
    <section className={styles.page} aria-label={t("archive.page.label")}>
      <div className={styles.main}>
        <div className={styles.filterRow}>
          <Capsule label={t("archive.page.filterLabel")} size="sm" className={styles.filter}>
            {segment("all", t("archive.page.all"))}
            {segment("todo", t("archive.page.todo"))}
            {segment("task", t("archive.page.task"))}
          </Capsule>
          <label className={styles.search}>
            <MagnifyingGlassIcon size={14} className={styles.searchIcon} />
            <input
              ref={searchRef}
              className={styles.searchInput}
              value={input}
              placeholder={t("archive.page.searchPlaceholder")}
              aria-label={t("archive.page.searchLabel")}
              onChange={(e) => setInput(e.target.value)}
            />
            {input !== "" && (
              <button
                type="button"
                className={styles.searchClear}
                aria-label={t("archive.page.clearSearch")}
                onClick={() => {
                  setInput("");
                  searchRef.current?.focus();
                }}
              >
                <XIcon size={10} />
              </button>
            )}
          </label>
        </div>

        <div className={styles.list} data-testid="archive-list">
          {entries.length === 0 ? (
            <div className={styles.empty}>
              <div className={styles.emptyTitle}>{t("archive.page.emptyTitle")}</div>
              <div className={styles.emptyText}>{t("archive.page.emptyText")}</div>
            </div>
          ) : groups.length === 0 ? (
            <div className={styles.notFound}>
              {q ? t("archive.page.notFound", { q }) : t("archive.page.emptyFilter")}
              {q && (
                <button type="button" className={styles.clearSearch} onClick={() => setInput("")}>
                  {t("archive.page.clearSearch")}
                </button>
              )}
            </div>
          ) : (
            groups.map((g) => {
              const collapsed = g.collapsed && !q && !opened.has(g.key);
              return (
                <div key={g.key} className={styles.group} data-group={g.key}>
                  {g.collapsed ? (
                    <button
                      type="button"
                      className={styles.groupHead}
                      aria-expanded={!collapsed}
                      onClick={() => setOpened((s) => toggle(s, g.key))}
                    >
                      {g.label}
                      <CaretDownIcon
                        size={11}
                        className={collapsed ? styles.caret : styles.caretUp}
                      />
                    </button>
                  ) : (
                    <div className={styles.groupHead}>{g.label}</div>
                  )}
                  {!collapsed &&
                    g.entries.map((e) => (
                      <ArchiveRow
                        key={`${e.kind}:${e.id}`}
                        entry={e}
                        query={q}
                        expanded={expanded.has(e.id)}
                        onToggle={() => setExpanded((s) => toggle(s, e.id))}
                      />
                    ))}
                </div>
              );
            })
          )}
        </div>
      </div>
      <div className={styles.divider} />
      <MonthSidebar />
    </section>
  );
}
