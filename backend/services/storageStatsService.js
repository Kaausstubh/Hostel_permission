/**
 * Storage Stats & Log Deletion Audit Service
 * Calculates collection storage usage, quota percentages, and manages audit trails.
 */
const mongoose = require('mongoose');
const InOutLog = require('../models/InOutLog');
const HomeVisitLog = require('../models/HomeVisitLog');
const LogDeletionAudit = require('../models/LogDeletionAudit');
const logger = require('../utils/logger');

const DEFAULT_QUOTA_MB = parseInt(process.env.LOGS_STORAGE_QUOTA_MB || '500', 10); // 500 MB total quota (400 MB is 80%)
const WARNING_THRESHOLD_MB = 400; // 400 MB threshold
const WARNING_THRESHOLD_PERCENT = 80; // 80% threshold
const BYTES_PER_MB = 1024 * 1024;

// ⚡ High-speed in-memory cache to prevent repeated database commands
let cachedStats = null;
let lastCacheTimestamp = 0;
const CACHE_TTL_MS = 30 * 1000; // 30s cache

const invalidateStorageCache = () => {
  cachedStats = null;
  lastCacheTimestamp = 0;
};

const formatBytes = (bytes) => {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
};

/**
 * Record a deletion audit entry when staff purges or deletes records
 */
const recordDeletionAudit = async ({
  user,
  action,
  targetType,
  deletedCount = 1,
  description = '',
  metadata = {},
}) => {
  try {
    invalidateStorageCache();
    const audit = await LogDeletionAudit.create({
      deletedBy: user?._id || null,
      deletedByName: user?.name || user?.rollNo || user?.email || 'Authorized Staff',
      deletedByEmail: user?.email || '',
      deletedByRole: user?.role === 'warden' ? 'HOSTEL STAFF' : (user?.role ? user.role.toUpperCase() : 'HOSTEL STAFF'),
      action,
      targetType,
      deletedCount: Number(deletedCount) || 0,
      description,
      metadata,
      timestamp: new Date(),
    });

    logger.info('[Audit] Log deletion recorded', {
      action,
      targetType,
      deletedCount,
      by: user?.email,
      name: user?.name,
    });

    return audit;
  } catch (err) {
    logger.error('[Audit] Failed to record log deletion audit', { error: err.message });
    return null;
  }
};

/**
 * Get comprehensive log memory stats, quota percent, and deletion history
 */
const getStorageStats = async ({ forceRefresh = false } = {}) => {
  if (!forceRefresh && cachedStats && (Date.now() - lastCacheTimestamp < CACHE_TTL_MS)) {
    return cachedStats;
  }
  const [inOutCount, homeVisitCount] = await Promise.all([
    InOutLog.countDocuments().maxTimeMS(5000),
    HomeVisitLog.countDocuments().maxTimeMS(5000),
  ]);

  let inOutSizeBytes = 0;
  let homeSizeBytes = 0;

  // Try retrieving collection stats directly from MongoDB
  try {
    if (mongoose.connection?.db) {
      const db = mongoose.connection.db;
      try {
        const inOutStats = await db.command({ collStats: InOutLog.collection.name });
        inOutSizeBytes = inOutStats.size || inOutStats.storageSize || 0;
      } catch {
        // Fallback to estimated ~500 bytes per denormalized InOutLog
        inOutSizeBytes = inOutCount * 500;
      }

      try {
        const homeStats = await db.command({ collStats: HomeVisitLog.collection.name });
        homeSizeBytes = homeStats.size || homeStats.storageSize || 0;
      } catch {
        // Fallback to estimated ~880 bytes per HomeVisitLog
        homeSizeBytes = homeVisitCount * 880;
      }
    }
  } catch {
    inOutSizeBytes = inOutCount * 500;
    homeSizeBytes = homeVisitCount * 880;
  }

  // Ensure minimum realistic memory allocation
  if (inOutCount > 0 && inOutSizeBytes === 0) inOutSizeBytes = inOutCount * 500;
  if (homeVisitCount > 0 && homeSizeBytes === 0) homeSizeBytes = homeVisitCount * 880;

  const totalLogsCount = inOutCount + homeVisitCount;
  const totalSizeBytes = inOutSizeBytes + homeSizeBytes;

  const quotaBytes = DEFAULT_QUOTA_MB * BYTES_PER_MB;
  const percentUsed = Math.min(100, Math.max(0, (totalSizeBytes / quotaBytes) * 100));
  const roundedPercent = Number(percentUsed.toFixed(2));
  const isOver80Percent = roundedPercent >= 80 || totalSizeBytes >= (WARNING_THRESHOLD_MB * BYTES_PER_MB);

  let alertLevel = 'HEALTHY';
  let alertMessage = `Memory healthy: ${roundedPercent}% of ${DEFAULT_QUOTA_MB} MB storage quota used.`;

  if (roundedPercent >= 90) {
    alertLevel = 'CRITICAL';
    alertMessage = `CRITICAL STORAGE ALERT: Logs occupy ${roundedPercent}% (${formatBytes(totalSizeBytes)}) of ${DEFAULT_QUOTA_MB} MB limit! Purge or export old logs immediately to avoid storage exhaustion.`;
  } else if (isOver80Percent) {
    alertLevel = 'WARNING';
    alertMessage = `STORAGE LIMIT ALERT: Memory reached 80% (≥400 MB) of ${DEFAULT_QUOTA_MB} MB storage capacity! Action required to purge older logs.`;
  }

  // Fetch recent deletion audits
  const recentAudits = await LogDeletionAudit.find()
    .sort({ timestamp: -1 })
    .limit(20)
    .lean()
    .maxTimeMS(5000);

  return {
    inOut: {
      count: inOutCount,
      sizeBytes: inOutSizeBytes,
      sizeFormatted: formatBytes(inOutSizeBytes),
    },
    homeVisit: {
      count: homeVisitCount,
      sizeBytes: homeSizeBytes,
      sizeFormatted: formatBytes(homeSizeBytes),
    },
    total: {
      count: totalLogsCount,
      sizeBytes: totalSizeBytes,
      sizeFormatted: formatBytes(totalSizeBytes),
      quotaBytes,
      quotaFormatted: `${DEFAULT_QUOTA_MB} MB`,
      percentUsed: roundedPercent,
      alertLevel,
      alertMessage,
      isAlert: isOver80Percent || alertLevel !== 'HEALTHY',
      isOver80Percent,
      warningThresholdMB: WARNING_THRESHOLD_MB,
      warningThresholdPercent: WARNING_THRESHOLD_PERCENT,
    },
    recentAudits: recentAudits.map((a) => ({
      _id: a._id,
      deletedByName: a.deletedByName || 'Authorized Staff',
      deletedByEmail: a.deletedByEmail || '',
      deletedByRole: String(a.deletedByRole || 'HOSTEL STAFF').toUpperCase().replace(/WARDEN/gi, 'HOSTEL STAFF'),
      action: a.action,
      targetType: a.targetType,
      deletedCount: a.deletedCount,
      description: a.description,
      timestamp: a.timestamp,
    })),
  };

  cachedStats = result;
  lastCacheTimestamp = Date.now();
  return result;
};

module.exports = {
  recordDeletionAudit,
  getStorageStats,
  formatBytes,
};
