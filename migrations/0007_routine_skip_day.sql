-- Hermes can skip the rest of the current routine day without switching it off.
CREATE TABLE routine_affordances_next (
  sub TEXT NOT NULL,
  request_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('bypass', 'skip_day', 'off')),
  day TEXT NOT NULL,
  key TEXT,
  reason TEXT NOT NULL,
  at INTEGER NOT NULL,
  enabled_at INTEGER NOT NULL,
  instance INTEGER NOT NULL,
  PRIMARY KEY (sub, request_id)
);
INSERT INTO routine_affordances_next SELECT * FROM routine_affordances;
DROP TABLE routine_affordances;
ALTER TABLE routine_affordances_next RENAME TO routine_affordances;
CREATE UNIQUE INDEX routine_one_bypass ON routine_affordances(sub, day, instance, key) WHERE action = 'bypass';
CREATE INDEX routine_affordance_day ON routine_affordances(sub, day);
CREATE TRIGGER routine_affordance_revision AFTER INSERT ON routine_affordances BEGIN
  UPDATE routines SET revision = revision + 1 WHERE sub = NEW.sub;
END;
