exports.up = (pgm) => {
  pgm.sql('ALTER TABLE meetings ADD COLUMN preparation_notes text DEFAULT NULL');
};
exports.down = (pgm) => {
  pgm.sql('ALTER TABLE meetings DROP COLUMN preparation_notes');
};
