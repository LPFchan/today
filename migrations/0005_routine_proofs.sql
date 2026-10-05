-- Private proof timestamps and notes share the existing day retention.
ALTER TABLE routine_status ADD COLUMN proofs TEXT NOT NULL DEFAULT '{}';
