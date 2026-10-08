const { escapeValue } = require('node-pg-migrate');

exports.up = async (pgm) => {
  // The runner's transaction keeps the snapshot/backfill and schema removal atomic.
  // Lock first so an older application cannot write between the backfill and DROP.
  await pgm.db.query(`LOCK TABLE meetings, meeting_provider_operations,
    meeting_provider_cleanup, meeting_calendar_links, provider_connections
    IN ACCESS EXCLUSIVE MODE`);
  const { rows } = await pgm.db.query(`SELECT m.id, o.join_url
    FROM meetings m JOIN meeting_provider_operations o
      ON o.creator_id=m.creator_id AND o.request_id=m.create_request_id
    WHERE m.format='ONLINE' AND m.status<>'CANCELLED'
      AND m.manual_join_url IS NULL AND o.phase='COMPLETED'
      AND NOT EXISTS(SELECT 1 FROM meeting_provider_cleanup c WHERE c.meeting_id=m.id)`);
  for (const row of rows) {
    if (typeof row.join_url !== 'string') continue;
    let url;
    try {
      url = new URL(row.join_url);
    } catch {
      continue;
    }
    // Match the existing frontend link guard. Hidden/unsafe links stay absent.
    if (url.protocol !== 'https:' || url.username || url.password) continue;
    // Keep ordinary stored URLs verbatim; normalize only legacy HTTPS spelling
    // that cannot satisfy the existing manual-link database constraint.
    const link = /^https:\/\//.test(row.join_url) ? row.join_url : url.href;
    pgm.sql(
      `UPDATE meetings SET manual_join_url=${escapeValue(link)} WHERE id=${escapeValue(row.id)}`,
    );
  }
  pgm.sql(`ALTER TABLE meetings DROP CONSTRAINT meetings_online_provider_check;
    ALTER TABLE meetings DROP COLUMN meeting_provider, DROP COLUMN external_meeting_id;
    DROP TABLE meeting_calendar_links;
    DROP TABLE meeting_provider_cleanup;
    DROP TABLE meeting_provider_operations;
    DROP TABLE provider_connections;`);
};

exports.down = () => {
  throw new Error(
    'Provider storage removal is irreversible; restore an approved pre-migration backup and matching application instead of recreating empty history',
  );
};
