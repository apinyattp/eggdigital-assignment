exports.up = (pgm) => {
  pgm.sql(`CREATE TABLE meeting_provider_cleanup (
    meeting_id uuid PRIMARY KEY,
    operation_id uuid NOT NULL UNIQUE,
    creator_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    create_request_id uuid NOT NULL,
    provider text NOT NULL CHECK(provider IN ('GOOGLE_MEET','ZOOM')),
    google_connection_id uuid REFERENCES provider_connections(id) ON DELETE RESTRICT,
    room_connection_id uuid REFERENCES provider_connections(id) ON DELETE RESTRICT,
    external_meeting_id text,
    calendar_id text,
    calendar_event_id text,
    local_action text NOT NULL CHECK(local_action IN ('CANCEL','DELETE')),
    local_updated_at timestamptz,
    executor_claimed_at timestamptz,
    execution_deadline timestamptz,
    calendar_state text NOT NULL CHECK(calendar_state IN ('PENDING','REQUESTED','DELETED','ALREADY_ABSENT','FAILED','UNKNOWN','NOT_APPLICABLE')),
    room_state text NOT NULL CHECK(room_state IN ('PENDING','REQUESTED','DELETED','ALREADY_ABSENT','FAILED','UNKNOWN','NOT_APPLICABLE')),
    calendar_failure_code text CHECK(calendar_failure_code IN ('CONNECTION_REQUIRED','CONNECTION_MISMATCH','RESOURCE_ID_MISSING','ACCESS_DENIED','NOT_FOUND_UNCONFIRMED','RATE_LIMITED','CALL_FAILED','OUTCOME_UNKNOWN','RESULT_NOT_PERSISTED')),
    room_failure_code text CHECK(room_failure_code IN ('CONNECTION_REQUIRED','CONNECTION_MISMATCH','RESOURCE_ID_MISSING','ACCESS_DENIED','NOT_FOUND_UNCONFIRMED','RATE_LIMITED','CALL_FAILED','OUTCOME_UNKNOWN','RESULT_NOT_PERSISTED')),
    calendar_notification text NOT NULL CHECK(calendar_notification IN ('NOT_REQUESTED','REQUESTED_ALL','ACCEPTED_ALL','UNKNOWN')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`);
};
exports.down = (pgm) => {
  pgm.sql('DROP TABLE meeting_provider_cleanup');
};
