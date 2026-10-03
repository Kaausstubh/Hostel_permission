/**
 * MongoDB Performance & Inspection Monitor
 */

const mongoose = require('mongoose');

class DbMonitor {
  constructor(mongoUri) {
    this.mongoUri = mongoUri;
    this.connection = null;
  }

  async connect() {
    if (mongoose.connection.readyState === 1) {
      this.connection = mongoose.connection;
      return this.connection;
    }
    await mongoose.connect(this.mongoUri, {
      maxPoolSize: 100,
      serverSelectionTimeoutMS: 5000,
    });
    this.connection = mongoose.connection;
    return this.connection;
  }

  async inspect() {
    try {
      await this.connect();
      const db = this.connection.db;

      // Server status
      let serverStatus = null;
      try {
        serverStatus = await db.command({ serverStatus: 1 });
      } catch {
        // May fail on restricted cloud Atlas users
      }

      // Collections inspection
      const collections = await db.listCollections().toArray();
      const collStats = {};
      const indexMap = {};

      for (const col of collections) {
        const name = col.name;
        const count = await db.collection(name).countDocuments();
        const indexes = await db.collection(name).indexes();
        collStats[name] = { count };
        indexMap[name] = indexes.map((idx) => ({
          name: idx.name,
          key: idx.key,
          unique: Boolean(idx.unique),
          sparse: Boolean(idx.sparse),
        }));
      }

      // Benchmark queries
      const benchmarks = await this.runBenchmarks();

      return {
        connected: true,
        dbName: db.databaseName,
        collections: collStats,
        indexes: indexMap,
        connections: {
          current: serverStatus?.connections?.current || 'N/A (Managed/Local)',
          available: serverStatus?.connections?.available || 'N/A',
          totalCreated: serverStatus?.connections?.totalCreated || 'N/A',
        },
        benchmarks,
      };
    } catch (err) {
      return {
        connected: false,
        error: err.message,
      };
    }
  }

  async runBenchmarks() {
    const db = this.connection.db;
    const benchmarks = {};

    // 1. User lookup by ID
    const sampleUser = await db.collection('users').findOne({ role: 'student' });
    if (sampleUser) {
      const s = process.hrtime.bigint();
      await db.collection('users').findOne({ _id: sampleUser._id });
      const e = process.hrtime.bigint();
      benchmarks.userByIdMs = Number(e - s) / 1e6;

      // 2. User lookup by email
      const s2 = process.hrtime.bigint();
      await db.collection('users').findOne({ email: sampleUser.email });
      const e2 = process.hrtime.bigint();
      benchmarks.userByEmailMs = Number(e2 - s2) / 1e6;
    }

    // 3. InOutLog recent today scan
    const s3 = process.hrtime.bigint();
    await db
      .collection('inoutlogs')
      .find({ status: 'OUT', returned: false })
      .sort({ timestamp: -1 })
      .limit(50)
      .toArray();
    const e3 = process.hrtime.bigint();
    benchmarks.activeOutQueryMs = Number(e3 - s3) / 1e6;

    // 4. Dashboard aggregate
    const s4 = process.hrtime.bigint();
    const [totalStudents, outNow, pendingLeaves, openComplaints] = await Promise.all([
      db.collection('users').countDocuments({ role: 'student' }),
      db.collection('inoutlogs').countDocuments({ status: 'OUT', returned: false }),
      db.collection('homevisitlogs').countDocuments({ overall_status: 'pending' }),
      db.collection('complaints').countDocuments({ status: 'pending' }),
    ]);
    const e4 = process.hrtime.bigint();
    benchmarks.dashboardAggregateMs = Number(e4 - s4) / 1e6;
    benchmarks.counts = { totalStudents, outNow, pendingLeaves, openComplaints };

    return benchmarks;
  }

  async disconnect() {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  }
}

module.exports = DbMonitor;
