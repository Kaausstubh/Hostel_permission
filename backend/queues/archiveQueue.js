/**
 * Archive Queue & BullMQ Worker
 * Asynchronously processes monthly archival jobs off the main HTTP request path.
 */

const IORedis = require('ioredis');
const { Queue, Worker } = require('bullmq');
const { processArchiveJob } = require('../services/archiveService');
const logger = require('../utils/logger');

const QUEUE_NAME = 'archive-jobs';
const REDIS_URL = process.env.REDIS_URL || '';

let queue;
let worker;
let connection;

const hasQueueInfra = () => Boolean(REDIS_URL);

const getConnection = () => {
  if (!hasQueueInfra()) return null;
  if (connection) return connection;
  connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: true });
  connection.on('error', (err) => logger.error('[Archive Queue] Redis connection error:', { error: err.message }));
  return connection;
};

const getQueue = () => {
  if (!hasQueueInfra()) return null;
  if (queue) return queue;
  queue = new Queue(QUEUE_NAME, { connection: getConnection() });
  return queue;
};

/**
 * Enqueue an archive job for a collection & yearMonth string (e.g. 2026-01)
 */
const enqueueArchiveJob = async ({ collectionName, yearMonthStr, userId = null }) => {
  if (!hasQueueInfra()) {
    logger.info('[Archive Queue] No Redis queue infra — running archive job synchronously', { collectionName, yearMonthStr });
    return processArchiveJob({ collectionName, yearMonthStr, userId });
  }

  const q = getQueue();
  const jobId = `${collectionName}-${yearMonthStr}`;

  return q.add(
    'process-archive',
    { collectionName, yearMonthStr, userId },
    {
      jobId,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 200,
      removeOnFail: 500,
    }
  );
};

/**
 * Start the BullMQ Archive Worker
 */
const startArchiveWorker = () => {
  if (!hasQueueInfra() || worker) return;

  worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      logger.info(`[Archive Worker] Processing job ${job.id}`, job.data);
      return processArchiveJob(job.data);
    },
    { connection: getConnection() }
  );

  worker.on('failed', (job, err) => {
    logger.error(`[Archive Worker] Job ${job?.id} failed:`, { error: err.message });
  });

  worker.on('completed', (job) => {
    logger.info(`[Archive Worker] Job ${job.id} completed successfully`);
  });

  logger.info('📦 BullMQ Archive Worker initialized');
};

module.exports = {
  hasQueueInfra,
  enqueueArchiveJob,
  startArchiveWorker,
};
