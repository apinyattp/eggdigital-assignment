exports.up = (pgm) => {
  pgm.sql(`CREATE TABLE meeting_provider_operations (
    creator_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    request_id uuid NOT NULL,
    operation_id uuid NOT NULL UNIQUE,
    provider text NOT NULL CHECK(provider IN ('GOOGLE_MEET','ZOOM')),
    google_connection_id uuid NOT NULL REFERENCES provider_connections(id) ON DELETE RESTRICT,
    room_connection_id uuid REFERENCES provider_connections(id) ON DELETE RESTRICT,
    phase text NOT NULL CHECK(phase IN ('CLAIMED','ROOM_REQUESTED','ROOM_KNOWN','CALENDAR_REQUESTED',
      'EXTERNAL_READY','COMPLETED','FAILED_MANUAL','OUTCOME_UNKNOWN')),
    external_meeting_id text,
    join_url text,
    calendar_id text NOT NULL,
    calendar_event_id text NOT NULL,
    conference_request_id text,
    meeting_id uuid,
    failure_code text CHECK(failure_code IN ('AUTH_REQUIRED','PERMISSION_DENIED','RATE_LIMITED',
      'REJECTED','OUTCOME_UNKNOWN','RESPONSE_INVALID','LOCAL_WRITE_FAILED','IDENTITY_PERSIST_FAILED','MEET_NOT_READY')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(creator_id,request_id)
  );
  CREATE TABLE meeting_calendar_links (
    meeting_id uuid PRIMARY KEY REFERENCES meetings(id) ON DELETE RESTRICT,
    connection_id uuid NOT NULL REFERENCES provider_connections(id) ON DELETE RESTRICT,
    calendar_id text NOT NULL,
    event_id text NOT NULL,
    etag text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(connection_id,calendar_id,event_id)
  )`);
};
exports.down = (pgm) => {
  pgm.sql('DROP TABLE meeting_calendar_links; DROP TABLE meeting_provider_operations');
};
