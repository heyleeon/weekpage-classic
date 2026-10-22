// en resources: same sections as zh-Hans, each typed against its zh-Hans twin.

import type { Messages, Translation } from "../../types";
import archive from "./archive";
import calendar from "./calendar";
import common from "./common";
import detail from "./detail";
import holidays from "./holidays";
import settings from "./settings";
import shell from "./shell";
import tasks from "./tasks";
import timeBar from "./timeBar";
import toasts from "./toasts";
import ui from "./ui";

const en: Messages<Translation> = {
  common,
  shell,
  settings,
  ui,
  toasts,
  calendar,
  holidays,
  tasks,
  timeBar,
  detail,
  archive,
};

export default en;
