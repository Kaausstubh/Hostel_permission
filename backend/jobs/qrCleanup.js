/**
 * Removes old QR PNG files from public/qr to control disk use at campus scale.
 */
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const { QR_PNG_RETENTION_DAYS } = require('../config/campus');

const QR_DIR = path.join(__dirname, '..', 'public', 'qr');

const runQrCleanup = async () => {
  if (!fs.existsSync(QR_DIR)) return { deleted: 0, kept: 0 };

  const maxAgeMs = QR_PNG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - maxAgeMs;
  let deleted = 0;
  let kept = 0;

  const files = await fs.promises.readdir(QR_DIR);
  await Promise.all(
    files.map(async (file) => {
      if (!file.endsWith('.png')) return;
      const filePath = path.join(QR_DIR, file);
      try {
        const stat = await fs.promises.stat(filePath);
        if (stat.mtimeMs < cutoff) {
          await fs.promises.unlink(filePath);
          deleted += 1;
        } else {
          kept += 1;
        }
      } catch {
        // ignore missing files
      }
    })
  );

  console.log(`🧹 QR cleanup: deleted ${deleted} file(s), kept ${kept} (retention ${QR_PNG_RETENTION_DAYS}d)`);
  return { deleted, kept };
};

const scheduleQrCleanup = () => {
  cron.schedule('0 3 * * *', () => {
    runQrCleanup().catch((err) => console.error('QR cleanup failed:', err.message));
  });
  console.log('📅 QR PNG cleanup scheduled (daily 03:00)');
};

module.exports = { runQrCleanup, scheduleQrCleanup };
