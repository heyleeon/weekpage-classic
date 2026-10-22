-- 约定：所有业务表 id = UUIDv7 文本；时间戳 = UTC 毫秒整数；日期 = 浮动本地日期 'YYYY-MM-DD'；
-- 时间 = 'HH:MM'；删除一律软删（deleted_at）；排序一律 sort_key（分数索引，base62，按 ASCII 比较）。

CREATE TABLE events (
  id          TEXT PRIMARY KEY,
  date        TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  time        TEXT CHECK (time IS NULL OR time GLOB '[0-2][0-9]:[0-5][0-9]'),
  end_time    TEXT CHECK (end_time IS NULL OR (time IS NOT NULL AND end_time GLOB '[0-2][0-9]:[0-5][0-9]')),
  title       TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  location    TEXT,                                   -- 预留，v1 无入口
  created_at  INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  updated_at  INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  deleted_at  INTEGER
);
CREATE INDEX idx_events_date ON events(date) WHERE deleted_at IS NULL;

CREATE TABLE todos (
  id                  TEXT PRIMARY KEY,
  title               TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  sort_key            TEXT NOT NULL,
  remind_date         TEXT CHECK (remind_date IS NULL OR remind_date GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  remind_time         TEXT CHECK (remind_time IS NULL OR (remind_date IS NOT NULL AND remind_time GLOB '[0-2][0-9]:[0-5][0-9]')),
  created_date        TEXT NOT NULL,                  -- 本地日期：算「昨天顺延 / 顺延 N 天」
  done_at             INTEGER,                        -- UTC 毫秒：组内按完成先后排
  done_date           TEXT,                           -- 本地日期：「今天完成」/ 次日自动归档 / 归档分组
  remind_notified_at  INTEGER,                        -- 已发过通知；改提醒日 / 时间时 Rust 清空
  created_at  INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  updated_at  INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  deleted_at  INTEGER,
  CHECK ((done_at IS NULL) = (done_date IS NULL))
);
CREATE INDEX idx_todos_sort   ON todos(sort_key)    WHERE deleted_at IS NULL;
CREATE INDEX idx_todos_remind ON todos(remind_date) WHERE deleted_at IS NULL AND remind_date IS NOT NULL;

CREATE TABLE inbox_items (
  id          TEXT PRIMARY KEY,
  text        TEXT NOT NULL CHECK (length(trim(text)) BETWEEN 1 AND 500),
  sort_key    TEXT NOT NULL,                          -- 新的在最上面：取 between(None, 第一条)
  created_at  INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  updated_at  INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  deleted_at  INTEGER                                 -- 整理（进待办 / 变任务 / 删掉）都是软删
);

CREATE TABLE tasks (
  id                  TEXT PRIMARY KEY,
  title               TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'waiting', 'done')),
  start_date          TEXT NOT NULL CHECK (start_date GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  due_date            TEXT CHECK (due_date IS NULL OR due_date >= start_date),
  last_due_date       TEXT,                           -- 勾「不设截止」前的截止，取消勾时恢复
  remind_day_before   INTEGER NOT NULL DEFAULT 0 CHECK (remind_day_before IN (0, 1)),
  remind_notified_at  INTEGER,                        -- 改截止 / 关开关时 Rust 清空
  board_column        INTEGER NOT NULL CHECK (board_column IN (0, 1, 2)),
  sort_key            TEXT NOT NULL,                  -- 列内顺序
  done_at             INTEGER,
  done_date           TEXT,                           -- status = 'done' 时必有
  archived_at         INTEGER,
  archived_date       TEXT,                           -- 本地日期：日历上「归档后只保留 ≤ 这天的标记」
  summary             TEXT CHECK (summary IS NULL OR length(summary) <= 100),
  created_at  INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  updated_at  INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  deleted_at  INTEGER,
  CHECK ((status = 'done') = (done_date IS NOT NULL)),
  CHECK ((archived_at IS NULL) = (archived_date IS NULL))
);
CREATE INDEX idx_tasks_board ON tasks(board_column, sort_key) WHERE deleted_at IS NULL AND archived_at IS NULL;

CREATE TABLE key_points (
  id             TEXT PRIMARY KEY,
  task_id        TEXT NOT NULL REFERENCES tasks(id),
  kind           TEXT NOT NULL CHECK (kind IN ('do', 'wait', 'check', 'note')),
  text           TEXT NOT NULL CHECK (length(trim(text)) BETWEEN 1 AND 200),  -- 原样保存，日期不从文字里拿掉
  date           TEXT CHECK (date IS NULL OR date GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  who            TEXT CHECK (who IS NULL OR (kind = 'note' AND who IN ('them', 'me'))),
  sort_key       TEXT NOT NULL,                       -- 关键点与记一笔共用一条时间线顺序
  done_date      TEXT,                                -- note 永远为 NULL
  is_current     INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0, 1)),
  current_since  TEXT,                                -- 手动设为当前的那天
  created_at  INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  updated_at  INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  deleted_at  INTEGER,
  CHECK (kind <> 'note' OR (done_date IS NULL AND is_current = 0)),
  CHECK (NOT (is_current = 1 AND done_date IS NOT NULL))
);
CREATE INDEX idx_kp_task ON key_points(task_id, sort_key) WHERE deleted_at IS NULL;
CREATE INDEX idx_kp_date ON key_points(date) WHERE deleted_at IS NULL AND date IS NOT NULL;

CREATE TABLE task_events (                            -- 任务历史，只追加
  id          TEXT PRIMARY KEY,
  task_id     TEXT NOT NULL REFERENCES tasks(id),
  type        TEXT NOT NULL CHECK (type IN (
                'created', 'renamed', 'status', 'dates', 'remind',
                'kp_added', 'kp_edited', 'kp_done', 'kp_undone', 'kp_current', 'kp_deleted',
                'note_added', 'archived', 'restored')),
  payload     TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload)),  -- 例：{"from":"waiting","to":"done"}
  at          INTEGER NOT NULL,                       -- 发生时刻 UTC 毫秒（界面显示成本地 M/D HH:MM）
  created_at  INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  updated_at  INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  deleted_at  INTEGER
);
CREATE INDEX idx_task_events_task ON task_events(task_id, at);

CREATE TABLE calendar_day_orders (                    -- 日历格内手动顺序：一天一行
  id          TEXT PRIMARY KEY,
  date        TEXT NOT NULL UNIQUE,
  item_keys   TEXT NOT NULL CHECK (json_valid(item_keys) AND json_type(item_keys) = 'array'),
  created_at  INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  updated_at  INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  deleted_at  INTEGER
);

CREATE TABLE settings (                               -- 本机设置，不同步
  key         TEXT PRIMARY KEY,                       -- 'app'（Settings JSON）、'device_id'、'cache:holidays' …
  value       TEXT NOT NULL CHECK (json_valid(value)),
  updated_at  INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER))
);

CREATE TABLE undo_journal (                           -- 撤销日志，本机，保留 24 小时
  seq         INTEGER PRIMARY KEY AUTOINCREMENT,
  op_id       TEXT NOT NULL,
  table_name  TEXT NOT NULL,
  row_id      TEXT NOT NULL,
  before      TEXT CHECK (before IS NULL OR json_valid(before)),  -- NULL = 这行是本次新建的
  created_at  INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER))
);
CREATE INDEX idx_undo_op ON undo_journal(op_id);
