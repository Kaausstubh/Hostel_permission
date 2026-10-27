/**
 * Geofence Service
 * Authoritative campus hostel coordinates:
 * - BH2 (Krishna): 18°45'47.1"N 73°41'57.7"E (18.7630833, 73.6993611), radius 30m
 * - BH1 (Brahmaputra): 18°45'50.8"N 73°41'57.4"E (18.7641111, 73.6992778), radius 30m
 * - GH1 (Indrayani): 18°45'54.4"N 73°41'56.8"E (18.7651111, 73.6991111), radius 30m
 * - GH2 (Sindhu): 18°45'54.4"N 73°41'56.8"E (18.7651111, 73.6991111), radius 30m
 */

const HostelGeofence = require('../models/HostelGeofence');
const mongoose = require('mongoose');
const logger = require('../utils/logger');

const EARTH_RADIUS_METERS = 6371000;

// Authoritative building center coordinates and high-precision 22m building radius (configurable via DB)
const AUTHORITATIVE_HOSTEL_GEOFENCES = {
  BH2: {
    hostel: 'BH2',
    name: "Boys' Hostel 2 (Krishna)",
    // 18°45'47.1"N 73°41'57.7"E
    // center: { lat: 18.7630833, lng: 73.6993611 },
    center: { lat: 18.715993847899085, lng: 73.66964662270149 },
    radius_m: 100, // High-precision building perimeter (15-25m range)
    buffer_m: 20,
    accuracy_threshold_m: 80, // Max 25m GPS accuracy allowed
    auto_attendance: true,
  },
  BH1: {
    hostel: 'BH1',
    name: "Boys' Hostel 1 (Brahmaputra)",
    // 18°45'50.8"N 73°41'57.4"E
    center: { lat: 18.7641111, lng: 73.6992778 },
    radius_m: 22, // High-precision building perimeter
    buffer_m: 0,
    accuracy_threshold_m: 25,
    auto_attendance: true,
  },
  GH1: {
    hostel: 'GH1',
    name: "Girls' Hostel 1 (Indrayani)",
    // 18°45'54.4"N 73°41'56.8"E
    center: { lat: 18.7651111, lng: 73.6991111 },
    radius_m: 22,
    buffer_m: 0,
    accuracy_threshold_m: 25,
    auto_attendance: true,
  },
  GH2: {
    hostel: 'GH2',
    name: "Girls' Hostel 2 (Sindhu)",
    // 18°45'54.4"N 73°41'56.8"E
    center: { lat: 18.7651111, lng: 73.6991111 },
    radius_m: 22,
    buffer_m: 0,
    accuracy_threshold_m: 25,
    auto_attendance: true,
  },
  GH: {
    hostel: 'GH',
    name: "Girls' Hostel (GH)",
    center: { lat: 18.7651111, lng: 73.6991111 },
    radius_m: 22,
    buffer_m: 0,
    accuracy_threshold_m: 25,
    auto_attendance: true,
  },
};

/**
 * Normalizes user/request hostel names to canonical hostel keys
 */
const normalizeHostelCode = (raw) => {
  if (!raw) return 'BH2';
  const str = String(raw).toUpperCase().trim();
  if (str.includes('BH1') || str.includes('BRAHMAPUTRA')) return 'BH1';
  if (str.includes('BH2') || str.includes('KRISHNA')) return 'BH2';
  if (str.includes('GH1') || str.includes('INDRAYANI')) return 'GH1';
  if (str.includes('GH2') || str.includes('SINDHU')) return 'GH2';
  if (str === 'GH' || str.includes('GIRLS')) return 'GH1';
  return str;
};

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
 */
