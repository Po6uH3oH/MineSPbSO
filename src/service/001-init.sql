CREATE TABLE IF NOT EXISTS accounts (
 id uuid PRIMARY KEY, email text NOT NULL UNIQUE, nickname varchar(16) NOT NULL,
 nickname_key text GENERATED ALWAYS AS (lower(nickname)) STORED UNIQUE,
 game_uuid uuid NOT NULL UNIQUE, password_hash text NOT NULL,
 verified boolean NOT NULL DEFAULT false, banned boolean NOT NULL DEFAULT false,
 faction text CHECK (faction IN ('blue','yellow','red')), skin bytea, skin_hash text,
 skin_model text NOT NULL DEFAULT 'default' CHECK (skin_model IN ('default','slim')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
 id uuid PRIMARY KEY, account_id uuid NOT NULL REFERENCES accounts(id),
 access_hash text NOT NULL UNIQUE, refresh_hash text NOT NULL UNIQUE,
 access_expires timestamptz NOT NULL, expires timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS email_tokens (
 hash text PRIMARY KEY, account_id uuid NOT NULL REFERENCES accounts(id),
 purpose text NOT NULL CHECK (purpose IN ('verify','reset')), expires timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS challenges (
 id text PRIMARY KEY, server_id text NOT NULL, nickname text NOT NULL, game_uuid uuid NOT NULL,
 expires timestamptz NOT NULL, ticket_hash text UNIQUE, account_id uuid REFERENCES accounts(id), consumed boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS limits (key text PRIMARY KEY, count int NOT NULL, expires timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS skin_blobs (hash text PRIMARY KEY, png bytea NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE challenges ADD COLUMN IF NOT EXISTS ticket_session_id uuid REFERENCES sessions(id) ON DELETE SET NULL;
CREATE TABLE IF NOT EXISTS reserved_nicks (nickname_key text PRIMARY KEY);
INSERT INTO reserved_nicks SELECT nickname_key FROM accounts ON CONFLICT DO NOTHING;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS pending boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS registration_policy (id int PRIMARY KEY CHECK(id=1), mode text NOT NULL CHECK(mode IN ('open','review','closed')));
INSERT INTO registration_policy VALUES(1,'open') ON CONFLICT DO NOTHING;
