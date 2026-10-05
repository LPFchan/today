-- Days off are private and suppress routine locks and plan materialization.
CREATE TABLE routine_away (
    sub TEXT NOT NULL,
    day TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (sub, day)
);
