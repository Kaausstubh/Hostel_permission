/**
 * High-performance HTTP/HTTPS API Client for Load Testing
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

const httpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 500,
  maxFreeSockets: 100,
  timeout: 30000,
});

const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 500,
  maxFreeSockets: 100,
  timeout: 30000,
  rejectUnauthorized: false,
});

class ApiClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  request({ method = 'GET', endpoint = '/', token = null, body = null, headers = {}, timeout = 25000 }) {
    return new Promise((resolve) => {
      const fullUrl = new URL(this.baseUrl + endpoint);
      const isHttps = fullUrl.protocol === 'https:';
      const transport = isHttps ? https : http;
      const agent = isHttps ? httpsAgent : httpAgent;

      const reqHeaders = {
        Accept: 'application/json',
        Connection: 'keep-alive',
        'User-Agent': 'Heimdall-LoadTester/2.0',
        ...headers,
      };

      let payload = null;
      if (body) {
        payload = typeof body === 'string' ? body : JSON.stringify(body);
        reqHeaders['Content-Type'] = 'application/json';
        reqHeaders['Content-Length'] = Buffer.byteLength(payload);
      }

      if (token) {
        reqHeaders['Authorization'] = `Bearer ${token}`;
      }

      const options = {
        protocol: fullUrl.protocol,
        hostname: fullUrl.hostname,
        port: fullUrl.port || (isHttps ? 443 : 80),
        path: fullUrl.pathname + fullUrl.search,
        method: method.toUpperCase(),
        headers: reqHeaders,
        agent,
        timeout,
      };

      const start = process.hrtime.bigint();

      const req = transport.request(options, (res) => {
        let rawData = '';
        res.on('data', (chunk) => {
          rawData += chunk;
        });

        res.on('end', () => {
          const end = process.hrtime.bigint();
          const durationMs = Number(end - start) / 1e6;

          let json = null;
          try {
            json = JSON.parse(rawData);
          } catch {
            json = null;
          }

          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 400,
            status: res.statusCode,
            statusText: res.statusMessage,
            durationMs,
            data: json,
            rawData,
            headers: res.headers,
            endpoint: `${method.toUpperCase()} ${endpoint}`,
          });
        });
      });

      req.on('timeout', () => {
        req.destroy();
        const end = process.hrtime.bigint();
        resolve({
          ok: false,
          status: 408,
          statusText: 'Request Timeout',
          durationMs: Number(end - start) / 1e6,
          data: null,
          rawData: 'Timeout',
          error: 'TIMEOUT',
          endpoint: `${method.toUpperCase()} ${endpoint}`,
        });
      });

      req.on('error', (err) => {
        const end = process.hrtime.bigint();
        resolve({
          ok: false,
          status: 0,
          statusText: err.code || 'Network Error',
          durationMs: Number(end - start) / 1e6,
          data: null,
          rawData: err.message,
          error: err.code || err.message,
          endpoint: `${method.toUpperCase()} ${endpoint}`,
        });
      });

      if (payload) {
        req.write(payload);
      }
      req.end();
    });
  }

  get(endpoint, opts = {}) {
    return this.request({ ...opts, method: 'GET', endpoint });
  }

  post(endpoint, body = null, opts = {}) {
    return this.request({ ...opts, method: 'POST', endpoint, body });
  }

  put(endpoint, body = null, opts = {}) {
    return this.request({ ...opts, method: 'PUT', endpoint, body });
  }

  patch(endpoint, body = null, opts = {}) {
    return this.request({ ...opts, method: 'PATCH', endpoint, body });
  }

  delete(endpoint, opts = {}) {
    return this.request({ ...opts, method: 'DELETE', endpoint });
  }
}

module.exports = ApiClient;
