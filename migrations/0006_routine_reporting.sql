-- Observed routine instances survive status pruning, edits and disabling.
ALTER TABLE routines ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE routines ADD COLUMN instance INTEGER NOT NULL DEFAULT 0;
CREATE TABLE routine_days (
  sub TEXT NOT NULL,
  day TEXT NOT NULL,
  enabled_at INTEGER NOT NULL,
  instance INTEGER NOT NULL,
  observed_at INTEGER NOT NULL,
  ends INTEGER NOT NULL,
  stopped_at INTEGER,
  data TEXT NOT NULL,
  statuses TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (sub, day, instance)
);
CREATE TABLE routine_affordances (
  sub TEXT NOT NULL,
  request_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('bypass', 'off')),
  day TEXT NOT NULL,
  key TEXT,
  reason TEXT NOT NULL,
  at INTEGER NOT NULL,
  enabled_at INTEGER NOT NULL,
  instance INTEGER NOT NULL,
  PRIMARY KEY (sub, request_id)
);
CREATE UNIQUE INDEX routine_one_bypass ON routine_affordances(sub, day, instance, key) WHERE action = 'bypass';
CREATE INDEX routine_affordance_day ON routine_affordances(sub, day);
CREATE TRIGGER routine_new_instance AFTER UPDATE OF enabled ON routines
  WHEN OLD.enabled = 0 AND NEW.enabled = 1 BEGIN
  UPDATE routines SET instance = instance + 1 WHERE sub = NEW.sub;
  DELETE FROM routine_status WHERE sub = NEW.sub;
END;
CREATE TRIGGER routine_revision AFTER UPDATE OF text, pending_text, pending_from, enabled,
  enabled_at, materialized_day, updated_at, tz, lat, lon ON routines BEGIN
  UPDATE routines SET revision = revision + 1 WHERE sub = NEW.sub;
END;
CREATE TRIGGER routine_status_insert AFTER INSERT ON routine_status BEGIN
  UPDATE routines SET revision = revision + 1 WHERE sub = NEW.sub;
  UPDATE routine_days SET statuses = json_set(statuses, '$.' || json_quote(NEW.key),
    json_object('startedAt', NEW.started_at, 'doneAt', NEW.done_at, 'proofs', json(NEW.proofs)))
    WHERE sub = NEW.sub AND day = NEW.day AND instance =
      (SELECT instance FROM routines WHERE sub = NEW.sub AND enabled = 1);
END;
CREATE TRIGGER routine_status_update AFTER UPDATE ON routine_status BEGIN
  UPDATE routines SET revision = revision + 1 WHERE sub = NEW.sub;
  UPDATE routine_days SET statuses = json_set(statuses, '$.' || json_quote(NEW.key),
    json_object('startedAt', NEW.started_at, 'doneAt', NEW.done_at, 'proofs', json(NEW.proofs)))
    WHERE sub = NEW.sub AND day = NEW.day AND instance =
      (SELECT instance FROM routines WHERE sub = NEW.sub AND enabled = 1);
END;
CREATE TRIGGER routine_status_delete AFTER DELETE ON routine_status BEGIN
  UPDATE routines SET revision = revision + 1 WHERE sub = OLD.sub;
END;
CREATE TRIGGER routine_affordance_revision AFTER INSERT ON routine_affordances BEGIN
  UPDATE routines SET revision = revision + 1 WHERE sub = NEW.sub;
END;
