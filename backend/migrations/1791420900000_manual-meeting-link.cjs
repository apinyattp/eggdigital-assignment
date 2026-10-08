exports.up = (pgm) => {
  pgm.sql(`ALTER TABLE meetings ADD COLUMN manual_join_url text DEFAULT NULL;
    ALTER TABLE meetings ADD CONSTRAINT meetings_manual_link_check CHECK
      (manual_join_url IS NULL OR (format='ONLINE' AND manual_join_url ~ '^https://'));
    ALTER TABLE meetings DROP CONSTRAINT meetings_online_provider_check;
    ALTER TABLE meetings ADD CONSTRAINT meetings_online_provider_check CHECK
      (format<>'ONLINE' OR manual_join_url IS NOT NULL OR (meeting_provider IS NOT NULL AND external_meeting_id IS NOT NULL))`);
};
exports.down = () => {
  throw new Error(
    'Manual meeting links require explicit data reconciliation before rollback; no destructive down migration',
  );
};
