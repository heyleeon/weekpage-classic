// zh-Hans resources: one "translation" namespace assembled from per-section files, so parallel work
// never edits the same file. This object's type is the source shape (see ../../types.ts).

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

const zhHans = {
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

export default zhHans;
