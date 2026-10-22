// Left column (ui-spec §5.1–§5.2, §6.1): [待办 N | 收件箱 ③] + round 「+」, tab body.

import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Capsule, CapsuleSegment } from "@/components/ui/Capsule";
import { useUiStore } from "@/hooks/useUiStore";
import { todoLists } from "@/lib/todos";
import type { Snapshot } from "@/types/domain";
import { InboxPanel, type InboxPanelHandle } from "./InboxPanel";
import { TodoList } from "./TodoList";
import styles from "./TodoPanel.module.css";

export function TodoPanel({ snap, today }: { snap: Snapshot; today: string }) {
  const { t } = useTranslation();
  const tab = useUiStore((s) => s.leftTab);
  const setTab = useUiStore((s) => s.setLeftTab);
  const [adding, setAdding] = useState(false);
  const inbox = useRef<InboxPanelHandle>(null);
  const openCount = todoLists(snap, today).open.length;
  const inboxCount = snap.inbox.length;

  const addLabel = tab === "today" ? t("tasks.panel.addTodo") : t("tasks.panel.addInbox");

  const onAdd = () => {
    if (tab === "today") setAdding(true);
    else inbox.current?.focusInput();
  };

  return (
    <aside className={styles.panel} data-left-column="true" aria-label={t("tasks.panel.label")}>
      <div className={styles.head}>
        <Capsule label={t("tasks.panel.tabs")} className={styles.tabs}>
          <CapsuleSegment
            selected={tab === "today"}
            onClick={() => setTab("today")}
            className={styles.tab}
          >
            {t("tasks.panel.today")}
            <span className={styles.count}>{openCount}</span>
          </CapsuleSegment>
          <CapsuleSegment
            selected={tab === "inbox"}
            onClick={() => setTab("inbox")}
            className={styles.tab}
          >
            {t("tasks.panel.inbox")}
            {inboxCount > 0 && (
              <span
                className={styles.badge}
                data-testid="inbox-badge"
                data-wide={inboxCount > 99 ? "true" : undefined}
              >
                {inboxCount > 99 ? "99+" : inboxCount}
              </span>
            )}
          </CapsuleSegment>
        </Capsule>
        <button
          type="button"
          className={styles.add}
          aria-label={addLabel}
          title={addLabel}
          onClick={onAdd}
        >
          <PlusIcon size={14} />
        </button>
      </div>
      {tab === "today" ? (
        <TodoList snap={snap} today={today} adding={adding} setAdding={setAdding} />
      ) : (
        <InboxPanel ref={inbox} items={snap.inbox} />
      )}
    </aside>
  );
}
