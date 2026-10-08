exports.up = (pgm) => {
  pgm.sql(`CREATE TABLE interview_notes (
    meeting_id uuid NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    author_key text NOT NULL,
    content text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(meeting_id,author_key)
  );
  CREATE TABLE meeting_feedback (
    id uuid PRIMARY KEY,
    meeting_id uuid NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    author_key text NOT NULL,
    author_name text NOT NULL,
    create_request_id uuid NOT NULL,
    content text NOT NULL CHECK(length(btrim(content))>0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(meeting_id,author_key)
  );
  CREATE INDEX meeting_feedback_older_idx ON meeting_feedback(meeting_id,created_at DESC,id DESC);`);
};
exports.down = (pgm) => {
  pgm.sql('DROP TABLE meeting_feedback; DROP TABLE interview_notes');
};
