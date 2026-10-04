-- One row per person who has enabled or edited their recurring routine.
-- `text` is the routine source (public/routine.js); the place defaults to
-- Seoul. `materialized_day` tracks the instance copied into their day plan.
-- `enabled_at` is the opt-in time in epoch ms; slots ended by then aren't owed.
CREATE TABLE routines (
    sub TEXT PRIMARY KEY,
    text TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
    enabled_at INTEGER NOT NULL DEFAULT 0,
    tz TEXT NOT NULL DEFAULT 'Asia/Seoul',
    lat REAL NOT NULL DEFAULT 37.5665,
    lon REAL NOT NULL DEFAULT 126.978,
    materialized_day TEXT,
    updated_at INTEGER NOT NULL
);

-- Private progress for today and yesterday's routine instances. Times are
-- epoch ms; `key` is the item's time token, stable within the routine text.
CREATE TABLE routine_status (
    sub TEXT NOT NULL,
    day TEXT NOT NULL,
    key TEXT NOT NULL,
    started_at INTEGER,
    done_at INTEGER,
    PRIMARY KEY (sub, day, key)
);
