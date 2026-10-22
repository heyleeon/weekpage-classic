// [日历 ⌘1 | 任务 ⌘2] (ui-spec §1.3). The archive page keeps 「任务」 selected.

import { useTranslation } from "react-i18next";
import { useUiStore } from "@/hooks/useUiStore";
import { shortcutHint } from "@/lib/platform";
import { Capsule, CapsuleSegment } from "../ui/Capsule";

export function PageSwitch() {
  const { t } = useTranslation();
  const page = useUiStore((s) => s.page);
  const setPage = useUiStore((s) => s.setPage);
  return (
    <Capsule label={t("shell.pageSwitch.label")}>
      <CapsuleSegment
        selected={page === "calendar"}
        hint={shortcutHint("1")}
        onClick={() => setPage("calendar")}
      >
        {t("shell.pageSwitch.calendar")}
      </CapsuleSegment>
      <CapsuleSegment
        selected={page !== "calendar"}
        hint={shortcutHint("2")}
        onClick={() => setPage("tasks")}
      >
        {t("shell.pageSwitch.tasks")}
      </CapsuleSegment>
    </Capsule>
  );
}
