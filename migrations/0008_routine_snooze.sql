-- When a snoozed wake alarm may ring again; the lock itself is unchanged.
ALTER TABLE routine_status ADD COLUMN snoozed_until INTEGER;
