exports.up = (pgm) => {
  pgm.sql(`ALTER TABLE meetings DROP CONSTRAINT meetings_format_check;
    ALTER TABLE meetings ADD CONSTRAINT meetings_format_check CHECK(format IN ('ONSITE','ONLINE'));
    ALTER TABLE meetings ADD CONSTRAINT meetings_online_provider_check
      CHECK(format<>'ONLINE' OR (meeting_provider IS NOT NULL AND external_meeting_id IS NOT NULL))`);
};
exports.down = (pgm) => {
  // Existing Online rows must be explicitly reconciled before reverting this schema; never delete them here.
  pgm.sql(`ALTER TABLE meetings DROP CONSTRAINT meetings_online_provider_check;
    ALTER TABLE meetings DROP CONSTRAINT meetings_format_check;
    ALTER TABLE meetings ADD CONSTRAINT meetings_format_check CHECK(format='ONSITE')`);
};
