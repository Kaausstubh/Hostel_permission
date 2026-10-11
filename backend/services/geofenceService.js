/**
 * Geofence Service
 * Robust server-side point-in-polygon and geodesic buffer distance calculations.
 * Completely zero external dependencies, highly performant and deterministic.
 */

const HostelGeofence = require('../models/HostelGeofence');
const mongoose = require('mongoose');
const logger = require('../utils/logger');

const EARTH_RADIUS_METERS = 6371000;

/**
 * Convert lat/lng to radians
 */
const toRad = (deg) => (deg * Math.PI) / 180;

/**
 * Calculate Great-Circle distance between two points in meters using Haversine formula
 */
const haversineDistanceMeters = (lat1, lng1, lat2, lng2) => {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
};

/**
 * Standard Ray-Casting algorithm for point-in-polygon test.
 * @param {{lat: number, lng: number}} point
 * @param {Array<{lat: number, lng: number}>} polygon
 * @returns {boolean} true if strictly inside
 */
const isPointInPolygon = (point, polygon) => {
  if (!polygon || polygon.length < 3) return false;
  const { lat, lng } = point;
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lng;
    const yi = polygon[i].lat;
    const xj = polygon[j].lng;
    const yj = polygon[j].lat;

    const intersect =
      yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }

  return inside;
};

/**
 * Projects points locally onto a metric Cartesian plane centered at centroid
 * to calculate exact minimum distance from point to polygon perimeter.
 * @param {{lat: number, lng: number}} point
 * @param {Array<{lat: number, lng: number}>} polygon
 * @returns {number} distance in meters to nearest edge
 */
const distanceToPolygonMeters = (point, polygon) => {
  if (!polygon || polygon.length < 2) return Infinity;

  // Origin for equirectangular flat projection
  const originLat = point.lat;
  const cosLat = Math.cos(toRad(originLat));

  const toXY = (p) => ({
    x: toRad(p.lng) * EARTH_RADIUS_METERS * cosLat,
    y: toRad(p.lat) * EARTH_RADIUS_METERS,
  });

  const pt = toXY(point);
  let minDistance = Infinity;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = toXY(polygon[j]);
    const b = toXY(polygon[i]);

    // Distance from pt to segment a-b
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const segLengthSq = abx * abx + aby * aby;

    let dist;
    if (segLengthSq === 0) {
      // Segment is a single point
      const dx = pt.x - a.x;
      const dy = pt.y - a.y;
      dist = Math.hypot(dx, dy);
    } else {
      // Projection factor t of pt onto line a-b
      const t = Math.max(0, Math.min(1, ((pt.x - a.x) * abx + (pt.y - a.y) * aby) / segLengthSq));
      const projX = a.x + t * abx;
      const projY = a.y + t * aby;
      dist = Math.hypot(pt.x - projX, pt.y - projY);
    }

    if (dist < minDistance) {
      minDistance = dist;
    }
  }

  return minDistance;
};

/**
 * Validates whether GPS coordinates are inside a hostel's geofence,
 * accounting for indoor GPS drift buffer and accuracy threshold.
 *
 * @param {string} hostel
 * @param {{lat: number, lng: number, accuracy: number}} coords
 * @returns {Promise<{
 *   valid: boolean,
 *   reason?: string,
 *   strictlyInside: boolean,
 *   withinBuffer: boolean,
 *   distanceToEdgeMeters: number,
 *   accuracy: number
 * }>}
 */
const verifyHostelGeofence = async (hostel, coords, overrideGeofence = null) => {
  const { lat, lng, accuracy } = coords || {};

  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return {
      valid: false,
      reason: 'INVALID_COORDINATES',
      strictlyInside: false,
      withinBuffer: false,
      distanceToEdgeMeters: Infinity,
      accuracy: accuracy || null,
    };
  }

  let geofence = overrideGeofence;
  if (!geofence && mongoose.connection.readyState === 1) {
    try {
      geofence = await HostelGeofence.findOne({ hostel: (hostel || '').toUpperCase(), active: true }).lean();
    } catch (err) {
      logger.warn('[Geofence] Failed to query hostel geofence:', err.message);
    }
  }

  const hasCenter = geofence && geofence.center && typeof geofence.center.lat === 'number';
  const hasPolygon = geofence && Array.isArray(geofence.polygon) && geofence.polygon.length >= 3;

  if (!geofence || (!hasCenter && !hasPolygon)) {
    logger.warn('[Geofence] No active geofence configured for hostel', { hostel });
    return {
      valid: true,
      reason: 'NO_GEOFENCE_CONFIGURED',
      strictlyInside: true,
      withinBuffer: true,
      distanceToEdgeMeters: 0,
      accuracy,
    };
  }

  const bufferMeters = geofence.buffer_m ?? 0;
  const accuracyThreshold = geofence.accuracy_threshold_m ?? 50;
  const radiusMeters = geofence.radius_m ?? 50;

  // 1. Accuracy Check
  if (typeof accuracy === 'number' && accuracy > accuracyThreshold) {
    return {
      valid: false,
      reason: 'LOW_GPS_ACCURACY',
      strictlyInside: false,
      withinBuffer: false,
      distanceToEdgeMeters: null,
      accuracy,
    };
  }

  // 2. Center + Radius Check (50m circle around hostel center)
  if (hasCenter) {
    const distToCenter = haversineDistanceMeters(lat, lng, geofence.center.lat, geofence.center.lng);
    const strictlyInside = distToCenter <= radiusMeters;
    const withinBuffer = distToCenter <= radiusMeters + bufferMeters;

    if (strictlyInside) {
      return {
        valid: true,
        strictlyInside: true,
        withinBuffer: true,
        distanceToEdgeMeters: Math.max(0, distToCenter - radiusMeters),
        distanceToCenterMeters: Math.round(distToCenter * 10) / 10,
        accuracy,
      };
    }

    if (withinBuffer) {
      return {
        valid: true,
        strictlyInside: false,
        withinBuffer: true,
        distanceToEdgeMeters: Math.round((distToCenter - radiusMeters) * 10) / 10,
        distanceToCenterMeters: Math.round(distToCenter * 10) / 10,
        accuracy,
      };
    }

    return {
      valid: false,
      reason: 'OUTSIDE_GEOFENCE',
      strictlyInside: false,
      withinBuffer: false,
      distanceToEdgeMeters: Math.round((distToCenter - radiusMeters) * 10) / 10,
      distanceToCenterMeters: Math.round(distToCenter * 10) / 10,
      accuracy,
    };
  }

  // 3. Point-in-polygon check fallback
  const strictlyInside = isPointInPolygon({ lat, lng }, geofence.polygon);
  const distanceToEdge = distanceToPolygonMeters({ lat, lng }, geofence.polygon);

  if (strictlyInside) {
    return {
      valid: true,
      strictlyInside: true,
      withinBuffer: true,
      distanceToEdgeMeters: distanceToEdge,
      accuracy,
    };
  }

  // 4. Absorbing drift with buffer
  const withinBuffer = distanceToEdge <= bufferMeters;
  if (withinBuffer) {
    return {
      valid: true,
      strictlyInside: false,
      withinBuffer: true,
      distanceToEdgeMeters: distanceToEdge,
      accuracy,
    };
  }

  return {
    valid: false,
    reason: 'OUTSIDE_GEOFENCE',
    strictlyInside: false,
    withinBuffer: false,
    distanceToEdgeMeters: distanceToEdge,
    accuracy,
  };
};


module.exports = {
  isPointInPolygon,
  distanceToPolygonMeters,
  haversineDistanceMeters,
  verifyHostelGeofence,
};
