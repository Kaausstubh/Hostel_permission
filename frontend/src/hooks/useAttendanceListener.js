/**
 * useAttendanceListener Hook
 *
 * Real-time student attendance request listener:
 * 1. Automatically checks GET /attendance/pending immediately on student login/mount.
 * 2. Connects to Socket.IO and listens for 'attendance_requested' and 'attendance_request_expired'.
 * 3. Re-checks on tab focus (visibilitychange, focus) and network reconnection (online).
 * 4. Fallback polling with backoff when socket is disconnected.
 * 5. De-duplicates notifications by requestId.
 * 6. Stops listening cleanly on logout or unmount.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
import api from '../services/api';
import { resolveBackendOrigin } from '../services/backendUrl';

export function useAttendanceListener(user, { enabled = true } = {}) {
  const [activeRequest, setActiveRequest] = useState(null);
  const [loading, setLoading] = useState(false);
  const dismissedIdsRef = useRef(new Set());
  const socketRef = useRef(null);
  const isStudent = user?.role === 'student';
  const shouldRun = enabled && isStudent && Boolean(user?._id);

  const checkPending = useCallback(async (silent = true) => {
    if (!shouldRun) return;
    try {
      if (!silent) setLoading(true);
      const res = await api.get('/attendance/pending');
      if (res.data?.success && res.data.hasPending && res.data.request) {
        const req = res.data.request;
        // Ignore if student already approved or on leave, or if request was dismissed
        if (req.alreadyApproved || req.onLeave || req.status === 'approved' || dismissedIdsRef.current.has(req.id)) {
          setActiveRequest(null);
          return;
        }

        // If remaining seconds > 0, set active request
        if (req.remainingSeconds > 0) {
          setActiveRequest({
            ...req,
            receivedAt: Date.now(),
          });
        } else {
          setActiveRequest(null);
        }
      } else {
        setActiveRequest(null);
      }
    } catch (err) {
      // Non-blocking background check
      if (!silent) {
        console.warn('[AttendanceListener] Check pending error:', err.message);
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [shouldRun]);

  const dismissRequest = useCallback((requestId) => {
    if (requestId) {
      dismissedIdsRef.current.add(requestId);
    }
    setActiveRequest(null);
  }, []);

  useEffect(() => {
    if (!shouldRun) {
      setActiveRequest(null);
      return;
    }

    // 1. Immediate check on student mount/login
    checkPending(false);

    // 2. Connect Socket.IO
    let socket = null;
    try {
      const token = localStorage.getItem('token');
      const origin = resolveBackendOrigin();
      socket = io(origin, {
        auth: { token },
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionAttempts: 10,
      });
      socketRef.current = socket;

      if (user?._id) {
        socket.emit('join_student', String(user._id));
      }
      if (user?.rollNo) {
        socket.emit('join_roll', String(user.rollNo));
      }

      socket.on('attendance_requested', (data) => {
        if (!data?.requestId) return;
        if (dismissedIdsRef.current.has(data.requestId)) return;
        // Verify this request is actually meant for this student's room
        checkPending(true);
      });

      socket.on('attendance_request_expired', (data) => {
        if (data?.requestId) {
          setActiveRequest((current) => (current?.id === data.requestId ? null : current));
        }
      });

      socket.on('room_attendance_updated', (data) => {
        if (data?.studentId && String(data.studentId) === String(user._id)) {
          if (data.status === 'approved' || data.status === 'timeout' || data.status === 'expired') {
            setActiveRequest(null);
          }
        }
      });
    } catch (sockErr) {
      console.warn('[AttendanceListener] Socket connection warning:', sockErr.message);
    }

    // 3. Re-check on tab focus / foreground
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        checkPending(true);
      }
    };
    const handleFocus = () => checkPending(true);
    const handleOnline = () => checkPending(true);

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('online', handleOnline);

    // 4. Polling timer (runs every 3s if socket disconnected, or every 15s safety net)
    const pollInterval = setInterval(() => {
      const isSocketConnected = Boolean(socket?.connected);
      if (!isSocketConnected || !activeRequest) {
        checkPending(true);
      }
    }, 4000);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('online', handleOnline);
      clearInterval(pollInterval);
      if (socket) {
        socket.disconnect();
      }
      socketRef.current = null;
    };
  }, [shouldRun, user?._id, user?.rollNo, checkPending, activeRequest]);

  return {
    activeRequest,
    checkPending,
    dismissRequest,
    loading,
  };
}
