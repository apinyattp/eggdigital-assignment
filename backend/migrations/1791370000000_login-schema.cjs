exports.up = (pgm) =>
  pgm.sql(`
CREATE TABLE users (
 id uuid PRIMARY KEY, email text NOT NULL UNIQUE CHECK(email=lower(btrim(email))),
 display_name text NOT NULL, password_hash text DEFAULT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE meetings (
 id uuid PRIMARY KEY, creator_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 create_request_id uuid NOT NULL, title text NOT NULL CHECK(length(btrim(title))>0), description text DEFAULT NULL,
 candidate_name text NOT NULL, candidate_email text NOT NULL CHECK(candidate_email=lower(btrim(candidate_email))),
 position text NOT NULL CHECK(length(btrim(position))>0), starts_at timestamptz NOT NULL,
 ends_at timestamptz NOT NULL CHECK(ends_at>starts_at), status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','CONFIRMED','REJECTED')),
 format text NOT NULL DEFAULT 'ONSITE' CHECK(format='ONSITE'), location text DEFAULT NULL,
 meeting_provider text DEFAULT NULL CHECK(meeting_provider IN ('ZOOM','GOOGLE_MEET')),
 external_meeting_id text DEFAULT NULL CHECK(external_meeting_id IS NULL OR length(btrim(external_meeting_id))>0),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(creator_id,create_request_id),
 CHECK((meeting_provider IS NULL)=(external_meeting_id IS NULL)),
 CHECK(format<>'ONSITE' OR (meeting_provider IS NULL AND external_meeting_id IS NULL))
);
CREATE INDEX meetings_candidate_email_idx ON meetings(candidate_email);
CREATE INDEX meetings_creator_id_id_idx ON meetings(creator_id,id);
CREATE TABLE meeting_attendees (
 meeting_id uuid NOT NULL REFERENCES meetings(id) ON DELETE RESTRICT,
 email text NOT NULL CHECK(email=lower(btrim(email))),display_name text NOT NULL,
 member_id uuid DEFAULT NULL REFERENCES users(id) ON DELETE RESTRICT,PRIMARY KEY(meeting_id,email)
);
CREATE INDEX meeting_attendees_email_meeting_idx ON meeting_attendees(email,meeting_id);
`);
exports.down = (pgm) =>
  pgm.sql('DROP TABLE meeting_attendees; DROP TABLE meetings; DROP TABLE users;');
