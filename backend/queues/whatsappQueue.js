/**
 * WhatsApp Queue
 * Offloads WhatsApp send operations from request path.
 */

const IORedis = require('ioredis');
const { Queue, Worker } = require('bullmq');
const { sendWhatsAppMessage, sendWhatsAppMediaMessage } = require('../services/whatsappService');

const QUEUE_NAME = 'whatsapp-jobs';
const REDIS_URL = process.env.REDIS_URL || '';

let queue;
let worker;
let connection;

const hasQueueInfra = () => Boolean(REDIS_URL);

const getConnection = () => {
  if (!hasQueueInfra()) return null;
  if (connection) return connection;
  connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: true });
  connection.on('error', (err) => console.error('Queue Redis error:', err.message));
  return connection;
};

const getQueue = () => {
  if (!hasQueueInfra()) return null;
  if (queue) return queue;
  queue = new Queue(QUEUE_NAME, { connection: getConnection() });
  return queue;
};

const enqueueWhatsAppMessage = async ({ to, body }) => {
  if (!hasQueueInfra()) return sendWhatsAppMessage(to, body);
  const q = getQueue();
  return q.add('text', { to, body }, { attempts: 3, backoff: { type: 'exponential', delay: 1000 }, removeOnComplete: 100 });
};

const enqueueWhatsAppMediaMessage = async ({ to, mediaUrl, qrDataUrl, caption }) => {
  if (!hasQueueInfra()) return sendWhatsAppMediaMessage(to, mediaUrl, qrDataUrl, caption);
  const q = getQueue();
  return q.add(
    'media',
    { to, mediaUrl, qrDataUrl, caption },
    { attempts: 3, backoff: { type: 'exponential', delay: 1000 }, removeOnComplete: 100 }
  );
};

const startWhatsAppWorker = () => {
  if (!hasQueueInfra() || worker) return;
  worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      if (job.name === 'text') {
        return sendWhatsAppMessage(job.data.to, job.data.body);
      }
      if (job.name === 'media') {
        return sendWhatsAppMediaMessage(job.data.to, job.data.mediaUrl, job.data.qrDataUrl, job.data.caption);
      }
      throw new Error(`Unsupported WhatsApp job type: ${job.name}`);
    },
    { connection: getConnection() }
  );
  worker.on('failed', (job, err) => {
    console.error(`WhatsApp job failed (${job?.id}):`, err.message);
  });
  worker.on('completed', (job) => {
    if (process.env.NODE_ENV !== 'production') {
      console.log(`WhatsApp job completed (${job.id})`);
    }
  });
};

module.exports = {
  hasQueueInfra,
  enqueueWhatsAppMessage,
  enqueueWhatsAppMediaMessage,
  startWhatsAppWorker,
};
