exports.up = (pgm) => {
  pgm.sql(`CREATE TABLE deleted_meeting_requests (
    creator_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    create_request_id uuid NOT NULL,
    meeting_id uuid NOT NULL UNIQUE,
    PRIMARY KEY(creator_id,create_request_id)
  )`);
};
exports.down = (pgm) => {
  pgm.sql('DROP TABLE deleted_meeting_requests');
};
