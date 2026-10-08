exports.up = (pgm) => {
  pgm.sql(`ALTER TABLE meetings DROP CONSTRAINT meetings_status_check;
    ALTER TABLE meetings ADD CONSTRAINT meetings_status_check CHECK(status IN ('PENDING','CONFIRMED','REJECTED','CANCELLED'));`);
};
exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE meetings DROP CONSTRAINT meetings_status_check;
    ALTER TABLE meetings ADD CONSTRAINT meetings_status_check CHECK(status IN ('PENDING','CONFIRMED','REJECTED'));`);
};
