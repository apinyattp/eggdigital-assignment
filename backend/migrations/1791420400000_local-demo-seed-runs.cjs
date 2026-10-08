exports.up = (pgm) => {
  pgm.sql(`CREATE TABLE local_demo_seed_runs (
    dataset_key text PRIMARY KEY,
    fixture_version text NOT NULL,
    manifest_sha256 text NOT NULL CHECK(manifest_sha256 ~ '^[0-9a-f]{64}$'),
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
};
exports.down = (pgm) => {
  pgm.sql('DROP TABLE local_demo_seed_runs');
};
