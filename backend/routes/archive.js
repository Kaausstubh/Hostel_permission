/**
 * Archive Management & Historical Retrieval Routes
 * Restricted strictly to authorized Admin & Warden users.
 *
 * GET  /api/archive/status            - Summary metrics (total archived, storage saved, last run)
 * GET  /api/archive/jobs              - List archive job manifests (paginated)
 * POST /api/archive/trigger           - Manually enqueue an archival job
 * POST /api/archive/retrieve          - Search historical records in Cloudflare R2
 * GET  /api/archive/download-url/:id  - Get 15-min signed download URL
 * GET  /api/archive/audit-logs        - View archival audit trail
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');

const { protect, authorize } = require('../middleware/auth');
const ArchiveJob = require('../models/ArchiveJob');
const AuditLog = require('../models/AuditLog');
const {
  processArchiveJob,
  getEligibleArchiveMonths,
  searchArchivedRecords,
  logAudit,
} = require('../services/archiveService');
const { enqueueArchiveJob } = require('../queues/archiveQueue');
const { getPresignedDownloadUrl, hasR2Credentials } = require('../services/r2Service');
const logger = require('../utils/logger');

// ── All archive routes require authentication + Warden/Admin role ─────────────
router.use(protect, authorize('warden', 'admin'));

// ── GET /status ───────────────────────────────────────────────────────────────
router.get('/status', async (req, res) => {
  try {
    const retentionMonths = parseInt(process.env.ARCHIVE_RETENTION_MONTHS || '3', 10);
    const archiveEnabled = (process.env.ARCHIVE_ENABLED ?? 'true') !== 'false';
    const cronSchedule = process.env.ARCHIVE_CRON || '0 2 1 * *';

    const [completedJobs, lastCompleted, totalJobsCount] = await Promise.all([
      ArchiveJob.find({ status: 'COMPLETED' }).lean(),
      ArchiveJob.findOne({ status: 'COMPLETED' }).sort({ completedAt: -1 }).lean(),
      ArchiveJob.countDocuments(),
    ]);

    const totalRecordsArchived = completedJobs.reduce((acc, j) => acc + (j.recordCount || 0), 0);
    const totalCompressedSize = completedJobs.reduce((acc, j) => acc + (j.compressedSize || 0), 0);

    const eligibleMonths = getEligibleArchiveMonths(retentionMonths);

    res.json({
      success: true,
      enabled: archiveEnabled,
      retentionMonths,
      cronSchedule,
      hasR2Credentials: hasR2Credentials(),
      summary: {
        totalArchiveJobs: totalJobsCount,
        totalRecordsArchived,
        totalCompressedSizeBytes: totalCompressedSize,
        totalCompressedSizeMB: (totalCompressedSize / (1024 * 1024)).toFixed(2),
        lastSuccessfulArchive: lastCompleted
          ? {
              archiveId: lastCompleted.archiveId,
              collectionName: lastCompleted.collectionName,
              recordCount: lastCompleted.recordCount,
              compressedSize: lastCompleted.compressedSize,
              completedAt: lastCompleted.completedAt,
            }
          : null,
        eligibleMonths,
      },
    });
  } catch (err) {
    logger.error('[Archive Route] Failed to get status', { error: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /jobs ─────────────────────────────────────────────────────────────────
router.get('/jobs', async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 1), 100);
    const skip = (page - 1) * limit;

    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.collectionName) filter.collectionName = req.query.collectionName;

    const [jobs, count] = await Promise.all([
      ArchiveJob.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      ArchiveJob.countDocuments(filter),
    ]);

    res.json({
      success: true,
      count,
      page,
      limit,
      jobs,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /trigger ─────────────────────────────────────────────────────────────
router.post('/trigger', async (req, res) => {
  try {
    const { collectionName, yearMonthStr, synchronous = false } = req.body;

    if (!collectionName || !['InOutLog', 'HomeVisitLog', 'Complaint'].includes(collectionName)) {
      return res.status(400).json({
        success: false,
        message: 'collectionName must be one of: InOutLog, HomeVisitLog, Complaint',
      });
    }

    if (!yearMonthStr || !/^\d{4}-\d{2}$/.test(yearMonthStr)) {
      return res.status(400).json({
        success: false,
        message: 'yearMonthStr must be in YYYY-MM format (e.g. 2026-01)',
      });
    }

    if (synchronous) {
      const job = await processArchiveJob({
        collectionName,
        yearMonthStr,
        userId: req.user._id,
      });
      return res.json({
        success: true,
        message: 'Archival job processed synchronously',
        job,
      });
    }

    await enqueueArchiveJob({
      collectionName,
      yearMonthStr,
      userId: req.user._id,
    });

    res.json({
      success: true,
      message: `Archival job for ${collectionName} (${yearMonthStr}) enqueued successfully`,
    });
  } catch (err) {
    logger.error('[Archive Route] Manual trigger failed', { error: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /retrieve ────────────────────────────────────────────────────────────
router.post('/retrieve', async (req, res) => {
  try {
    const { yearMonthStr, collectionName, searchTarget } = req.body;

    if (!yearMonthStr || !/^\d{4}-\d{2}$/.test(yearMonthStr)) {
      return res.status(400).json({
        success: false,
        message: 'yearMonthStr must be in YYYY-MM format',
      });
    }

    if (!collectionName || !['InOutLog', 'HomeVisitLog', 'Complaint'].includes(collectionName)) {
      return res.status(400).json({
        success: false,
        message: 'collectionName must be one of: InOutLog, HomeVisitLog, Complaint',
      });
    }

    const searchResult = await searchArchivedRecords({
      yearMonthStr,
      collectionName,
      searchTarget,
      userId: req.user._id,
    });

    res.json({
      success: true,
      ...searchResult,
    });
  } catch (err) {
    logger.error('[Archive Route] Historical retrieval failed', { error: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /download-url/:id ─────────────────────────────────────────────────────
router.get('/download-url/:id', async (req, res) => {
  try {
    const job = await ArchiveJob.findById(req.params.id).lean();
    if (!job) return res.status(404).json({ success: false, message: 'Archive job manifest not found' });

    if (job.status !== 'COMPLETED' && job.status !== 'VERIFIED') {
      return res.status(400).json({
        success: false,
        message: `Cannot generate download URL for job in '${job.status}' status`,
      });
    }

    const downloadUrl = await getPresignedDownloadUrl(job.storageKey, 900); // 15 minutes TTL

    await logAudit('ARCHIVE_RETRIEVED', {
      archiveId: job.archiveId,
      collectionName: job.collectionName,
      recordCount: job.recordCount,
      userId: req.user._id,
      details: { action: 'DOWNLOAD_URL_GENERATED' },
    });

    res.json({
      success: true,
      archiveId: job.archiveId,
      storageKey: job.storageKey,
      expiresInSeconds: 900,
      downloadUrl,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /local-download (Dev fallback signed download handler) ────────────────
router.get('/local-download', async (req, res) => {
  try {
    const key = req.query.key;
    if (!key) return res.status(400).send('Key required');

    // Prevent path traversal
    const safeKey = path.normalize(key).replace(/^(\.\.[\/\\])+/, '');
    const filePath = path.join(__dirname, '..', 'public', 'archives', safeKey);

    if (!fs.existsSync(filePath)) {
      return res.status(404).send('File not found');
    }

    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(safeKey)}"`);
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// ── GET /audit-logs ───────────────────────────────────────────────────────────
router.get('/audit-logs', async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '30', 10), 1), 100);
    const skip = (page - 1) * limit;

    const [logs, count] = await Promise.all([
      AuditLog.find()
        .populate('userId', 'name role email')
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      AuditLog.countDocuments(),
    ]);

    res.json({
      success: true,
      count,
      page,
      limit,
      logs,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
