-- One row per person who has opened today.lost.plus.
--
-- `sub` is the immutable auth.lost.plus subject from the gateway. `name` is a
-- copy of the hub's display name, refreshed on every visit. `schedule` is the
-- canonical schedule text (public/schedule.js); `anchor` is the epoch ms of the
-- local midnight its times count from.
CREATE TABLE people (
    sub TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('public', 'private')),
    schedule TEXT NOT NULL DEFAULT '',
    anchor INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
);

CREATE INDEX people_visibility ON people (visibility);

-- Watch pairings waiting for a phone to approve them. Rows live ten minutes.
-- `code` is the hub's authorization code once approved; it cannot be
-- redeemed without the PKCE verifier, which only the watch's phone holds.
CREATE TABLE pairings (
    id TEXT PRIMARY KEY,
    secret_hash TEXT NOT NULL,
    authorize_url TEXT NOT NULL,
    code TEXT,
    created_at INTEGER NOT NULL
);