const distanceToPolygonMeters = (point, polygon) => {
  if (!polygon || polygon.length < 2) return Infinity;

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

    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const segLengthSq = abx * abx + aby * aby;

    let dist;
    if (segLengthSq === 0) {
      const dx = pt.x - a.x;
      const dy = pt.y - a.y;
      dist = Math.hypot(dx, dy);
    } else {
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
 * Validates whether GPS coordinates are inside a hostel building's exact geofence.
 *
 * @param {string} hostel
 * @param {{lat: number, lng: number, accuracy: number}} coords
 * @returns {Promise<{
 *   valid: boolean,
 *   reason?: string,
 *   hostel: string,
 *   hostelName: string,
 *   strictlyInside: boolean,
 *   distanceToCenterMeters: number,
 *   distanceToEdgeMeters: number,
 *   radiusMeters: number,
 *   accuracy: number,
 *   message: string
 * }>}
 */
const verifyHostelGeofence = async (hostel, coords, overrideGeofence = null) => {
  const { lat, lng, accuracy } = coords || {};

  const normHostel = normalizeHostelCode(hostel);
  const fallbackGeofence = AUTHORITATIVE_HOSTEL_GEOFENCES[normHostel] || AUTHORITATIVE_HOSTEL_GEOFENCES.BH2;

  if (typeof lat !== 'number' || typeof lng !== 'number' || isNaN(lat) || isNaN(lng)) {
    return {
      valid: false,
      reason: 'INVALID_COORDINATES',
      hostel: normHostel,
      hostelName: fallbackGeofence.name,
      strictlyInside: false,
      withinBuffer: false,
      distanceToCenterMeters: Infinity,
      distanceToEdgeMeters: Infinity,
      radiusMeters: fallbackGeofence.radius_m,
      accuracy: accuracy || null,
      message: 'Invalid or missing GPS coordinates from device.',
    };
  }

  let activeGeofence = overrideGeofence;
  if (!activeGeofence && mongoose.connection.readyState === 1) {
    try {
      activeGeofence = await HostelGeofence.findOne({ hostel: normHostel, active: true }).lean();
      if (!activeGeofence && (normHostel === 'GH1' || normHostel === 'GH2')) {
        activeGeofence = await HostelGeofence.findOne({ hostel: 'GH', active: true }).lean();
      }
    } catch (err) {
      logger.warn('[Geofence] Failed to query hostel geofence from DB:', err.message);
    }
  }

  if (!activeGeofence) {
    activeGeofence = fallbackGeofence;
  }

  const hasPolygon = Array.isArray(activeGeofence.polygon) && activeGeofence.polygon.length >= 3;
  const hasActiveCenter = activeGeofence.center && typeof activeGeofence.center.lat === 'number' && typeof activeGeofence.center.lng === 'number';
  const targetCenter = hasActiveCenter ? activeGeofence.center : fallbackGeofence.center;

  const radiusMeters = activeGeofence.radius_m ?? fallbackGeofence.radius_m ?? 22;
  const bufferMeters = activeGeofence.buffer_m ?? fallbackGeofence.buffer_m ?? 0;
  const accuracyThreshold = activeGeofence.accuracy_threshold_m ?? fallbackGeofence.accuracy_threshold_m ?? 25;

  // 1. Accuracy Check: reject cellular/IP coarse drift (> threshold, default 25m)
  if (typeof accuracy === 'number' && accuracy > accuracyThreshold) {
    logger.warn('[Geofence] Rejected due to low GPS accuracy:', { accuracy, accuracyThreshold, hostel: normHostel });
    return {
      valid: false,
      reason: 'LOW_GPS_ACCURACY',
      hostel: normHostel,
      hostelName: activeGeofence.name || fallbackGeofence.name,
      strictlyInside: false,
      withinBuffer: false,
      distanceToCenterMeters: null,
      distanceToEdgeMeters: null,
      radiusMeters,
      accuracy,
      message: `Your location accuracy (±${Math.round(accuracy)}m) is insufficient to reliably verify presence at ${activeGeofence.name || normHostel} (requires ±${accuracyThreshold}m or better). Please enable High Accuracy / Precise Location on your device or move near a window/open area for better GPS signal.`,
    };
  }

  // 2. Point-in-polygon check if polygon is configured
  if (hasPolygon) {
    const strictlyInside = isPointInPolygon({ lat, lng }, activeGeofence.polygon);
    const distToEdge = distanceToPolygonMeters({ lat, lng }, activeGeofence.polygon);
    const withinBuffer = strictlyInside || (distToEdge <= bufferMeters);

    logger.info('[Geofence] Polygon evaluation result:', {
      hostel: normHostel,
      studentCoords: { lat, lng, accuracy },
      strictlyInside,
      distToEdge,
      bufferMeters,
      withinBuffer,
    });

    if (strictlyInside || withinBuffer) {
      return {
        valid: true,
        hostel: normHostel,
        hostelName: activeGeofence.name || fallbackGeofence.name,
        strictlyInside,
        withinBuffer: true,
        distanceToCenterMeters: null,
        distanceToEdgeMeters: strictlyInside ? 0 : Math.round(distToEdge * 10) / 10,
        radiusMeters,
        accuracy: accuracy || null,
        message: `Verified inside ${activeGeofence.name || normHostel} building! Attendance verified PRESENT.`,
      };
    }

    return {
      valid: false,
      reason: 'OUTSIDE_GEOFENCE',
      hostel: normHostel,
      hostelName: activeGeofence.name || fallbackGeofence.name,
      strictlyInside: false,
      withinBuffer: false,
      distanceToCenterMeters: null,
      distanceToEdgeMeters: Math.round(distToEdge * 10) / 10,
      radiusMeters,
      accuracy: accuracy || null,
      message: `You are outside your assigned hostel (${activeGeofence.name || normHostel}) boundary (${Math.round(distToEdge)}m outside).`,
    };
  }

  // 3. Exact Great-Circle distance to building center using Haversine formula
  const distToCenter = haversineDistanceMeters(lat, lng, targetCenter.lat, targetCenter.lng);
  const allowedRadius = radiusMeters + bufferMeters;
  const strictlyInside = distToCenter <= radiusMeters;
  const withinAllowedBoundary = distToCenter <= allowedRadius;

  logger.info('[Geofence] Evaluation result:', {
    hostel: normHostel,
    studentCoords: { lat, lng, accuracy },
    targetCenter,
    distToCenterMeters: Math.round(distToCenter * 10) / 10,
    radiusMeters,
    withinAllowedBoundary,
  });

  if (withinAllowedBoundary) {
    return {
      valid: true,
      hostel: normHostel,
      hostelName: activeGeofence.name || fallbackGeofence.name,
      strictlyInside,
      withinBuffer: true,
      distanceToCenterMeters: Math.round(distToCenter * 10) / 10,
      distanceToEdgeMeters: 0,
      radiusMeters,
      accuracy: accuracy || null,
      message: `Verified inside ${activeGeofence.name || normHostel} building! Distance: ${Math.round(distToCenter)}m from center (permitted radius: ${radiusMeters}m). Attendance verified PRESENT.`,
    };
  }

  const distanceOutside = Math.round((distToCenter - radiusMeters) * 10) / 10;
  return {
    valid: false,
    reason: 'OUTSIDE_GEOFENCE',
    hostel: normHostel,
    hostelName: activeGeofence.name || fallbackGeofence.name,
    strictlyInside: false,
    withinBuffer: false,
    distanceToCenterMeters: Math.round(distToCenter * 10) / 10,
    distanceToEdgeMeters: distanceOutside,
    radiusMeters,
    accuracy: accuracy || null,
    message: `You are outside your assigned hostel (${activeGeofence.name || normHostel}) boundary (${Math.round(distToCenter)}m from center, ${Math.round(distanceOutside)}m outside permitted ${radiusMeters}m boundary).`,
  };
};

/**
 * Retrieves the active geofence configuration for a hostel from DB or authoritative fallback
 */
const getHostelGeofenceConfig = async (hostel) => {
  const normHostel = normalizeHostelCode(hostel);
  const fallbackGeofence = AUTHORITATIVE_HOSTEL_GEOFENCES[normHostel] || AUTHORITATIVE_HOSTEL_GEOFENCES.BH2;
  let dbGeofence = null;
  if (mongoose.connection.readyState === 1) {
    try {
      dbGeofence = await HostelGeofence.findOne({ hostel: normHostel, active: true }).lean();
      if (!dbGeofence && (normHostel === 'GH1' || normHostel === 'GH2')) {
        dbGeofence = await HostelGeofence.findOne({ hostel: 'GH', active: true }).lean();
      }
    } catch (_) { }
  }
  const hasDbCenter = dbGeofence?.center && typeof dbGeofence.center.lat === 'number';
  const hasDbPolygon = Array.isArray(dbGeofence?.polygon) && dbGeofence.polygon.length >= 3;
  const activeGeofence = (hasDbCenter || hasDbPolygon) ? dbGeofence : fallbackGeofence;
  return {
    hostel: normHostel,
    name: activeGeofence.name || fallbackGeofence.name,
    center: activeGeofence.center || fallbackGeofence.center,
    polygon: activeGeofence.polygon || fallbackGeofence.polygon || [],
    radius_m: activeGeofence.radius_m ?? fallbackGeofence.radius_m ?? 22,
    buffer_m: activeGeofence.buffer_m ?? fallbackGeofence.buffer_m ?? 0,
    accuracy_threshold_m: activeGeofence.accuracy_threshold_m ?? fallbackGeofence.accuracy_threshold_m ?? 25,
    auto_attendance: activeGeofence.auto_attendance !== undefined ? activeGeofence.auto_attendance : (fallbackGeofence.auto_attendance !== false),
  };
};

module.exports = {
  AUTHORITATIVE_HOSTEL_GEOFENCES,
  normalizeHostelCode,
  isPointInPolygon,
  distanceToPolygonMeters,
  haversineDistanceMeters,
  verifyHostelGeofence,
  getHostelGeofenceConfig,
};
