/**
 * Student Dashboard — In-Portal WhatsApp-Style Chatbot
 *
 * A fully client-side state-machine chatbot that calls the backend
 * student API to perform: in/out requests, home visit requests,
 * complaints, and status checks — all rendered as chat bubbles.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import toast from 'react-hot-toast';
import {
  addDays,
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns';
import {
  MdSend, MdLogout, MdQrCode2, MdHome, MdReport,
  MdDashboard, MdPerson, MdLightMode, MdDarkMode, MdDeleteOutline,
  MdCalendarMonth, MdChevronRight, MdExitToApp,
  MdPhotoCamera, MdUpload, MdClose, MdCheckCircle,
  MdLock, MdSecurity, MdTouchApp, MdRefresh,
} from 'react-icons/md';
import { useTheme } from '../context/ThemeContext';
import iiitLogo from '../assets/iiitpune-logo.png';
import StudentAvatar from '../components/StudentAvatar';
import AntiScreenshotShield from '../components/AntiScreenshotShield';
// ── Constants ─────────────────────────────────────────────────────────────────
const BOT = 'bot';
const USER = 'user';
const CHAT_STORAGE_PREFIX = 'student-dashboard-chat:';

// ── Live Gate Pass Anti-Screenshot Clock ─────────────────────────────────────
function LiveGatePassClock() {
  const [timeStr, setTimeStr] = useState(() => format(new Date(), 'hh:mm:ss a'));
  useEffect(() => {
    const id = setInterval(() => setTimeStr(format(new Date(), 'hh:mm:ss a')), 1000);
    return () => clearInterval(id);
  }, []);
  return <span>{timeStr}</span>;
}

// ── Format WhatsApp-style chat markdown (*bold*, _italic_) ───────────────────
function formatChatContent(text) {
  if (typeof text !== 'string') return text;
  if (!text) return null;

  // Split by *bold* tokens
  const boldParts = text.split(/(\*[^*\r\n]+\*)/g);
  return boldParts.map((bPart, bIdx) => {
    if (bPart.startsWith('*') && bPart.endsWith('*') && bPart.length > 2) {
      return (
        <strong key={`b-${bIdx}`} style={{ fontWeight: 700 }}>
          {bPart.slice(1, -1)}
        </strong>
      );
    }

    // Split remaining text by _italic_ tokens
    const italicParts = bPart.split(/(_[^_\r\n]+_)/g);
    if (italicParts.length === 1) return bPart;

    return italicParts.map((iPart, iIdx) => {
      if (iPart.startsWith('_') && iPart.endsWith('_') && iPart.length > 2) {
        return (
          <em key={`i-${bIdx}-${iIdx}`} style={{ fontStyle: 'italic' }}>
            {iPart.slice(1, -1)}
          </em>
        );
      }
      return iPart;
    });
  });
}

// ── Bot message factory ───────────────────────────────────────────────────────
// NOTE: msgId is created inside the component via useRef to avoid stale IDs
// during React HMR (hot module replacement) in development.
const makeMsg = (id, sender, content, type = 'text', meta = {}) => ({
  id,
  sender,
  type,   // 'text' | 'buttons' | 'qr' | 'status'
  content,
  meta,
  time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
});

// ── Chatbot State Machine Steps ───────────────────────────────────────────────
const STEPS = {
  IDLE:          'IDLE',
  MENU:          'MENU',
  // In/Out
  INOUT_PLACE:   'INOUT_PLACE',
  INOUT_OTHER:   'INOUT_OTHER',
  INOUT_REASON:  'INOUT_REASON',
  INOUT_REASON_OTHER: 'INOUT_REASON_OTHER',
  INOUT_CONFIRM: 'INOUT_CONFIRM',
  // Home Visit
  HV_REASON:     'HV_REASON',
  HV_REASON_OTHER: 'HV_REASON_OTHER',
  HV_PLACE:      'HV_PLACE',
  HV_LEAVE:      'HV_LEAVE',
  HV_RETURN:     'HV_RETURN',
  // Complaint
  CPL_TYPE:      'CPL_TYPE',
  CPL_PHOTO:     'CPL_PHOTO',
  CPL_TEXT:      'CPL_TEXT',
  // Done
  DONE:          'DONE',
};

const compressImageForUpload = (file, maxWidth = 960, maxHeight = 960, quality = 0.8) => {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('No file provided'));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('File read failed'));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error('Image decode failed'));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxWidth || height > maxHeight) {
          const ratio = Math.min(maxWidth / width, maxHeight / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
};

const formatLocalDate = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getTodayDateString = () => formatLocalDate(new Date());
const parseLocalDate = (dateStr) => {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
};
const getMaxReturnDateFromLeave = (leaveDateStr) => {
  const leaveDate = parseLocalDate(leaveDateStr);
  leaveDate.setDate(leaveDate.getDate() + 105);
  return formatLocalDate(leaveDate);
};

/** Accept YYYY-MM-DD or DD/MM/YYYY (common from date pickers / typing) */
const parseFlexibleDate = (text) => {
  const trimmed = text.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const dmy = trimmed.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (dmy) {
    const [, day, month, year] = dmy;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  return null;
};

const FLOW_RECOVERY_BUTTONS = [
  { id: 'flow_restart_hv', label: '↩️ Restart home visit' },
  { id: 'flow_menu', label: '🏠 Main menu' },
];

const MAIN_MENU_BUTTONS = [
  { id: '1', label: '🔄 In/Out Request', icon: '🔄' },
  { id: '2', label: '🏠 Home Visit Request', icon: '🏠' },
  { id: '3', label: '🧾 File a Complaint', icon: '🧾' },
  { id: '4', label: '📊 View My Status', icon: '📊' },
];

/** Labels for daily in/out vs home visit QR cards */
const getPassDisplay = (meta = {}) => {
  const scanType = String(meta.scanType || '').toUpperCase();
  const isHome =
    meta.passKind === 'home_visit' ||
    scanType.includes('HOME');

  if (isHome) {
    const isReturn =
      meta.scanPhase === 'return' ||
      scanType.includes('RETURN') ||
      scanType.includes('HOME IN');
    const dates =
      meta.leaveDate && meta.returnDate
        ? `${meta.leaveDate} → ${meta.returnDate}`
        : null;
    return {
      cardTitle: 'HEIMDALL',
      cardSubtitle: isReturn ? 'Home Visit — Return QR' : 'Home Visit — Departure QR',
      hint: dates
        ? `${dates} · Show to security at gate`
        : 'Show to security at the hostel gate',
      instruction: isReturn
        ? '🏫 Use this QR to enter campus (Home Return)'
        : '🏡 Use this QR to leave campus (Home Departure)',
      instructionType: isReturn ? 'IN' : 'OUT',
      zoomTitle: 'Home Visit QR Code',
    };
  }

  const isExit = scanType === 'OUT';
  const isReturn = scanType === 'IN';
  const inOutLabel =
    scanType === 'IN' ? 'Return (IN)' : scanType === 'OUT' ? 'Exit (OUT)' : scanType || 'In/Out';
  return {
    cardTitle: 'HEIMDALL',
    cardSubtitle: `Daily In/Out · ${inOutLabel}${meta.place ? ` · ${meta.place}` : ''}`,
    hint: 'Tap to zoom · Show to security at gate',
    instruction: isExit
      ? '🚪 Use this QR to go OUT of campus'
      : isReturn
      ? '🏫 Use this QR to go INSIDE campus'
      : '🛡️ Show this QR to security at the gate',
    instructionType: isExit ? 'OUT' : isReturn ? 'IN' : 'GENERAL',
    zoomTitle: 'Daily In/Out QR Code',
  };
};

const BOT_LOGO_DARK = '/heimdall-avatar-dark.png';
const BOT_LOGO_LIGHT = '/heimdall-avatar-light.png';

const INOUT_LOCATIONS = [
  { id: 'place_shop', label: '🛒 Shop' },
  { id: 'place_talegaon', label: '📍 Talegaon' },
  { id: 'place_other', label: '📌 Other location' },
  { id: 'flow_menu', label: '🏠 Main menu' },
];

const addDaysToDateStr = (dateStr, days) => {
  const d = parseLocalDate(dateStr);
  d.setDate(d.getDate() + days);
  return formatLocalDate(d);
};

const formatDateFriendly = (iso) => {
  if (!iso) return 'Tap to choose a date';
  return parseLocalDate(iso).toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
};

const getStudentChatStorageKey = (user) => {
  if (!user) return '';
  const uid = user.id || user._id || user.email;
  const uidStr = typeof uid === 'object' ? uid.toString() : String(uid);
  return `${CHAT_STORAGE_PREFIX}${uidStr}`;
};

const buildCalendarDays = (monthDate) => {
  const monthStart = startOfMonth(monthDate);
  const monthEnd = endOfMonth(monthDate);
  const gridStart = startOfWeek(monthStart);
  const gridEnd = endOfWeek(monthEnd);
  const days = [];

  for (let day = gridStart; day <= gridEnd; day = addDays(day, 1)) {
    days.push(day);
  }

  return days;
};

function DatePickerModal({ open, value, min, max, label, onClose, onConfirm }) {
  const minDate = min ? parseLocalDate(min) : null;
  const maxDate = max ? parseLocalDate(max) : null;
  const initialMonth = value
    ? parseLocalDate(value)
    : minDate || new Date();
  const [currentMonth, setCurrentMonth] = useState(initialMonth);

  useEffect(() => {
    if (!open) return;
    setCurrentMonth(value ? parseLocalDate(value) : (minDate || new Date()));
  }, [open, value, min]);

  if (!open) return null;

  const days = buildCalendarDays(currentMonth);
  const selectedDate = value ? parseLocalDate(value) : null;
  const prevMonth = subMonths(currentMonth, 1);
  const nextMonth = addMonths(currentMonth, 1);
  const prevDisabled = minDate && endOfMonth(prevMonth) < minDate;
  const nextDisabled = maxDate && startOfMonth(nextMonth) > maxDate;

  const isDisabled = (day) => {
    if (minDate && day < minDate) return true;
    if (maxDate && day > maxDate) return true;
    return false;
  };

  return (
    <div className="calendar-modal-backdrop" onClick={onClose}>
      <div className="calendar-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="calendar-modal-header">
          <div>
            <div className="calendar-modal-eyebrow">Select date</div>
            <div className="calendar-modal-title">{label}</div>
          </div>
          <button type="button" className="calendar-nav-btn" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="calendar-toolbar">
          <button
            type="button"
            className="calendar-nav-btn"
            onClick={() => !prevDisabled && setCurrentMonth(prevMonth)}
            disabled={prevDisabled}
          >
            Prev
          </button>
          <div className="calendar-current-month">{format(currentMonth, 'MMMM yyyy')}</div>
          <button
            type="button"
            className="calendar-nav-btn"
            onClick={() => !nextDisabled && setCurrentMonth(nextMonth)}
            disabled={nextDisabled}
          >
            Next
          </button>
        </div>

        <div className="calendar-weekdays">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
            <span key={day}>{day}</span>
          ))}
        </div>

        <div className="calendar-grid">
          {days.map((day) => {
            const iso = formatLocalDate(day);
            const disabled = isDisabled(day);
            const selected = selectedDate && isSameDay(day, selectedDate);
            return (
              <button
                key={day.toISOString()}
                type="button"
                className={`calendar-day-btn${isSameMonth(day, currentMonth) ? '' : ' is-outside'}${selected ? ' is-selected' : ''}`}
                disabled={disabled}
                onClick={() => {
                  onConfirm(iso);
                  onClose();
                }}
              >
                {format(day, 'd')}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Calendar trigger + quick picks — selects and advances in one tap */
function ChatDatePicker({ label, min, max, disabled, onConfirm, isReturnStep = false }) {
  const [value, setValue] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const today = getTodayDateString();
  const anchor = min || today;

  const applyDate = (iso) => {
    if (!iso || disabled) return;
    if (min && iso < min) return;
    if (max && iso > max) return;
    setValue(iso);
    onConfirm(iso);
  };

  const quickOptions = (isReturnStep
    ? [
        { label: 'Earliest', value: anchor },
        { label: '+2 days', value: addDaysToDateStr(anchor, 2) },
        { label: '+1 week', value: addDaysToDateStr(anchor, 7) },
        { label: '+2 weeks', value: addDaysToDateStr(anchor, 14) },
      ]
    : [
        { label: 'Today', value: today },
        { label: 'Tomorrow', value: addDaysToDateStr(today, 1) },
        { label: '+3 days', value: addDaysToDateStr(today, 3) },
        { label: '+1 week', value: addDaysToDateStr(today, 7) },
      ]
  ).filter((opt) => (!min || opt.value >= min) && (!max || opt.value <= max));

  return (
    <div className="chat-date-picker">
      <button
        type="button"
        className={`chat-date-picker-trigger${disabled ? ' is-disabled' : ''}`}
        disabled={disabled}
        onClick={() => !disabled && setPickerOpen(true)}
      >
        <span className="chat-date-picker-icon-wrap">
          <MdCalendarMonth size={26} />
        </span>
        <span className="chat-date-picker-trigger-body">
          <span className="chat-date-picker-trigger-label">{label}</span>
          <span className="chat-date-picker-trigger-value">{formatDateFriendly(value)}</span>
        </span>
        <MdChevronRight className="chat-date-picker-chevron" size={22} />
      </button>

      {quickOptions.length > 0 && (
        <div className="chat-date-quick-row">
          {quickOptions.map((opt) => (
            <button
              key={opt.label}
              type="button"
              className="chat-date-quick-btn"
              disabled={disabled}
              onClick={() => applyDate(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      <DatePickerModal
        open={pickerOpen}
        value={value}
        min={min}
        max={max}
        label={label}
        onClose={() => setPickerOpen(false)}
        onConfirm={applyDate}
      />
    </div>
  );
}

/** Synthesized gentle confirmation chime for successful security gate scan */
const playScanChime = () => {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    const now = ctx.currentTime;

    // Pitch 1: C5 (523.25 Hz)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(523.25, now);
    gain1.gain.setValueAtTime(0, now);
    gain1.gain.linearRampToValueAtTime(0.25, now + 0.04);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.32);

    // Pitch 2: G5 (783.99 Hz)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(783.99, now + 0.12);
    gain2.gain.setValueAtTime(0, now + 0.12);
    gain2.gain.linearRampToValueAtTime(0.3, now + 0.16);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.12);
    osc2.stop(now + 0.55);

    // Pitch 3: High C6 (1046.5 Hz)
    const osc3 = ctx.createOscillator();
    const gain3 = ctx.createGain();
    osc3.type = 'sine';
    osc3.frequency.setValueAtTime(1046.5, now + 0.24);
    gain3.gain.setValueAtTime(0, now + 0.24);
    gain3.gain.linearRampToValueAtTime(0.32, now + 0.28);
    gain3.gain.exponentialRampToValueAtTime(0.001, now + 0.72);
    osc3.connect(gain3);
    gain3.connect(ctx.destination);
    osc3.start(now + 0.24);
    osc3.stop(now + 0.72);
  } catch {
    // Graceful fallback if audio context is blocked
  }
};

export default function StudentDashboard() {
  const { user, logout, updateUser } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [messages, setMessages] = useState([]);
  const [step, setStep]         = useState(STEPS.IDLE);
  const [input, setInput]       = useState('');
  const [loading, setLoading]   = useState(false);
  const [hvData, setHvData]     = useState({});
  const [zoomedQR, setZoomedQR] = useState(null);
  const [activePasses, setActivePasses] = useState([]);
  const [qrQuickLoading, setQrQuickLoading] = useState(false);
  const [scanAlertModal, setScanAlertModal] = useState(null);
  const lastScanStateRef = useRef(null);
  const isInitialStatusLoadedRef = useRef(false);
  const isPollingRef = useRef(false);
  const bottomRef = useRef(null);
  const menuTimerRef = useRef(null);
  const bootTimerRef = useRef(null);
  const lastBotRef = useRef({ content: '', type: '', at: 0 });
  const [chatHydrated, setChatHydrated] = useState(false);
  // Safe initial mobile check — avoids SSR/layout-shift issues
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 768);
  const msgIdRef = useRef(0);
  const [avatarImgError, setAvatarImgError] = useState(false);

  // Dismiss zoomed pass immediately if portal is backgrounded or screen capture is detected
  useEffect(() => {
    const handleHidePass = () => {
      setZoomedQR(null);
    };
    window.addEventListener('heimdall-screen-recording-detected', handleHidePass);
    window.addEventListener('heimdall-portal-backgrounded', handleHidePass);
    return () => {
      window.removeEventListener('heimdall-screen-recording-detected', handleHidePass);
      window.removeEventListener('heimdall-portal-backgrounded', handleHidePass);
    };
  }, []);

  // Complaint photo states
  const [complaintPhoto, setComplaintPhoto] = useState(null);
  const [complaintNote, setComplaintNote] = useState('');
  const [isCompressingPhoto, setIsCompressingPhoto] = useState(false);
  const complaintCameraRef = useRef(null);
  const complaintFileRef = useRef(null);
  // Mobile pull-down-to-reload state
  const [pullY, setPullY] = useState(0);
  const [isPullRefreshing, setIsPullRefreshing] = useState(false);
  const pullStartYRef = useRef(0);
  const messagesScrollRef = useRef(null);

  const handlePullStart = (e) => {
    if (!e.touches || !e.touches[0]) return;
    const clientY = e.touches[0].clientY;
    // Only engage if touch starts inside the page content (below header, > 75px)
    // and messages container is scrolled to the top
    if (clientY > 75 && messagesScrollRef.current && messagesScrollRef.current.scrollTop <= 2) {
      pullStartYRef.current = clientY;
    } else {
      pullStartYRef.current = 0;
    }
  };

  const handlePullMove = (e) => {
    if (!pullStartYRef.current || !e.touches || !e.touches[0]) return;
    const clientY = e.touches[0].clientY;
    const delta = clientY - pullStartYRef.current;
    if (delta > 0 && messagesScrollRef.current && messagesScrollRef.current.scrollTop <= 2) {
      // Gentle dampening
      const damped = Math.min(85, delta * 0.42);
      setPullY(damped);
    } else {
      setPullY(0);
    }
  };

  const handlePullEnd = () => {
    if (pullY >= 50) {
      setIsPullRefreshing(true);
      if (navigator.vibrate) {
        try { navigator.vibrate(30); } catch (_) {}
      }
      setTimeout(() => {
        window.location.reload();
      }, 350);
    } else {
      setPullY(0);
    }
    pullStartYRef.current = 0;
  };


  // Automatically sync verified student registration photo if missing from local state
  useEffect(() => {
    if (user && !user.studentPhoto) {
      api.get('/auth/me')
        .then((res) => {
          const fresh = res.data?.user;
          if (fresh?.studentPhoto) {
            updateUser({
              studentPhoto: fresh.studentPhoto,
              picture: fresh.picture || fresh.studentPhoto,
            });
          }
        })
        .catch(() => {});
    }
  }, [user, updateUser]);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // ── Auto-scroll ───────────────────────────────────────────────────────────
  const scrollChatToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      setTimeout(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
      }, 120);
    });
  }, []);

  useEffect(() => {
    scrollChatToBottom();
  }, [messages, step, scrollChatToBottom]);

  // ── Helpers ───────────────────────────────────────────────────────────────
  const push = useCallback((m) => setMessages((prev) => [...prev, m]), []);

  const botSay = useCallback((text, type = 'text', meta = {}) => {
    const now = Date.now();
    // Avoid accidental duplicate bot bubbles caused by rapid clicks/timeouts.
    if (
      lastBotRef.current.content === text &&
      lastBotRef.current.type === type &&
      now - lastBotRef.current.at < 1500
    ) {
      return;
    }
    lastBotRef.current = { content: text, type, at: now };
    const id = ++msgIdRef.current;
    push(makeMsg(id, BOT, text, type, meta));
  }, [push]);

  const userSay = useCallback((text) => {
    const id = ++msgIdRef.current;
    push(makeMsg(id, USER, text));
  }, [push]);

  const pushQrMessage = useCallback((meta = {}) => {
    const id = ++msgIdRef.current;
    push(makeMsg(id, BOT, '', 'qr', meta));
  }, [push]);

  const isMainMenuMessage = (m) =>
    m?.type === 'buttons' && m.content?.includes('What would you like to do today?');

  const getMainMenuText = () =>
    `Hi ${user?.name?.split(' ')[0]} 👋  What would you like to do today?\n\n💡 Tip: If you already requested a QR gate-pass or Home Visit pass, click "View My Status" to access it.`;

  /** Keep one main menu, drop flow messages after it, never stack duplicate menus */
  const goToMainMenu = useCallback(() => {
    console.log('goToMainMenu called! current step:', step);
    if (menuTimerRef.current) {
      clearTimeout(menuTimerRef.current);
      menuTimerRef.current = null;
    }
    setHvData((prev) => {
      console.log('goToMainMenu resetting hvData. prev:', prev);
      // Keep only keys starting with "qr_"
      const next = {};
      for (const k in prev) {
        if (k.startsWith('qr_')) {
          next[k] = prev[k];
        }
      }
      return next;
    });
    setStep(STEPS.MENU);
    lastBotRef.current = { content: '', type: '', at: 0 };

    const menuText = getMainMenuText();

    setMessages((prev) => {
      const lastMessage = prev[prev.length - 1];
      console.log('goToMainMenu setMessages. lastMessage:', lastMessage);
      if (isMainMenuMessage(lastMessage)) {
        console.log('goToMainMenu: last message is already main menu, skipping append.');
        return prev;
      }

      const id = ++msgIdRef.current;
      lastBotRef.current = { content: menuText, type: 'buttons', at: Date.now() };
      console.log('goToMainMenu: appending main menu message.');
      return [...prev, makeMsg(id, BOT, menuText, 'buttons', { buttons: MAIN_MENU_BUTTONS })];
    });

    scrollChatToBottom();
  }, [user, scrollChatToBottom]);

  useEffect(() => {
    if (!user) {
      setChatHydrated(false);
      return;
    }

    const storageKey = getStudentChatStorageKey(user);
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const saved = JSON.parse(raw);
        const savedMessages = Array.isArray(saved.messages) ? saved.messages : [];
        setMessages(savedMessages);
        setStep(saved.step || STEPS.IDLE);
        setHvData(saved.hvData || {});
        msgIdRef.current = savedMessages.reduce((max, msg) => Math.max(max, Number(msg.id) || 0), 0);
      } else {
        setMessages([]);
        setStep(STEPS.IDLE);
        setHvData({});
        msgIdRef.current = 0;
      }
    } catch {
      setMessages([]);
      setStep(STEPS.IDLE);
      setHvData({});
      msgIdRef.current = 0;
    } finally {
      setChatHydrated(true);
    }
  }, [user]);

  useEffect(() => {
    if (!user || !chatHydrated) return;
    const storageKey = getStudentChatStorageKey(user);
    localStorage.setItem(storageKey, JSON.stringify({
      messages,
      step,
      hvData,
    }));
  }, [user, chatHydrated, messages, step, hvData]);

  // ── Boot greeting ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!user || !chatHydrated) return;
    if (messages.length > 0) return;
    bootTimerRef.current = setTimeout(() => goToMainMenu(), 500);
    return () => {
      if (bootTimerRef.current) clearTimeout(bootTimerRef.current);
      if (menuTimerRef.current) clearTimeout(menuTimerRef.current);
    };
  }, [user, chatHydrated, messages.length, goToMainMenu]);

  const showFlowExitOptions = (message) => {
    botSay(message, 'buttons', { buttons: FLOW_RECOVERY_BUTTONS });
    setStep(STEPS.MENU);
  };

  const restartHomeVisitFlow = () => {
    setHvData({});
    setStep(STEPS.HV_REASON);
    lastBotRef.current = { content: '', type: '', at: 0 };
    botSay('🏠 *Home Visit Request*\n\nStep 1 — Select a reason below, or type your own:', 'buttons', {
      buttons: [
        { id: 'going_home', label: '🏠 Going Home' },
        { id: 'medical_reason', label: '🏥 Medical Reason' },
        { id: 'family_function', label: '🎉 Family Function' },
        { id: 'hv_other', label: '🛠️ Other Reason' },
        { id: 'flow_menu', label: '🏠 Main menu' },
      ],
    });
    scrollChatToBottom();
  };
  // ── Button click handler ──────────────────────────────────────────────────
  const handleButton = async (id, label) => {
    const silentAction = ['flow_menu', 'flow_restart_hv'].includes(id);
    if (!silentAction) userSay(label);

    if (id === 'flow_restart_hv') {
      restartHomeVisitFlow();
      return;
    }
    if (id === 'flow_menu') {
      goToMainMenu();
      return;
    }

    if (id.startsWith('qr_')) {
      const entry = hvData?.[id];
      const payload =
        typeof entry === 'string'
          ? { qrDataUrl: entry, passKind: 'home_visit' }
          : entry;
      if (payload?.qrDataUrl) {
        pushQrMessage({
          ...payload,
          qrToken: payload.qrToken || payload.qr_token,
        });
        goToMainMenu();
      } else {
        botSay('❌ QR code not found or expired. Tap *View My Status* to refresh.');
      }
      return;
    }

    if (step === STEPS.MENU) {
      if (id === '1') {
        setStep(STEPS.INOUT_PLACE);
        botSay('🔄 *In/Out Request*\n\nWhere are you going? Pick a location — your gate QR will be generated right away.', 'buttons', {
          buttons: INOUT_LOCATIONS,
        });
      } else if (id === '2') {
        setStep(STEPS.HV_REASON);
        botSay('🏠 *Home Visit Request*\n\nStep 1 — Please select a reason below, or type your own:', 'buttons', {
          buttons: [
            { id: 'going_home', label: '🏠 Going Home' },
            { id: 'medical_reason', label: '🏥 Medical Reason' },
            { id: 'family_function', label: '🎉 Family Function' },
            { id: 'hv_other', label: '🛠️ Other Reason' },
            { id: 'flow_menu', label: '🏠 Main menu' },
          ]
        });
      } else if (id === '3') {
        setStep(STEPS.CPL_TYPE);
        botSay('🧾 *File a Complaint*\n\nSelect complaint category:', 'buttons', {
          buttons: [
            { id: 'electricity', label: '⚡ Electricity' },
            { id: 'wifi', label: '📶 WiFi' },
            { id: 'washing_machine', label: '🧺 Washing Machine' },
            { id: 'carpenter', label: '🔨 Carpenter' },
            { id: 'plumber', label: '🔧 Plumber' },
            { id: 'others', label: '🛠️ Others' },
            { id: 'flow_menu', label: '🏠 Main menu' },
          ],
        });
      } else if (id === '4') {
        await fetchStatus();
      }
    } else if (step === STEPS.INOUT_PLACE) {
      if (id === 'place_other') {
        setStep(STEPS.INOUT_OTHER);
        botSay('📍 Type your destination (e.g. Hinjewadi, Pune):');
        return;
      }
      const placeMap = { place_shop: 'Shop', place_talegaon: 'Talegaon' };
      await submitInOutRequest(placeMap[id] || label);
    } else if (step === STEPS.CPL_TYPE) {
      const typeLabelMap = {
        electricity: 'Electricity ⚡',
        wifi: 'WiFi 📶',
        washing_machine: 'Washing Machine 🧺',
        carpenter: 'Carpenter 🔨',
        plumber: 'Plumber 🔧',
        others: 'Others 🛠️',
      };
      const typeLabel = typeLabelMap[id] || 'Others 🛠️';
      setHvData((d) => ({ ...d, complaint_type: id, complaint_type_label: typeLabel }));
      setComplaintPhoto(null);
      setComplaintNote('');
      setStep(STEPS.CPL_PHOTO);
      botSay(
        `📸 *Snap or Upload Photo Evidence*\n\nCategory: *${typeLabel}*\n\nPlease take a photo with your camera or select an image of the issue so the hostel staff and maintenance staff can inspect it:`,
        'complaint_photo',
        {
          complaintType: id,
          complaintTypeLabel: typeLabel,
        }
      );
    } else if (step === STEPS.HV_REASON) {
      if (id === 'hv_other') {
        setStep(STEPS.HV_REASON_OTHER);
        botSay('Please type your detailed reason below:\n\nType *menu* or *cancel* anytime to go back.');
        return;
      }
      setHvData({ reason: label });
      setStep(STEPS.HV_PLACE);
      botSay('📍 Step 2/4 — Where is your destination place (e.g. Satara, Pune, Home Address)?');
    }
  };

  // ── Text input handler ────────────────────────────────────────────────────
  const handleSend = async (e, forcedText) => {
    if (e) e.preventDefault();
    const text = (forcedText !== undefined ? forcedText : input).trim();
    if (!text || loading) return;
    setInput('');
    userSay(text);
    const t = text.toLowerCase();

    // Global escape hatch: works from any ongoing step.
    if (['exit', 'quit', 'close', 'cancel', 'menu', 'back', 'start', 'home'].includes(t)) {
      goToMainMenu();
      return;
    }

    if (step === STEPS.HV_REASON_OTHER) {
      if (text.length < 10 || text.split(/\s+/).length < 2) {
        botSay('❌ That reason is too short or unclear. Please write a genuine, detailed reason for your home visit:');
        return;
      }
      setHvData({ reason: text });
      setStep(STEPS.HV_PLACE);
      botSay('📍 Step 2/4 — Where is your destination place (e.g. Satara ,Pune, Home Address)?');
    } else if (step === STEPS.HV_PLACE) {
      setLoading(true);
      try {
        const res = await api.post('/student/validate-place', { place: text });
        if (!res.data.valid) {
          botSay('❌ Please enter a valid destination place (real city, town, village, or country name).');
          setLoading(false);
          return;
        }
        setHvData((d) => ({ ...d, place: text }));
        setStep(STEPS.HV_LEAVE);
        botSay('📅 Step 3/4 — Please select your *date of leaving* using the calendar below:', 'date_picker', {
          pickerStep: STEPS.HV_LEAVE,
        });
      } catch (err) {
        if (text.length < 3) {
          botSay('❌ Please enter a valid destination place.');
        } else {
          setHvData((d) => ({ ...d, place: text }));
          setStep(STEPS.HV_LEAVE);
          botSay('📅 Step 3/4 — Please select your *date of leaving* using the calendar below:', 'date_picker', {
            pickerStep: STEPS.HV_LEAVE,
          });
        }
      } finally {
        setLoading(false);
      }
    } else if (step === STEPS.INOUT_OTHER) {
      setLoading(true);
      try {
        const res = await api.post('/student/validate-place', { place: text });
        if (!res.data.valid) {
          botSay('❌ Please enter a valid location name (real city, town, village, or place name).');
          setLoading(false);
          return;
        }
        await submitInOutRequest(text);
      } catch (err) {
        await submitInOutRequest(text);
      } finally {
        setLoading(false);
      }
    } else if (step === STEPS.HV_LEAVE || step === STEPS.HV_RETURN) {
      await processHomeVisitDate(text, step);
    } else if (step === STEPS.CPL_PHOTO) {
      if (complaintPhoto) {
        await submitComplaintWithPhoto(complaintPhoto, text);
      } else {
        setComplaintNote(text);
        botSay(`📝 Note recorded: "${text}". Please click *Take Photo (Camera)* or *Upload from Gallery* above to attach a photo, or click *Skip photo* to file without image.`);
      }
    } else if (step === STEPS.CPL_TEXT) {
      if (text.length < 5) {
        botSay('❌ Please provide a clear description of your complaint:');
        return;
      }
      await submitComplaint(text);
    } else if ([
      STEPS.HV_REASON, STEPS.HV_PLACE, STEPS.HV_LEAVE, STEPS.HV_RETURN,
      STEPS.CPL_PHOTO, STEPS.CPL_TEXT, STEPS.INOUT_OTHER
    ].includes(step)) {
      botSay('You\'re in the middle of a request. Type *menu* for main menu, or use *Restart home visit* if dates are wrong.');
    } else {
      if (['hi', 'hello'].includes(t)) {
        goToMainMenu();
      } else {
        botSay('Type *menu* to see options, or use the buttons above.');
      }
    }
  };

  // ── API Calls ─────────────────────────────────────────────────────────────

  const submitInOutRequest = async (place = '') => {
    setLoading(true);
    try {
      const res = await api.post('/student/request-inout', { place });
      const { scan_type, student, expiresIn, qrDataUrl } = res.data;

      botSay(
        `✅ *In/Out Request Sent!*\n\n👤 ${student.name}\n🏢 ${student.hostel || 'N/A'}\n📍 Going to: *${place || 'Not specified'}*\n🔄 Type: *${scan_type}*\n⏰ Valid: ${expiresIn}\n\nShow the QR below at the gate.`,
      );
      pushQrMessage({ qrDataUrl, scanType: scan_type, student, passKind: 'inout', place });
      checkActivePassSilently();
      setStep(STEPS.DONE);
      goToMainMenu();
    } catch (err) {
      botSay(`❌ ${err.response?.data?.message || 'Failed to send in/out request. Try again.'}`);
    } finally {
      setLoading(false);
    }
  };

  const submitHomeVisit = async (data) => {
    setLoading(true);
    try {
      const statusRes = await api.get('/student/status');
      const activeVisits = [
        ...(statusRes.data?.status?.pendingVisits || []),
        ...(statusRes.data?.status?.approvedVisits || []),
      ];

      const hasOverlap = activeVisits.some((visit) =>
        visit.leave_date <= data.return_date && visit.return_date >= data.leave_date
      );

      if (hasOverlap) {
        showFlowExitOptions(
          '❌ You already have an active home visit pass for overlapping dates.\n\nUse *View My Status* for your current QR, or *Restart home visit* only if you have not submitted yet.'
        );
        return;
      }

      await api.post('/student/home-visit', data);
      botSay(
        `✅ *Home Visit Request Submitted!*\n\n📝 Reason: ${data.reason}\n📍 Destination: ${data.place || 'Not specified'}\n📅 Leave: ${data.leave_date}\n📅 Return: ${data.return_date}\n\n⏳ The hostel staff will call your parent to confirm permission. Once confirmed, your QR gate pass will be generated.`
      );
      setHvData({});
      goToMainMenu();
    } catch (err) {
      showFlowExitOptions(`❌ ${err.response?.data?.message || 'Submission failed. Try again.'}`);
    } finally {
      setLoading(false);
    }
  };

  const processHomeVisitDate = useCallback(async (rawValue, forStep, { echoUser = false } = {}) => {
    if (loading) return;
    const text = String(rawValue || '').trim();
    if (!text) return;

    if (echoUser) userSay(text);

    if (forStep === STEPS.HV_LEAVE) {
      const leaveDate = parseFlexibleDate(text);
      if (!leaveDate) {
        botSay('❌ Invalid date. Tap the field to open the calendar, then press Continue.');
        return;
      }
      const today = getTodayDateString();
      if (leaveDate < today) {
        botSay('❌ Leave date cannot be before today.');
        return;
      }
      setHvData((d) => ({ ...d, leave_date: leaveDate }));
      setStep(STEPS.HV_RETURN);
      botSay(
        `📅 Step 4/4 — Select your *expected return date* below (after ${leaveDate}).`,
        'date_picker',
        { pickerStep: STEPS.HV_RETURN, leaveDate }
      );
      scrollChatToBottom();
      return;
    }

    if (forStep === STEPS.HV_RETURN) {
      const returnDate = parseFlexibleDate(text);
      if (!returnDate) {
        botSay('❌ Invalid date. Tap the field to open the calendar, then press Continue.');
        return;
      }
      const today = getTodayDateString();
      if (returnDate < today) {
        botSay('❌ Return date cannot be before today.');
        return;
      }
      const leaveDate = hvData.leave_date;
      if (!leaveDate) {
        botSay('❌ Leave date missing. Starting again from step 3.');
        setStep(STEPS.HV_LEAVE);
        botSay('📅 Step 3/4 — Select your *date of leaving* below:', 'date_picker', {
          pickerStep: STEPS.HV_LEAVE,
        });
        scrollChatToBottom();
        return;
      }
      if (returnDate <= leaveDate) {
        botSay('❌ Return date must be after your leave date.');
        return;
      }
      const maxReturnDate = getMaxReturnDateFromLeave(leaveDate);
      if (returnDate > maxReturnDate) {
        botSay(`❌ Return date cannot exceed 3.5 months from leave date. Maximum: ${maxReturnDate}.`);
        return;
      }
      await submitHomeVisit({ ...hvData, return_date: returnDate });
    }
  }, [loading, hvData, botSay, userSay, scrollChatToBottom, submitHomeVisit]);

  const handleComplaintPhotoChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file (JPG or PNG)');
      return;
    }
    setIsCompressingPhoto(true);
    setLoading(true);
    const toastId = toast.loading('Uploading photo & sending complaint to hostel staff...');
    try {
      const dataUrl = await compressImageForUpload(file, 960, 960, 0.8);
      setComplaintPhoto(dataUrl);

      const category = hvData.complaint_type || 'others';
      const typeLabel = hvData.complaint_type_label || 'Maintenance Issue';
      const desc = (complaintNote || '').trim();

      userSay(`📸 [Uploaded Photo for ${typeLabel}]${desc ? `: "${desc}"` : ''}`);

      await api.post('/student/complaint', {
        hostel: user?.hostel || 'BH1',
        complaint_type: category,
        complaint_text: desc || `[${typeLabel}] Maintenance required. Photo evidence attached.`,
        photo: dataUrl,
      });

      toast.success('Complaint submitted to hostel staff! ✓', { id: toastId });
      botSay(
        `✅ *Complaint Submitted to Hostel Staff!*\n\n🏷️ Category: *${typeLabel}*\n📸 Photo: *Evidence attached & received*\n🏢 Hostel: *${user?.hostel || 'Hostel'}*\n${desc ? `📝 Note: "${desc}"\n` : ''}\nYour complaint has been forwarded to the hostel staff. Maintenance staff will be notified.`,
        'text',
        { photo: dataUrl }
      );
      setComplaintPhoto(null);
      setComplaintNote('');
      setHvData({});
      setStep(STEPS.DONE);
      goToMainMenu();
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.message || 'Could not upload photo. Please try again.', { id: toastId });
      botSay(`❌ ${err.response?.data?.message || 'Failed to submit complaint. Try again.'}`);
    } finally {
      setIsCompressingPhoto(false);
      setLoading(false);
      if (complaintCameraRef.current) complaintCameraRef.current.value = '';
      if (complaintFileRef.current) complaintFileRef.current.value = '';
    }
  };

  const submitComplaintWithPhoto = async (photoData, noteText) => {
    setLoading(true);
    const toastId = toast.loading('Submitting complaint to hostel staff...');
    try {
      const category = hvData.complaint_type || 'others';
      const typeLabel = hvData.complaint_type_label || 'Others';
      const desc = (noteText !== undefined ? noteText : complaintNote || '').trim();
      const finalPhoto = photoData || complaintPhoto || null;

      await api.post('/student/complaint', {
        hostel: user?.hostel || 'BH1',
        complaint_type: category,
        complaint_text: desc || `[${typeLabel}] Maintenance required. Photo evidence attached.`,
        photo: finalPhoto,
      });

      toast.success('Complaint submitted to hostel staff! ✓', { id: toastId });
      botSay(
        `✅ *Complaint Submitted to Hostel Staff!*\n\n🏷️ Category: *${typeLabel}*\n📸 Photo: ${finalPhoto ? '*Evidence attached & received*' : 'None'}\n🏢 Hostel: *${user?.hostel || 'Hostel'}*\n${desc ? `📝 Note: "${desc}"\n` : ''}\nYour complaint has been forwarded to the hostel staff. Maintenance staff will be notified.`,
        'text',
        { photo: finalPhoto }
      );
      setComplaintPhoto(null);
      setComplaintNote('');
      setHvData({});
      setStep(STEPS.DONE);
      goToMainMenu();
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.message || 'Failed to file complaint.', { id: toastId });
      botSay(`❌ ${err.response?.data?.message || 'Failed to file complaint. Try again.'}`);
    } finally {
      setLoading(false);
    }
  };

  const submitComplaint = async (text) => {
    setLoading(true);
    try {
      const category = hvData.complaint_type || 'others';
      const typeLabelMap = {
        electricity: 'Electricity ⚡',
        wifi: 'WiFi 📶',
        washing_machine: 'Washing Machine 🧺',
        carpenter: 'Carpenter 🔨',
        plumber: 'Plumber 🔧',
        others: 'Others 🛠️',
      };
      await api.post('/student/complaint', {
        hostel: user?.hostel,
        complaint_type: category,
        complaint_text: text,
        photo: complaintPhoto || null,
      });
      botSay(
        `✅ *Complaint Filed with Hostel Staff!*\n\n🏷️ Category: *${typeLabelMap[category] || 'Others'}*\n📝 "${text.substring(0, 80)}${text.length > 80 ? '…' : ''}"\n\nThe hostel staff will review it shortly.`
      );
      setComplaintPhoto(null);
      setComplaintNote('');
      setHvData({});
      goToMainMenu();
    } catch (err) {
      botSay(`❌ ${err.response?.data?.message || 'Failed to file complaint.'}`);
    } finally {
      setLoading(false);
    }
  };

  const parseActivePasses = useCallback((s) => {
    const passes = [];
    if (!s) return passes;

    if (s.pendingInOutRequest?.qrDataUrl) {
      const meta = {
        qrDataUrl: s.pendingInOutRequest.qrDataUrl,
        qrToken: s.pendingInOutRequest.qrToken || s.pendingInOutRequest.qr_token,
        scanType: s.pendingInOutRequest.scanType,
        student: user,
        place: s.pendingInOutRequest.place,
        reason: s.pendingInOutRequest.reason,
        expiresAt: s.pendingInOutRequest.expiresAt,
        passKind: 'inout',
      };
      const display = getPassDisplay(meta);
      passes.push({
        ...meta,
        ...display,
        id: 'inout',
        tabLabel: 'Daily In/Out',
      });
    }

    if (s.approvedVisits?.length > 0) {
      s.approvedVisits.forEach((v, idx) => {
        if (v.qrDataUrl) {
          const phase = v.qr_used_out ? 'return' : 'departure';
          const meta = {
            qrDataUrl: v.qrDataUrl,
            qrToken: v.qr_token,
            passKind: 'home_visit',
            scanPhase: phase,
            scanType: phase === 'return' ? 'HOME RETURN' : 'HOME VISIT',
            leaveDate: v.leave_date,
            returnDate: v.return_date,
          };
          const display = getPassDisplay(meta);
          passes.push({
            ...meta,
            ...display,
            id: `hv_${v._id || idx}`,
            tabLabel: `Home Visit (${v.leave_date})`,
          });
        }
      });
    }

    return passes;
  }, [user]);

  const checkActivePassSilently = useCallback(async () => {
    if (isPollingRef.current) return;
    isPollingRef.current = true;
    try {
      const res = await api.get('/student/status');
      const s = res.data?.status;
      if (!s) return;

      if (s.studentPhoto && !user?.studentPhoto) {
        updateUser({ studentPhoto: s.studentPhoto, picture: s.studentPhoto });
      }

      const passes = parseActivePasses(s);
      setActivePasses(passes);

      const latestLog = s.todayLogs?.[0];
      const latestApprovedHv = s.approvedVisits?.[0];
      const latestRecentHv = s.recentVisitHistory?.[0];

      const logKey = latestLog
        ? `${latestLog._id || ''}_${latestLog.status}_${latestLog.in_time || ''}_${latestLog.out_time || ''}`
        : 'no_log';
      const hvApprovedKey = latestApprovedHv
        ? `${latestApprovedHv._id}_out:${latestApprovedHv.qr_used_out}_in:${latestApprovedHv.qr_used_in}`
        : 'no_appr_hv';
      const hvRecentKey = latestRecentHv
        ? `${latestRecentHv._id}_${latestRecentHv.overall_status}_in:${latestRecentHv.qr_used_in}`
        : 'no_rec_hv';
      const currentFingerprint = `${logKey}__${hvApprovedKey}__${hvRecentKey}__${s.currentStatus || ''}`;

      if (!isInitialStatusLoadedRef.current) {
        lastScanStateRef.current = {
          fingerprint: currentFingerprint,
          logKey,
          hvApprovedKey,
          hvRecentKey,
          status: s.currentStatus,
        };
        isInitialStatusLoadedRef.current = true;
      } else if (lastScanStateRef.current && lastScanStateRef.current.fingerprint !== currentFingerprint) {
        const prevState = lastScanStateRef.current;
        lastScanStateRef.current = {
          fingerprint: currentFingerprint,
          logKey,
          hvApprovedKey,
          hvRecentKey,
          status: s.currentStatus,
        };

        // Determine whether Home Visit or Daily pass changed
        const hvApprovedChanged = latestApprovedHv && prevState.hvApprovedKey !== hvApprovedKey;
        const hvRecentChanged = latestRecentHv && prevState.hvRecentKey !== hvRecentKey;
        const logChanged = latestLog && prevState.logKey !== logKey;

        // Check for Home Visit Return
        const isHvReturn =
          (hvRecentChanged && (latestRecentHv?.qr_used_in || latestRecentHv?.overall_status === 'completed')) ||
          (hvApprovedChanged && latestApprovedHv?.qr_used_in);

        // Check for Home Visit Departure
        const isHvDeparture =
          hvApprovedChanged && latestApprovedHv?.qr_used_out && !latestApprovedHv?.qr_used_in;

        let isHomeVisit = false;
        let isHvPhaseReturn = false;

        if (isHvReturn) {
          isHomeVisit = true;
          isHvPhaseReturn = true;
        } else if (isHvDeparture) {
          isHomeVisit = true;
          isHvPhaseReturn = false;
        } else if (!logChanged && (latestApprovedHv?.qr_used_out || latestRecentHv?.qr_used_in)) {
          if (latestRecentHv?.qr_used_in) {
            isHomeVisit = true;
            isHvPhaseReturn = true;
          } else if (latestApprovedHv?.qr_used_out) {
            isHomeVisit = true;
            isHvPhaseReturn = false;
          }
        } else if (logChanged) {
          isHomeVisit = false;
        } else {
          // Compare event timestamps to see what is newest
          const hvReturnTime = new Date(latestRecentHv?.actual_in_time || latestRecentHv?.actual_in || 0).getTime();
          const hvOutTime = new Date(latestApprovedHv?.actual_out_time || latestApprovedHv?.actual_out || 0).getTime();
          const logTime = new Date(latestLog?.in_time || latestLog?.out_time || latestLog?.timestamp || 0).getTime();

          const maxHvTime = Math.max(hvReturnTime, hvOutTime);
          if (maxHvTime > logTime) {
            isHomeVisit = true;
            isHvPhaseReturn = hvReturnTime >= hvOutTime;
          } else {
            isHomeVisit = false;
          }
        }

        // Close zoomed QR so full screen modal takes over cleanly
        setZoomedQR(null);

        // Sound chime and haptic feedback
        playScanChime();
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          try {
            navigator.vibrate([200, 100, 200]);
          } catch {
            // ignore
          }
        }

        if (isHomeVisit) {
          const hvRecord = isHvPhaseReturn ? (latestRecentHv || latestApprovedHv) : latestApprovedHv;
          const scanType = isHvPhaseReturn ? 'HOME_IN' : 'HOME_OUT';
          const title = isHvPhaseReturn ? 'Home Visit Return Verified' : 'Home Visit Departure Verified';
          const subtitle = isHvPhaseReturn
            ? 'Security scanned your Home Visit return pass. Welcome back to campus hostel!'
            : 'Security scanned your Home Visit pass at the gate. Have a safe journey home!';
          const destination = hvRecord?.place || 'Home';
          const leaveDate = hvRecord?.leave_date ? format(new Date(hvRecord.leave_date), 'dd MMM yyyy') : '';
          const returnDate = hvRecord?.return_date ? format(new Date(hvRecord.return_date), 'dd MMM yyyy') : '';
          const rawTime = isHvPhaseReturn
            ? (hvRecord?.actual_in_time || hvRecord?.actual_in || new Date())
            : (hvRecord?.actual_out_time || hvRecord?.actual_out || new Date());
          const scanTime = new Date(rawTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

          setScanAlertModal({
            isHomeVisit: true,
            homeVisitPhase: isHvPhaseReturn ? 'return' : 'departure',
            scanType,
            title,
            subtitle,
            destination,
            leaveDate,
            returnDate,
            scanTime,
            studentName: user?.name || 'Student',
            rollNo: user?.rollNo || '',
            hostel: user?.hostel || '',
          });

          if (isHvPhaseReturn) {
            botSay(
              `🏡 **Home Visit Return Confirmed by Security!**\n\n` +
              `✅ Movement: *Campus Entry (Home Visit Return)*\n` +
              `📍 Returned from: *${destination}*\n` +
              (leaveDate && returnDate ? `📅 Visit Period: *${leaveDate}* to *${returnDate}*\n` : '') +
              `⏰ Verified at: *${scanTime}*\n` +
              `👮 Scanned at Main Campus Security Gate. Welcome back to campus!`
            );
          } else {
            botSay(
              `🏡 **Home Visit Departure Confirmed by Security!**\n\n` +
              `✅ Movement: *Campus Exit (Home Visit)*\n` +
              `📍 Destination: *${destination}*\n` +
              (leaveDate && returnDate ? `📅 Approved Leave: *${leaveDate}* to *${returnDate}*\n` : '') +
              `⏰ Verified at: *${scanTime}*\n` +
              `👮 Scanned at Main Campus Security Gate. Have a safe journey home!`
            );
          }
        } else {
          // Daily In/Out Pass
          let scanType = 'IN';
          let title = 'Campus Entry Verified';
          let subtitle = 'Security scanned your pass. Welcome back to campus!';
          let destination = latestLog?.place || (s.currentStatus === 'OUT' ? 'Out of Campus' : 'Hostel Campus');
          let scanTime = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

          if (latestLog && latestLog.status === 'OUT') {
            scanType = 'OUT';
            title = 'Campus Exit Verified';
            subtitle = 'Security scanned your QR code at the gate. Have a safe journey!';
            destination = latestLog.place || 'Out of Campus';
            if (latestLog.out_time || latestLog.timestamp) {
              scanTime = new Date(latestLog.out_time || latestLog.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
            }
          } else if (latestLog && (latestLog.status === 'IN' || latestLog.in_time)) {
            scanType = 'IN';
            title = 'Campus Entry Verified';
            subtitle = 'Security scanned your QR code at the gate. Welcome back!';
            destination = latestLog.place || 'Hostel Campus';
            if (latestLog.in_time) {
              scanTime = new Date(latestLog.in_time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
            }
          } else if (s.currentStatus === 'OUT') {
            scanType = 'OUT';
            title = 'Campus Exit Recorded';
            subtitle = 'Security scanned your pass. You are marked OUT.';
          } else {
            scanType = 'IN';
            title = 'Campus Entry Recorded';
            subtitle = 'Security scanned your pass. You are marked IN.';
          }

          setScanAlertModal({
            isHomeVisit: false,
            scanType,
            title,
            subtitle,
            destination,
            scanTime,
            studentName: user?.name || 'Student',
            rollNo: user?.rollNo || '',
            hostel: user?.hostel || '',
          });

          botSay(
            `🛡️ **Gate Scan Confirmed by Security!**\n\n` +
            `✅ Movement: *${scanType === 'OUT' ? 'Campus Exit (OUT)' : 'Campus Entry (IN)'}*\n` +
            `${destination ? `📍 Location: *${destination}*\n` : ''}` +
            `⏰ Verified at: *${scanTime}*\n` +
            `👮 Scanned at Main Campus Security Gate.`
          );
        }
      }
    } catch {
      // background silent check
    } finally {
      isPollingRef.current = false;
    }
  }, [parseActivePasses, user, botSay]);

  useEffect(() => {
    if (!user) return;
    checkActivePassSilently();
    const interval = setInterval(() => {
      checkActivePassSilently();
    }, 2500);
    return () => clearInterval(interval);
  }, [user, checkActivePassSilently]);

  const handleQuickViewQR = async () => {
    setQrQuickLoading(true);
    try {
      const res = await api.get('/student/status');
      const s = res.data?.status;
      const passes = parseActivePasses(s);
      setActivePasses(passes);

      const qrMap = {};
      if (s?.approvedVisits?.length > 0) {
        s.approvedVisits.forEach((v) => {
          if (v.qrDataUrl) {
            const phase = v.qr_used_out ? 'return' : 'departure';
            qrMap[`qr_${v._id}`] = {
              qrDataUrl: v.qrDataUrl,
              qrToken: v.qr_token,
              passKind: 'home_visit',
              scanPhase: phase,
              scanType: phase === 'return' ? 'HOME RETURN' : 'HOME VISIT',
              leaveDate: v.leave_date,
              returnDate: v.return_date,
            };
          }
        });
      }
      if (Object.keys(qrMap).length > 0) {
        setHvData((prev) => ({ ...prev, ...qrMap }));
      }

      if (passes.length > 0) {
        setZoomedQR({
          dataUrl: passes[0].qrDataUrl,
          ...passes[0],
        });
      } else if (s?.pendingVisits?.length > 0) {
        toast('Your Home Visit request is pending approval. QR will appear once approved.', { icon: '⏳' });
      } else {
        toast('No active QR code found. You can request a pass from the chat menu.', { icon: 'ℹ️' });
      }
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Could not fetch current QR status.');
    } finally {
      setQrQuickLoading(false);
    }
  };

  const fetchStatus = async () => {
    setLoading(true);
    try {
      const res = await api.get('/student/status');
      const s = res.data.status;
      const passes = parseActivePasses(s);
      setActivePasses(passes);

      let statusMsg = `📊 *Your Current Status*\n\n`;
      statusMsg += `🚦 Right now: *${s.currentStatus}*`;
      if (s.outSince) {
        statusMsg += `\n⏰ Out since: ${new Date(s.outSince).toLocaleTimeString('en-IN')}`;
      }

      if (s.pendingInOutRequest) {
        statusMsg += `\n\n🛂 *Active In/Out Gate Pass:*`;
        statusMsg += `\nType: ${s.pendingInOutRequest.scanType}`;
        if (s.pendingInOutRequest.place) {
          statusMsg += `\n📍 Location: ${s.pendingInOutRequest.place}`;
        }
        if (s.pendingInOutRequest.reason) {
          statusMsg += `\n📝 Reason: ${s.pendingInOutRequest.reason}`;
        }
        if (s.pendingInOutRequest.expiresAt) {
          statusMsg += `\nExpires: ${new Date(s.pendingInOutRequest.expiresAt).toLocaleTimeString('en-IN')}`;
        } else {
          statusMsg += `\nStatus: QR active for return scan`;
        }
      }

      if (s.pendingVisits?.length > 0) {
        statusMsg += `\n\n🏠 *Pending Home Visits:*`;
        s.pendingVisits.forEach((v, i) => {
          statusMsg += `\n${i + 1}. ${v.leave_date} → ${v.return_date} (${v.overall_status})`;
        });
      }

      const statusButtons = [];
      const qrMap = {};

      if (s.approvedVisits?.length > 0) {
        statusMsg += `\n\n✅ *Active Home Visit Passes:*`;
        s.approvedVisits.forEach((v, i) => {
          statusMsg += `\n${i + 1}. ${v.leave_date} → ${v.return_date} — scannable gate pass ready`;
          if (v.qrDataUrl) {
            const phase = v.qr_used_out ? 'return' : 'departure';
            statusButtons.push({
              id: `qr_${v._id}`,
              label: `View Home Visit QR ${i + 1}`,
              icon: '📲',
            });
            qrMap[`qr_${v._id}`] = {
              qrDataUrl: v.qrDataUrl,
              qrToken: v.qr_token,
              passKind: 'home_visit',
              scanPhase: phase,
              scanType: phase === 'return' ? 'HOME RETURN' : 'HOME VISIT',
              leaveDate: v.leave_date,
              returnDate: v.return_date,
            };
          }
        });
      }

      if (s.recentComplaints?.length > 0) {
        statusMsg += `\n\n🧾 *Recent Complaints:*`;
        s.recentComplaints.forEach((c, i) => {
          const emoji = c.status === 'resolved' ? '✅' : c.status === 'in_progress' ? '🔄' : '⏳';
          statusMsg += `\n${i + 1}. ${emoji} ${c.hostel} — ${c.status}`;
        });
      }

      // Removed recentVisitHistory to keep the status output clean and prevent showing discarded/completed passes

      if (Object.keys(qrMap).length > 0) {
        setHvData(prev => ({ ...prev, ...qrMap }));
      }

      if (statusButtons.length > 0) {
        statusMsg += '\n\n📲 Tap a button below to open your home visit QR.';
        botSay(statusMsg, 'buttons', { buttons: statusButtons });
      } else {
        botSay(statusMsg);
      }

      // Daily in/out only — home visit QR opens via button (prevents duplicate cards).
      if (s.pendingInOutRequest?.qrDataUrl) {
        pushQrMessage({
          qrDataUrl: s.pendingInOutRequest.qrDataUrl,
          scanType: s.pendingInOutRequest.scanType,
          student: user,
          place: s.pendingInOutRequest.place,
          reason: s.pendingInOutRequest.reason,
          passKind: 'inout',
        });
        goToMainMenu();
      } else {
        goToMainMenu();
      }
    } catch (err) {
      botSay(`❌ ${err.response?.data?.message || 'Could not fetch status.'}`);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
    } finally {
      toast.success('Logged out successfully');
      navigate('/login', { replace: true });
    }
  };

  const downloadQR = (dataUrl, filename = 'gate-pass.png') => {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    a.click();
  };

  // ── Render message bubbles ────────────────────────────────────────────────
  const renderBubble = (m) => {
    const isUser = m.sender === USER;
    const bubbleBase = {
      maxWidth: isMobile ? '92%' : '75%',
      padding: '10px 14px 6px',
      borderRadius: isUser ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
      fontSize: 14,
      lineHeight: 1.55,
      boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
    };

    if (m.type === 'qr') {
      const pass = getPassDisplay(m.meta);
      return (
        <div style={{ maxWidth: 280, alignSelf: 'flex-start' }}>
          <div style={{
            background: 'var(--bg-card)',
            borderRadius: 16, overflow: 'hidden',
            boxShadow: 'var(--shadow-md)',
            border: '1px solid var(--glass-border)',
          }}>
            {/* Header */}
            <div style={{
              padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10,
              borderBottom: '1px solid var(--glass-border)',
            }}>
              <div style={{
                width: 36, height: 36, borderRadius: 8,
                background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <MdQrCode2 size={20} color="#fff" />
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-primary)' }}>
                  🛡️ {pass.cardTitle}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {pass.cardSubtitle}
                </div>
              </div>
            </div>

            {/* QR image */}
            <div style={{
              padding: 16, display: 'flex', flexDirection: 'column',
              alignItems: 'center', gap: 10,
              cursor: 'zoom-in',
            }} onClick={() => setZoomedQR({ dataUrl: m.meta.qrDataUrl, ...pass })}>
              {m.meta.qrDataUrl ? (
                <div style={{
                  background: '#ffffff',
                  padding: 12,
                  borderRadius: 14,
                  boxShadow: '0 4px 20px rgba(0,0,0,0.18)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  <img
                    key={m.meta.qrToken || m.id}
                    src={m.meta.qrDataUrl}
                    alt="Gate pass QR code"
                    style={{
                      width: 210,
                      height: 210,
                      borderRadius: 0,
                      display: 'block',
                      imageRendering: 'pixelated',
                    }}
                  />
                </div>
              ) : (
                <div style={{ width: 200, height: 200, background: 'var(--bg-input)',
                  borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#8696a0', fontSize: 12 }}>Loading QR...</div>
              )}
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>
                {pass.hint}
              </div>
            </div>

            {/* Instructions at downside */}
            <div
              style={{
                width: '100%',
                padding: '12px 14px',
                borderTop: '1px solid var(--glass-border, rgba(255, 255, 255, 0.08))',
                background: pass.instructionType === 'OUT'
                  ? (theme === 'light' ? '#fef2f2' : 'rgba(239, 68, 68, 0.18)')
                  : pass.instructionType === 'IN'
                  ? (theme === 'light' ? '#ecfdf5' : 'rgba(16, 185, 129, 0.18)')
                  : (theme === 'light' ? '#eef2ff' : 'rgba(99, 102, 241, 0.18)'),
                color: pass.instructionType === 'OUT'
                  ? (theme === 'light' ? '#991b1b' : '#fca5a5')
                  : pass.instructionType === 'IN'
                  ? (theme === 'light' ? '#065f46' : '#6ee7b7')
                  : (theme === 'light' ? '#312e81' : '#c7d2fe'),
                fontSize: 13,
                fontWeight: 800,
                textAlign: 'center',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                lineHeight: 1.35,
                borderBottomLeftRadius: 16,
                borderBottomRightRadius: 16,
                boxShadow: theme === 'light' ? 'inset 0 1px 0 rgba(0,0,0,0.04)' : 'none',
              }}
            >
              <span>{pass.instruction}</span>
            </div>
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4, paddingLeft: 4 }}>
            {m.time}
          </div>
        </div>
      );
    }

    if (m.type === 'buttons') {
      const latestButtonsId = [...messages].reverse().find((msg) => msg.type === 'buttons')?.id;
      const isLatestButtons = m.id === latestButtonsId;
      const hasFlowActions = m.meta.buttons?.some((btn) => btn.id?.startsWith('flow_'));
      const hasQrActions = m.meta.buttons?.some((btn) => btn.id?.startsWith('qr_'));
      const isInteractiveButtons = isLatestButtons || hasFlowActions || hasQrActions;
      return (
        <div style={{ alignSelf: 'flex-start', maxWidth: '80%', opacity: isInteractiveButtons ? 1 : 0.5, pointerEvents: isInteractiveButtons ? 'auto' : 'none' }}>
          {/* Text bubble */}
          <div style={{
            ...bubbleBase,
            background: 'var(--bg-card)',
            border: '1px solid var(--glass-border)',
            color: 'var(--text-primary)',
            marginBottom: 8,
          }}>
            {formatChatContent(m.content)}
            <div style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'right', marginTop: 4 }}>
              {m.time}
            </div>
          </div>
          {/* Quick-reply buttons */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {m.meta.buttons.map((btn) => {
              const isFlowBtn = btn.id?.startsWith('flow_');
              const isQrBtn = btn.id?.startsWith('qr_');
              const canClick = isLatestButtons || isFlowBtn || isQrBtn;
              return (
                <button
                  key={btn.id}
                  id={`btn-${btn.id}`}
                  className="chat-quick-reply-btn"
                  onClick={() => canClick && handleButton(btn.id, btn.label)}
                  disabled={loading || !canClick}
                >
                  {btn.label}
                </button>
              );
            })}
          </div>
        </div>
      );
    }

    if (m.type === 'date_picker') {
      const pickerStep = m.meta?.pickerStep || STEPS.HV_LEAVE;
      const leaveDateForPicker = m.meta?.leaveDate || hvData.leave_date;
      const isActiveDatePicker =
        step === pickerStep &&
        (pickerStep === STEPS.HV_LEAVE || pickerStep === STEPS.HV_RETURN);
      const dateMin = pickerStep === STEPS.HV_RETURN
        ? (leaveDateForPicker ? addDaysToDateStr(leaveDateForPicker, 1) : getTodayDateString())
        : getTodayDateString();
      const dateMax = pickerStep === STEPS.HV_RETURN && leaveDateForPicker
        ? getMaxReturnDateFromLeave(leaveDateForPicker)
        : undefined;
      const isReturn = pickerStep === STEPS.HV_RETURN;
      return (
        <div
          className="chat-date-picker-wrap"
          style={{
            alignSelf: 'flex-start',
            width: 'min(100%, 320px)',
            opacity: isActiveDatePicker ? 1 : 0.5,
          }}
        >
          <div style={{
            ...bubbleBase,
            background: 'var(--bg-card)',
            border: '1px solid var(--glass-border)',
            color: 'var(--text-primary)',
            marginBottom: 10,
            maxWidth: '100%',
          }}>
            {formatChatContent(m.content)}
            <div style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'right', marginTop: 4 }}>
              {m.time}
            </div>
          </div>
          <ChatDatePicker
            key={`${m.id}-${pickerStep}-${dateMin}`}
            label={isReturn ? 'Select return date' : 'Select leave date'}
            min={dateMin}
            max={dateMax}
            isReturnStep={isReturn}
            disabled={loading || !isActiveDatePicker}
            onConfirm={(value) => processHomeVisitDate(value, pickerStep, { echoUser: true })}
          />
          {isActiveDatePicker && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
              {FLOW_RECOVERY_BUTTONS.map((btn) => (
                <button
                  key={btn.id}
                  type="button"
                  className="chat-quick-reply-btn"
                  disabled={loading}
                  onClick={() => handleButton(btn.id, btn.label)}
                  style={{ padding: '6px 12px', fontSize: 12 }}
                >
                  {btn.label}
                </button>
              ))}
            </div>
          )}
        </div>
      );
    }

    if (m.type === 'complaint_photo') {
      const typeLabel = m.meta?.complaintTypeLabel || hvData.complaint_type_label || 'Maintenance Issue';
      const isActive = step === STEPS.CPL_PHOTO;

      return (
        <div style={{
          alignSelf: 'flex-start',
          width: 'min(100%, 360px)',
          opacity: isActive ? 1 : 0.65,
          pointerEvents: isActive ? 'auto' : 'none',
        }}>
          {/* Bot prompt bubble */}
          <div style={{
            ...bubbleBase,
            background: 'var(--bg-card)',
            border: '1px solid var(--glass-border)',
            color: 'var(--text-primary)',
            marginBottom: 10,
          }}>
            {formatChatContent(m.content)}
            <div style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'right', marginTop: 4 }}>
              {m.time}
            </div>
          </div>

          {/* Interactive photo capture card */}
          <div style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--glass-border)',
            borderRadius: 16,
            padding: 16,
            boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}>
            {/* If photo is selected: preview */}
            {complaintPhoto ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{
                  position: 'relative',
                  borderRadius: 12,
                  overflow: 'hidden',
                  border: '1px solid var(--glass-border)',
                  background: '#000',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  maxHeight: 220,
                }}>
                  <img
                    src={complaintPhoto}
                    alt="Complaint preview"
                    style={{ width: '100%', maxHeight: 220, objectFit: 'contain', display: 'block' }}
                  />
                  <button
                    type="button"
                    onClick={() => setComplaintPhoto(null)}
                    style={{
                      position: 'absolute', top: 8, right: 8,
                      width: 28, height: 28, borderRadius: '50%',
                      background: 'rgba(0,0,0,0.65)', color: '#fff',
                      border: 'none', cursor: 'pointer', display: 'flex',
                      alignItems: 'center', justifyContent: 'center',
                    }}
                    title="Remove photo"
                  >
                    <MdClose size={16} />
                  </button>
                </div>

                <div>
                  <input
                    type="text"
                    placeholder="Add room number or details (Optional)"
                    value={complaintNote}
                    onChange={(e) => setComplaintNote(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '9px 14px',
                      borderRadius: 10,
                      border: '1px solid var(--glass-border)',
                      background: 'var(--bg-input)',
                      color: 'var(--text-primary)',
                      fontSize: 13,
                      boxSizing: 'border-box',
                      outline: 'none',
                    }}
                  />
                </div>

                <button
                  type="button"
                  onClick={() => submitComplaintWithPhoto(complaintPhoto, complaintNote)}
                  disabled={loading}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    padding: '11px 16px',
                    borderRadius: 10,
                    background: 'linear-gradient(135deg, #10b981, #059669)',
                    color: '#fff',
                    fontWeight: 700,
                    fontSize: 14,
                    border: 'none',
                    cursor: loading ? 'not-allowed' : 'pointer',
                    boxShadow: '0 4px 12px rgba(16, 185, 129, 0.3)',
                    transition: 'all 0.2s',
                  }}
                >
                  {loading ? (
                    <span className="loading-spinner" style={{ width: 16, height: 16 }} />
                  ) : (
                    <>
                      <MdSend size={16} /> Submit Complaint to Hostel Staff
                    </>
                  )}
                </button>

                <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                  <button
                    type="button"
                    onClick={() => complaintCameraRef.current?.click()}
                    style={{
                      background: 'none', border: 'none', color: 'var(--primary-light)',
                      fontSize: 12, cursor: 'pointer', textDecoration: 'underline',
                    }}
                  >
                    🔄 Retake Photo
                  </button>
                </div>
              </div>
            ) : (
              /* Photo capture buttons */
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {isCompressingPhoto || loading ? (
                  <div style={{ textAlign: 'center', padding: '16px 0' }}>
                    <div className="loading-spinner" style={{ width: 24, height: 24, margin: '0 auto 8px' }} />
                    <span style={{ fontSize: 13, color: 'var(--primary-light)', fontWeight: 600 }}>
                      Uploading photo & sending complaint to hostel staff...
                    </span>
                  </div>
                ) : (
                  <>
                    <input
                      type="text"
                      placeholder="Add room no. or issue details (Optional)"
                      value={complaintNote}
                      onChange={(e) => setComplaintNote(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '9px 14px',
                        borderRadius: 10,
                        border: '1px solid var(--glass-border)',
                        background: 'var(--bg-input)',
                        color: 'var(--text-primary)',
                        fontSize: 13,
                        boxSizing: 'border-box',
                        outline: 'none',
                      }}
                    />

                    <button
                      type="button"
                      onClick={() => {
                        window.__filePickerActive = true;
                        complaintCameraRef.current?.click();
                        setTimeout(() => { window.__filePickerActive = false; }, 4000);
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 8,
                        padding: '11px 16px',
                        borderRadius: 10,
                        background: 'var(--primary)',
                        color: '#fff',
                        fontWeight: 700,
                        fontSize: 13.5,
                        border: 'none',
                        cursor: 'pointer',
                        boxShadow: '0 4px 14px rgba(99, 102, 241, 0.3)',
                      }}
                    >
                      <MdPhotoCamera size={18} /> 📸 Click Photo & Send to Hostel Staff
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        window.__filePickerActive = true;
                        complaintFileRef.current?.click();
                        setTimeout(() => { window.__filePickerActive = false; }, 4000);
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 8,
                        padding: '10px 16px',
                        borderRadius: 10,
                        background: 'transparent',
                        color: 'var(--text-primary)',
                        border: '1px solid var(--glass-border)',
                        fontWeight: 600,
                        fontSize: 13,
                        cursor: 'pointer',
                      }}
                    >
                      <MdUpload size={18} /> 📁 Upload Photo & Send to Hostel Staff
                    </button>
                  </>
                )}

                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  paddingTop: 8,
                  borderTop: '1px solid var(--glass-border)',
                }}>
                  <button
                    type="button"
                    onClick={() => {
                      setStep(STEPS.CPL_TEXT);
                      botSay('📝 Please type your detailed complaint description:');
                    }}
                    style={{
                      background: 'none', border: 'none', color: 'var(--text-muted)',
                      fontSize: 12, cursor: 'pointer', textDecoration: 'underline',
                    }}
                  >
                    ⏩ Skip photo & type text
                  </button>

                  <button
                    type="button"
                    onClick={goToMainMenu}
                    style={{
                      background: 'none', border: 'none', color: 'var(--text-muted)',
                      fontSize: 12, cursor: 'pointer',
                    }}
                  >
                    🏠 Main menu
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      );
    }

    // Plain text bubble
    return (
      <div style={{
        ...bubbleBase,
        alignSelf: isUser ? 'flex-end' : 'flex-start',
        background: isUser ? 'var(--primary)' : 'var(--bg-card)',
        border: isUser ? 'none' : '1px solid var(--glass-border)',
        color: isUser ? '#fff' : 'var(--text-primary)',
      }}>
        {formatChatContent(m.content)}
        {m.meta?.photo && (
          <div style={{
            marginTop: 8,
            borderRadius: 10,
            overflow: 'hidden',
            border: '1px solid var(--glass-border)',
            background: 'rgba(0, 0, 0, 0.25)',
            maxHeight: 220,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <img
              src={m.meta.photo}
              alt="Complaint evidence"
              style={{
                width: '100%',
                maxHeight: 220,
                objectFit: 'contain',
                display: 'block',
              }}
            />
          </div>
        )}
        <div style={{
          fontSize: 10, marginTop: 4, textAlign: 'right',
          color: isUser ? 'rgba(255,255,255,0.6)' : 'var(--text-muted)',
        }}>
          {m.time}
          {isUser && <span style={{ marginLeft: 4 }}>✓✓</span>}
        </div>
      </div>
    );
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <AntiScreenshotShield>
      <div style={{ display: 'flex', height: 'var(--app-viewport-height)', minHeight: 'var(--app-viewport-height)', overflow: 'hidden', background: 'var(--bg-base)', fontFamily: 'Inter, sans-serif' }}>

      {/* ── Left Sidebar ── */}
      <aside style={{
        width: 240, background: 'var(--bg-surface)',
        borderRight: '1px solid var(--glass-border)',
        display: 'flex', flexDirection: 'column',
        padding: 0, flexShrink: 0,
        ...(isMobile ? { display: 'none' } : {}),
      }}>
        {/* Brand */}
        <div style={{
          padding: '20px 20px 16px',
          borderBottom: '1px solid var(--glass-border)',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}>
          <img
            src={theme === 'light' ? BOT_LOGO_LIGHT : BOT_LOGO_DARK}
            alt="HEIMDALL"
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              objectFit: 'cover',
              border: theme === 'light' ? '1.5px solid rgba(99, 102, 241, 0.25)' : '1.5px solid rgba(139, 92, 246, 0.45)',
              boxShadow: theme === 'light' ? '0 2px 8px rgba(0,0,0,0.06)' : '0 2px 10px rgba(99,102,241,0.3)',
            }}
          />
          <div>
            <div style={{ fontWeight: 800, fontSize: 16, color: 'var(--text-primary)', letterSpacing: '0.02em' }}>
              HEIMDALL
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
              Student Portal
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav style={{ padding: '12px 0', flex: 1 }}>
          {[
            { icon: <MdDashboard />, label: 'My Chatbot', active: true },
          ].map((item) => (
            <div key={item.label} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 20px', fontSize: 13.5, fontWeight: 600,
              background: item.active ? 'rgba(99,102,241,0.15)' : 'transparent',
              color: item.active ? 'var(--primary-light)' : 'var(--text-muted)',
              borderLeft: item.active ? '3px solid var(--primary)' : '3px solid transparent',
              cursor: 'pointer',
            }}>
              {item.icon} {item.label}
            </div>
          ))}
        </nav>

        {/* User card */}
        <div style={{
          padding: '16px 20px', borderTop: '1px solid var(--glass-border)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <div style={{ flexShrink: 0 }}>
              <StudentAvatar
                student={user}
                size={44}
                style={{
                  border: '2px solid rgba(99, 102, 241, 0.65)',
                  boxShadow: '0 2px 10px rgba(0, 0, 0, 0.25)',
                }}
              />
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user?.name}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>
                {user?.rollNo} · {user?.hostel}
              </div>
            </div>
          </div>
          <button onClick={handleLogout}
            style={{
              width: '100%', padding: '8px 0', borderRadius: 8,
              border: '1px solid rgba(239,68,68,0.3)',
              background: 'rgba(239,68,68,0.08)',
              color: '#f87171', fontSize: 13, fontWeight: 600,
              cursor: 'pointer', display: 'flex', alignItems: 'center',
              justifyContent: 'center', gap: 6,
              transition: 'all 0.15s ease',
            }}>
            <MdLogout size={15} /> Logout
          </button>
        </div>
      </aside>

      {/* ── Chat Area ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>

        {/* Header */}
        {isMobile ? (
          <div style={{
            padding: '8px 12px',
            background: 'var(--bg-card)',
            borderBottom: '1px solid var(--glass-border)',
            boxShadow: 'var(--shadow-sm)',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}>
            {/* Mobile Row 1: Bot info (left) & Show QR Pass + Theme Toggle (right) */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <div
                  className="chatbot-avatar"
                  style={{
                    background: theme === 'light' ? '#ffffff' : '#0c0b2f',
                    border: theme === 'light' ? '1.5px solid rgba(99, 102, 241, 0.25)' : '1.5px solid rgba(139, 92, 246, 0.45)',
                    boxShadow: theme === 'light' ? '0 2px 8px rgba(0,0,0,0.06)' : '0 0 12px rgba(99, 102, 241, 0.35)',
                    width: 36,
                    height: 36,
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                    flexShrink: 0,
                  }}
                >
                  <img
                    src={theme === 'light' ? BOT_LOGO_LIGHT : BOT_LOGO_DARK}
                    alt="HEIMDALL Bot"
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 800, fontSize: 14.5, color: 'var(--text-primary)', letterSpacing: '0.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    HEIMDALL Bot
                  </div>
                  <div style={{ fontSize: 11, color: '#10b981', display: 'flex', alignItems: 'center', gap: 4, fontWeight: 500 }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981', display: 'inline-block', boxShadow: '0 0 5px #10b981' }} />
                    Online
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                {/* View Status / Active QR Pass Button */}
                <button
                  onClick={handleQuickViewQR}
                  disabled={qrQuickLoading}
                  title={activePasses.length > 0 ? "Active Gate Pass Ready — Click to View QR" : "Show Gate Pass QR / Status"}
                  aria-label="View Active QR Pass"
                  className={`student-qr-gatepass-btn ${activePasses.length > 0 ? 'active' : 'idle'}`}
                  style={{ padding: '6px 12px', fontSize: 12, gap: 5 }}
                >
                  <MdQrCode2
                    size={18}
                    style={{
                      animation: qrQuickLoading ? 'spin 1s linear infinite' : 'none',
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ letterSpacing: '0.01em', whiteSpace: 'nowrap' }}>
                    {activePasses.length > 0 ? 'Show QR Pass' : 'Gate Pass QR'}
                  </span>
                  {activePasses.length > 0 && (
                    <span
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: '50%',
                        background: '#ffffff',
                        boxShadow: '0 0 6px #ffffff',
                        display: 'inline-block',
                        marginLeft: 2,
                      }}
                    />
                  )}
                </button>

                {/* Theme Toggle */}
                <button
                  onClick={toggleTheme}
                  style={{
                    background: 'var(--bg-input, rgba(255, 255, 255, 0.05))',
                    border: '1px solid var(--border-color, rgba(255, 255, 255, 0.1))',
                    color: 'var(--text-secondary, #cbd5e1)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    transition: 'all 0.2s ease',
                    flexShrink: 0,
                  }}
                  aria-label="Toggle theme"
                  title={theme === 'light' ? 'Switch to Dark Mode' : 'Switch to Light Mode'}
                >
                  {theme === 'light' ? <MdDarkMode size={16} /> : <MdLightMode size={16} />}
                </button>
              </div>
            </div>

            {/* Mobile Row 2: Student part (left) & Logout button (right) */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              paddingTop: 6,
              borderTop: '1px solid var(--glass-border)',
            }}>
              <div style={{
                padding: '4px 10px',
                borderRadius: 99,
                fontSize: 11.5,
                fontWeight: 700,
                background: 'rgba(99,102,241,0.12)',
                color: 'var(--primary-light)',
                border: '1px solid rgba(99,102,241,0.25)',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                minWidth: 0,
              }}>
                <StudentAvatar student={user} size={20} style={{ flexShrink: 0 }} />
                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  🎓 {user?.name ? `${user.name.split(' ')[0]} (Student)` : 'Student'}
                </span>
              </div>

              <button
                onClick={handleLogout}
                style={{
                  padding: '5px 12px',
                  borderRadius: 99,
                  fontSize: 11.5,
                  fontWeight: 700,
                  border: '1px solid rgba(239,68,68,0.35)',
                  background: 'rgba(239,68,68,0.08)',
                  color: '#f87171',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  flexShrink: 0,
                }}
              >
                <MdLogout size={13} /> Logout
              </button>
            </div>
          </div>
        ) : (
          <div style={{
            padding: '14px 24px',
            background: 'var(--bg-card)',
            borderBottom: '1px solid var(--glass-border)',
            display: 'flex', alignItems: 'center', gap: 14,
            boxShadow: 'var(--shadow-sm)',
          }}>
            <div
              className="chatbot-avatar"
              style={{
                background: theme === 'light' ? '#ffffff' : '#0c0b2f',
                border: theme === 'light' ? '1.5px solid rgba(99, 102, 241, 0.25)' : '1.5px solid rgba(139, 92, 246, 0.45)',
                boxShadow: theme === 'light' ? '0 2px 10px rgba(0,0,0,0.06)' : '0 0 16px rgba(99, 102, 241, 0.35)',
                width: 44,
                height: 44,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
                flexShrink: 0,
              }}
            >
              <img
                src={theme === 'light' ? BOT_LOGO_LIGHT : BOT_LOGO_DARK}
                alt="HEIMDALL Bot"
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                }}
              />
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: 16, color: 'var(--text-primary)', letterSpacing: '0.02em' }}>
                HEIMDALL Bot
              </div>
              <div style={{ fontSize: 12, color: '#10b981', display: 'flex', alignItems: 'center', gap: 5, fontWeight: 500 }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#10b981', display: 'inline-block', boxShadow: '0 0 6px #10b981' }} />
                Online
              </div>
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'center' }}>
              {/* View Status / Active QR Pass Button */}
              <button
                onClick={handleQuickViewQR}
                disabled={qrQuickLoading}
                title={activePasses.length > 0 ? "Active Gate Pass Ready — Click to View QR" : "Show Gate Pass QR / Status"}
                aria-label="View Active QR Pass"
                className={`student-qr-gatepass-btn ${activePasses.length > 0 ? 'active' : 'idle'}`}
              >
                <MdQrCode2
                  size={22}
                  style={{
                    animation: qrQuickLoading ? 'spin 1s linear infinite' : 'none',
                    flexShrink: 0,
                  }}
                />
                <span style={{ letterSpacing: '0.01em', whiteSpace: 'nowrap' }}>
                  {activePasses.length > 0 ? 'Show QR Pass' : 'Gate Pass QR'}
                </span>
                {activePasses.length > 0 && (
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: '#ffffff',
                      boxShadow: '0 0 8px #ffffff',
                      display: 'inline-block',
                      marginLeft: 2,
                    }}
                  />
                )}
              </button>

              {/* Theme Toggle */}
              <button
                onClick={toggleTheme}
                style={{
                  background: 'var(--bg-input, rgba(255, 255, 255, 0.05))',
                  border: '1px solid var(--border-color, rgba(255, 255, 255, 0.1))',
                  color: 'var(--text-secondary, #cbd5e1)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '8px',
                  borderRadius: '50%',
                  transition: 'all 0.2s ease',
                }}
                aria-label="Toggle theme"
                title={theme === 'light' ? 'Switch to Dark Mode' : 'Switch to Light Mode'}
              >
                {theme === 'light' ? <MdDarkMode size={18} /> : <MdLightMode size={18} />}
              </button>

              <div style={{
                padding: '6px 14px', borderRadius: 99, fontSize: 11.5, fontWeight: 700,
                background: 'rgba(99,102,241,0.15)', color: 'var(--primary-light)',
                border: '1px solid rgba(99,102,241,0.3)',
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
                🎓 Student
              </div>
            </div>
          </div>
        )}

        {/* Visual Pull to Reload Banner */}
        {(pullY > 0 || isPullRefreshing) && (
          <div style={{
            position: 'absolute',
            top: isMobile ? 86 : 74,
            left: 0,
            right: 0,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 100,
            pointerEvents: 'none',
            transition: pullY === 0 ? 'all 0.2s ease' : 'none',
          }}>
            <div style={{
              background: theme === 'light' ? '#ffffff' : '#1e1b4b',
              color: 'var(--text-primary)',
              borderRadius: 999,
              padding: '6px 16px',
              fontSize: 12,
              fontWeight: 700,
              boxShadow: '0 4px 16px rgba(0, 0, 0, 0.25)',
              border: '1px solid rgba(99, 102, 241, 0.35)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              transform: `translateY(${pullY * 0.7}px)`,
              opacity: Math.min(1, pullY / 30),
            }}>
              <MdRefresh
                size={16}
                style={{
                  color: '#6366f1',
                  transform: `rotate(${pullY * 4.5}deg)`,
                  animation: isPullRefreshing ? 'spin 0.8s linear infinite' : 'none',
                }}
              />
              <span>
                {isPullRefreshing ? 'Reloading...' : pullY >= 50 ? 'Release to reload' : 'Pull down to reload'}
              </span>
            </div>
          </div>
        )}

        {/* Messages */}
        <div
          ref={messagesScrollRef}
          onTouchStart={handlePullStart}
          onTouchMove={handlePullMove}
          onTouchEnd={handlePullEnd}
          onTouchCancel={handlePullEnd}
          style={{
            flex: 1, overflowY: 'auto', padding: isMobile ? '12px 10px' : '20px 32px',
            display: 'flex', flexDirection: 'column', gap: 8,
            backgroundImage: 'radial-gradient(circle at 50% 50%, rgba(99,102,241,0.03) 0%, transparent 70%)',
            overscrollBehaviorY: 'auto',
          }}
        >
          {messages.map((m) => (
            <div key={m.id} style={{
              display: 'flex',
              justifyContent: m.sender === USER ? 'flex-end' : 'flex-start',
            }}>
              {renderBubble(m)}
            </div>
          ))}

          {/* Typing indicator */}
          {loading && (
            <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
              <div style={{
                padding: '10px 16px', borderRadius: '18px 18px 18px 4px',
                background: 'var(--bg-card)', border: '1px solid var(--glass-border)',
                display: 'flex', gap: 4, alignItems: 'center',
              }}>
                {[0,1,2].map(i => (
                  <div key={i} style={{
                    width: 6, height: 6, borderRadius: '50%',
                    background: 'var(--text-muted)',
                    animation: `bounce 1s ${i * 0.2}s infinite`,
                  }} />
                ))}
              </div>
            </div>
          )}

          {/* Spacer to prevent date picker cutoff */}
          {messages[messages.length - 1]?.type === 'date_picker' && (
            <div className="chat-date-scroll-spacer" aria-hidden="true" />
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input bar */}
        {[STEPS.INOUT_OTHER, STEPS.HV_REASON_OTHER, STEPS.HV_PLACE, STEPS.CPL_TEXT].includes(step) && (
          <div style={{
            padding: isMobile ? '10px 10px' : '12px 24px',
            background: 'var(--bg-card)',
            borderTop: '1px solid var(--glass-border)',
          }}>
            <form onSubmit={handleSend} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <input
                id="chatbot-input"
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={
                  step === STEPS.HV_REASON_OTHER ? 'Type reason, or menu / cancel to exit...' :
                  step === STEPS.HV_PLACE
                    ? 'Type destination place, or menu to go back...' :
                  step === STEPS.INOUT_OTHER
                    ? 'Type destination, or menu to go back...' :
                  step === STEPS.CPL_PHOTO
                    ? 'Optional: type room number or notes for photo...' :
                  step === STEPS.CPL_TEXT   ? 'Describe complaint, or menu / cancel...' :
                  'Type a message...'
                }
                style={{
                  flex: 1, padding: '11px 18px', borderRadius: 24,
                  border: '1px solid var(--glass-border)',
                  background: 'var(--bg-input)',
                  color: 'var(--text-primary)', fontSize: 14, outline: 'none',
                }}
                disabled={loading}
                autoFocus
              />
              <button id="chatbot-send" type="submit" disabled={loading || !input.trim()}
                style={{
                  width: 44, height: 44, borderRadius: '50%', border: 'none',
                  background: loading || !input.trim() ? 'rgba(99,102,241,0.3)' : 'var(--primary)',
                  color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: loading || !input.trim() ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s', flexShrink: 0,
                }}>
                <MdSend size={18} style={{ marginLeft: 2 }} />
              </button>
            </form>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', marginTop: 6 }}>
              Type <strong>menu</strong> anytime to return to the main menu
            </div>
          </div>
        )}
      </div>

      {/* ── QR Zoom Modal ── */}
      {zoomedQR && (
        <div onClick={() => setZoomedQR(null)} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
          backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center',
          justifyContent: 'center', zIndex: 1000, cursor: 'zoom-out',
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: 'var(--bg-card)', borderRadius: 20, padding: isMobile ? '20px 16px' : '28px 32px',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14,
            border: '1px solid var(--glass-border)',
            maxWidth: '92vw',
            width: isMobile ? '92vw' : 'auto',
            cursor: 'default',
            boxShadow: '0 20px 50px rgba(0,0,0,0.4)',
          }}>
            {/* Multiple passes switcher if more than 1 pass active */}
            {activePasses.length > 1 && (
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 8,
                width: '100%',
                paddingBottom: 12,
                borderBottom: '1px solid var(--glass-border)',
              }}>
                <div style={{
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  color: theme === 'light' ? '#475569' : 'rgba(255, 255, 255, 0.7)',
                }}>
                  Select Active Pass to Present at Gate:
                </div>
                <div style={{
                  display: 'inline-flex',
                  gap: 6,
                  padding: 4,
                  borderRadius: 999,
                  background: theme === 'light' ? '#e2e8f0' : 'rgba(255, 255, 255, 0.08)',
                  border: theme === 'light' ? '1px solid #cbd5e1' : '1px solid rgba(255, 255, 255, 0.16)',
                  flexWrap: 'wrap',
                  justifyContent: 'center',
                  maxWidth: '100%',
                }}>
                  {activePasses.map((p, idx) => {
                    const isSelected = (zoomedQR.qrDataUrl || zoomedQR.dataUrl) === p.qrDataUrl;
                    const isHomeVisit = p.passKind === 'home_visit' || String(p.tabLabel).toLowerCase().includes('home');
                    return (
                      <button
                        key={p.id || idx}
                        onClick={() => setZoomedQR({ dataUrl: p.qrDataUrl, ...p })}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          padding: '7px 16px',
                          borderRadius: 999,
                          fontSize: 13,
                          fontWeight: 700,
                          cursor: 'pointer',
                          transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                          border: isSelected
                            ? '1.5px solid rgba(255, 255, 255, 0.4)'
                            : theme === 'light'
                              ? '1.5px solid #94a3b8'
                              : '1.5px solid rgba(255, 255, 255, 0.22)',
                          background: isSelected
                            ? 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)'
                            : theme === 'light'
                              ? '#ffffff'
                              : 'rgba(255, 255, 255, 0.1)',
                          color: isSelected
                            ? '#ffffff'
                            : theme === 'light'
                              ? '#0f172a'
                              : '#f8fafc',
                          boxShadow: isSelected
                            ? '0 3px 12px rgba(99, 102, 241, 0.45)'
                            : theme === 'light'
                              ? '0 1px 3px rgba(0, 0, 0, 0.08)'
                              : 'none',
                        }}
                      >
                        {isHomeVisit ? <MdHome size={16} /> : <MdExitToApp size={16} />}
                        <span>{p.tabLabel || `Pass ${idx + 1}`}</span>
                        {isSelected && (
                          <span style={{
                            width: 6,
                            height: 6,
                            borderRadius: '50%',
                            background: '#10b981',
                            boxShadow: '0 0 6px #10b981',
                            display: 'inline-block',
                          }} />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div style={{ textAlign: 'center' }}>
              <div style={{ fontWeight: 700, fontSize: 18, color: 'var(--text-primary)' }}>
                {zoomedQR.zoomTitle || 'Gate Pass QR'}
              </div>
              {zoomedQR.cardSubtitle && (
                <div style={{ fontSize: 13, fontWeight: 600, color: theme === 'light' ? '#334155' : 'var(--text-secondary)', marginTop: 2 }}>
                  {zoomedQR.cardSubtitle}
                </div>
              )}
            </div>

            {/* Live verification status stamp */}
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 7,
                padding: '5px 14px',
                borderRadius: 999,
                background: theme === 'light' ? '#ecfdf5' : 'rgba(16, 185, 129, 0.15)',
                border: '1px solid rgba(16, 185, 129, 0.45)',
                color: theme === 'light' ? '#065f46' : '#34d399',
                fontSize: 11.5,
                fontWeight: 700,
                letterSpacing: '0.02em',
                boxShadow: '0 2px 8px rgba(16, 185, 129, 0.15)',
              }}
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: '#10b981',
                  boxShadow: '0 0 8px #10b981',
                  display: 'inline-block',
                }}
              />
              <span>LIVE ACTIVE PASS • <LiveGatePassClock /></span>
            </div>

            {/* QR image */}
            <div style={{
              background: '#ffffff',
              padding: 16,
              borderRadius: 16,
              boxShadow: '0 8px 30px rgba(0,0,0,0.3)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              position: 'relative',
              userSelect: 'none',
              WebkitTouchCallout: 'none',
            }}>
              <img
                src={zoomedQR.dataUrl || zoomedQR.qrDataUrl}
                alt="Gate Pass QR"
                onContextMenu={(e) => e.preventDefault()}
                style={{
                  width: isMobile ? 220 : 280,
                  height: isMobile ? 220 : 280,
                  borderRadius: 0,
                  display: 'block',
                  imageRendering: 'pixelated',
                  pointerEvents: 'none',
                  userSelect: 'none',
                  WebkitUserDrag: 'none',
                }}
              />
            </div>

            {/* Directional instruction banner at downside */}
            <div
              style={{
                width: '100%',
                padding: '13px 16px',
                borderRadius: 12,
                background: zoomedQR.instructionType === 'OUT'
                  ? (theme === 'light' ? '#fef2f2' : 'rgba(239, 68, 68, 0.18)')
                  : zoomedQR.instructionType === 'IN'
                  ? (theme === 'light' ? '#ecfdf5' : 'rgba(16, 185, 129, 0.18)')
                  : (theme === 'light' ? '#eef2ff' : 'rgba(99, 102, 241, 0.18)'),
                color: zoomedQR.instructionType === 'OUT'
                  ? (theme === 'light' ? '#991b1b' : '#fca5a5')
                  : zoomedQR.instructionType === 'IN'
                  ? (theme === 'light' ? '#065f46' : '#6ee7b7')
                  : (theme === 'light' ? '#312e81' : '#c7d2fe'),
                fontSize: 14,
                fontWeight: 800,
                textAlign: 'center',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                border: zoomedQR.instructionType === 'OUT'
                  ? (theme === 'light' ? '1.5px solid #dc2626' : '1px solid rgba(239, 68, 68, 0.4)')
                  : zoomedQR.instructionType === 'IN'
                  ? (theme === 'light' ? '1.5px solid #059669' : '1px solid rgba(16, 185, 129, 0.4)')
                  : (theme === 'light' ? '1.5px solid #4f46e5' : '1px solid rgba(99, 102, 241, 0.4)'),
                boxShadow: theme === 'light' ? '0 2px 8px rgba(0, 0, 0, 0.05)' : 'none',
              }}
            >
              <span>{zoomedQR.instruction || 'Show this QR to security at the gate'}</span>
            </div>

            <button
              onClick={() => setZoomedQR(null)}
              style={{
                width: '100%',
                padding: '12px 0',
                borderRadius: 12,
                background: theme === 'light' ? '#f1f5f9' : 'rgba(255,255,255,0.08)',
                border: theme === 'light' ? '1px solid #cbd5e1' : 'none',
                color: theme === 'light' ? '#0f172a' : 'var(--text-primary)',
                fontSize: 14,
                cursor: 'pointer',
                fontWeight: 700,
                transition: 'all 0.15s ease',
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* ── FULL SCREEN SCAN VERIFICATION MODAL ── */}
      {scanAlertModal && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setScanAlertModal(null)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 999999,
            backgroundColor: 'rgba(8, 12, 22, 0.94)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            animation: 'fadeInModal 0.25s ease-out',
            overflowY: 'auto',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'relative',
              width: '100%',
              maxWidth: 480,
              background: scanAlertModal.isHomeVisit
                ? (scanAlertModal.homeVisitPhase === 'departure'
                    ? 'linear-gradient(180deg, rgba(28, 16, 44, 0.98) 0%, rgba(16, 10, 28, 0.99) 100%)'
                    : 'linear-gradient(180deg, rgba(8, 30, 24, 0.98) 0%, rgba(6, 18, 16, 0.99) 100%)')
                : (scanAlertModal.scanType === 'OUT'
                    ? 'linear-gradient(180deg, rgba(32, 16, 22, 0.97) 0%, rgba(18, 12, 16, 0.99) 100%)'
                    : 'linear-gradient(180deg, rgba(10, 32, 22, 0.97) 0%, rgba(10, 18, 16, 0.99) 100%)'),
              border: scanAlertModal.isHomeVisit
                ? (scanAlertModal.homeVisitPhase === 'departure'
                    ? '2px solid rgba(168, 85, 247, 0.6)'
                    : '2px solid rgba(16, 185, 129, 0.6)')
                : (scanAlertModal.scanType === 'OUT'
                    ? '2px solid rgba(244, 63, 94, 0.55)'
                    : '2px solid rgba(16, 185, 129, 0.55)'),
              borderRadius: 28,
              boxShadow: scanAlertModal.isHomeVisit
                ? (scanAlertModal.homeVisitPhase === 'departure'
                    ? '0 0 60px rgba(168, 85, 247, 0.35), 0 25px 50px -12px rgba(0, 0, 0, 0.85)'
                    : '0 0 60px rgba(16, 185, 129, 0.35), 0 25px 50px -12px rgba(0, 0, 0, 0.85)')
                : (scanAlertModal.scanType === 'OUT'
                    ? '0 0 60px rgba(244, 63, 94, 0.35), 0 25px 50px -12px rgba(0, 0, 0, 0.85)'
                    : '0 0 60px rgba(16, 185, 129, 0.35), 0 25px 50px -12px rgba(0, 0, 0, 0.85)'),
              padding: '32px 24px',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 20,
              animation: 'scaleUpModal 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            {/* College Logo & Security Pill */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <img
                src={iiitLogo}
                alt="IIIT Pune"
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
                style={{
                  width: 38,
                  height: 38,
                  objectFit: 'contain',
                  filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.4))',
                }}
              />
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '5px 12px',
                  borderRadius: 9999,
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  background: scanAlertModal.isHomeVisit
                    ? (scanAlertModal.homeVisitPhase === 'departure'
                        ? 'rgba(99, 102, 241, 0.2)'
                        : 'rgba(16, 185, 129, 0.2)')
                    : (scanAlertModal.scanType === 'OUT'
                        ? 'rgba(244, 63, 94, 0.15)'
                        : 'rgba(16, 185, 129, 0.15)'),
                  color: scanAlertModal.isHomeVisit
                    ? (scanAlertModal.homeVisitPhase === 'departure' ? '#c4b5fd' : '#6ee7b7')
                    : (scanAlertModal.scanType === 'OUT' ? '#fda4af' : '#6ee7b7'),
                  border: scanAlertModal.isHomeVisit
                    ? (scanAlertModal.homeVisitPhase === 'departure'
                        ? '1px solid rgba(168, 85, 247, 0.45)'
                        : '1px solid rgba(16, 185, 129, 0.45)')
                    : (scanAlertModal.scanType === 'OUT'
                        ? '1px solid rgba(244, 63, 94, 0.35)'
                        : '1px solid rgba(16, 185, 129, 0.35)'),
                  boxShadow: scanAlertModal.isHomeVisit ? '0 0 12px rgba(124, 58, 237, 0.25)' : undefined,
                }}
              >
                <span>
                  {scanAlertModal.isHomeVisit
                    ? (scanAlertModal.homeVisitPhase === 'departure'
                        ? '🏡 Home Visit · Departure'
                        : '🏡 Home Visit · Welcome Back')
                    : '🛡️ Gate Security Verified'}
                </span>
              </span>
            </div>

            {/* Glowing Radar Pulse Icon */}
            <div
              style={{
                position: 'relative',
                width: 96,
                height: 96,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginTop: 4,
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  inset: -8,
                  borderRadius: '50%',
                  background: scanAlertModal.isHomeVisit
                    ? (scanAlertModal.homeVisitPhase === 'departure'
                        ? 'radial-gradient(circle, rgba(168, 85, 247, 0.45) 0%, rgba(168, 85, 247, 0) 70%)'
                        : 'radial-gradient(circle, rgba(16, 185, 129, 0.45) 0%, rgba(16, 185, 129, 0) 70%)')
                    : (scanAlertModal.scanType === 'OUT'
                        ? 'radial-gradient(circle, rgba(244, 63, 94, 0.45) 0%, rgba(244, 63, 94, 0) 70%)'
                        : 'radial-gradient(circle, rgba(16, 185, 129, 0.45) 0%, rgba(16, 185, 129, 0) 70%)'),
                  animation: 'pulseRingModal 2s cubic-bezier(0.455, 0.03, 0.515, 0.955) infinite',
                }}
              />
              <div
                style={{
                  width: 80,
                  height: 80,
                  borderRadius: '50%',
                  background: scanAlertModal.isHomeVisit
                    ? (scanAlertModal.homeVisitPhase === 'departure'
                        ? 'linear-gradient(135deg, #6366f1 0%, #9333ea 100%)'
                        : 'linear-gradient(135deg, #059669 0%, #0d9488 100%)')
                    : (scanAlertModal.scanType === 'OUT'
                        ? 'linear-gradient(135deg, #e11d48 0%, #be123c 100%)'
                        : 'linear-gradient(135deg, #059669 0%, #047857 100%)'),
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: scanAlertModal.isHomeVisit
                    ? (scanAlertModal.homeVisitPhase === 'departure'
                        ? '0 10px 25px rgba(147, 51, 234, 0.6)'
                        : '0 10px 25px rgba(5, 150, 105, 0.6)')
                    : (scanAlertModal.scanType === 'OUT'
                        ? '0 10px 25px rgba(225, 29, 72, 0.6)'
                        : '0 10px 25px rgba(5, 150, 105, 0.6)'),
                  color: '#ffffff',
                }}
              >
                {scanAlertModal.isHomeVisit ? (
                  scanAlertModal.homeVisitPhase === 'departure' ? (
                    <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                      <polyline points="9 22 9 12 15 12 15 22" />
                    </svg>
                  ) : (
                    <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                      <polyline points="22 4 12 14.01 9 11.01" />
                    </svg>
                  )
                ) : (
                  scanAlertModal.scanType === 'OUT' ? (
                    <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                      <polyline points="16 17 21 12 16 7" />
                      <line x1="21" y1="12" x2="9" y2="12" />
                    </svg>
                  ) : (
                    <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                      <polyline points="22 4 12 14.01 9 11.01" />
                    </svg>
                  )
                )}
              </div>
            </div>

            {/* Title & Subtitle */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <h2
                style={{
                  margin: 0,
                  fontSize: 23,
                  fontWeight: 900,
                  letterSpacing: '-0.02em',
                  color: '#ffffff',
                  textTransform: 'uppercase',
                }}
              >
                {scanAlertModal.title}
              </h2>
              <p
                style={{
                  margin: 0,
                  fontSize: 14,
                  color: 'rgba(255, 255, 255, 0.8)',
                  lineHeight: 1.45,
                }}
              >
                {scanAlertModal.subtitle}
              </p>
            </div>

            {/* Verification Detail Card */}
            <div
              style={{
                width: '100%',
                background: scanAlertModal.isHomeVisit
                  ? (scanAlertModal.homeVisitPhase === 'departure'
                      ? 'rgba(168, 85, 247, 0.08)'
                      : 'rgba(16, 185, 129, 0.08)')
                  : 'rgba(255, 255, 255, 0.05)',
                border: scanAlertModal.isHomeVisit
                  ? (scanAlertModal.homeVisitPhase === 'departure'
                      ? '1px solid rgba(168, 85, 247, 0.25)'
                      : '1px solid rgba(16, 185, 129, 0.25)')
                  : '1px solid rgba(255, 255, 255, 0.12)',
                borderRadius: 18,
                padding: '16px 18px',
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: 12,
                textAlign: 'left',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <StudentAvatar
                  student={user}
                  size={40}
                  style={{
                    border: '1.5px solid rgba(255,255,255,0.4)',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                    flexShrink: 0,
                  }}
                />
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255, 255, 255, 0.45)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Student
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#ffffff', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {scanAlertModal.studentName}
                  </div>
                  {scanAlertModal.rollNo && (
                    <div style={{ fontSize: 12, color: 'rgba(255, 255, 255, 0.65)' }}>
                      {scanAlertModal.rollNo} {scanAlertModal.hostel ? `· ${scanAlertModal.hostel}` : ''}
                    </div>
                  )}
                </div>
              </div>

              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255, 255, 255, 0.45)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Movement
                </div>
                <div
                  style={{
                    fontSize: 13.5,
                    fontWeight: 800,
                    marginTop: 2,
                    color: scanAlertModal.isHomeVisit
                      ? (scanAlertModal.homeVisitPhase === 'departure' ? '#c4b5fd' : '#34d399')
                      : (scanAlertModal.scanType === 'OUT' ? '#fb7185' : '#34d399'),
                  }}
                >
                  {scanAlertModal.isHomeVisit
                    ? (scanAlertModal.homeVisitPhase === 'departure' ? '🏡 HOME LEAVE (OUT)' : '🏫 HOME RETURN (IN)')
                    : (scanAlertModal.scanType === 'OUT' ? '🚪 EXIT (OUT)' : '🏫 ENTRY (IN)')}
                </div>
                <div style={{ fontSize: 12, color: 'rgba(255, 255, 255, 0.65)' }}>
                  Main Gate Security
                </div>
              </div>

              {scanAlertModal.destination && (
                <div style={{ gridColumn: 'span 2' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255, 255, 255, 0.45)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {scanAlertModal.isHomeVisit ? 'Home Visit Destination' : 'Destination / Location'}
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#f8fafc', marginTop: 2 }}>
                    📍 {scanAlertModal.destination}
                  </div>
                </div>
              )}

              {scanAlertModal.isHomeVisit && scanAlertModal.leaveDate && scanAlertModal.returnDate && (
                <div style={{ gridColumn: 'span 2' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255, 255, 255, 0.45)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Approved Leave Period
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#c4b5fd', marginTop: 2 }}>
                    📅 {scanAlertModal.leaveDate} ➔ {scanAlertModal.returnDate}
                  </div>
                </div>
              )}

              <div style={{ gridColumn: 'span 2', display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 8, borderTop: '1px solid rgba(255, 255, 255, 0.08)' }}>
                <span style={{ fontSize: 12, color: 'rgba(255, 255, 255, 0.55)' }}>
                  Logged at Gate
                </span>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#ffffff' }}>
                  ⏱️ {scanAlertModal.scanTime}
                </span>
              </div>
            </div>

            {/* Acknowledge Button */}
            <button
              type="button"
              onClick={() => setScanAlertModal(null)}
              style={{
                width: '100%',
                padding: '14px 20px',
                borderRadius: 14,
                border: 'none',
                background: scanAlertModal.isHomeVisit
                  ? (scanAlertModal.homeVisitPhase === 'departure'
                      ? 'linear-gradient(135deg, #6366f1 0%, #7c3aed 100%)'
                      : 'linear-gradient(135deg, #059669 0%, #0d9488 100%)')
                  : (scanAlertModal.scanType === 'OUT'
                      ? 'linear-gradient(135deg, #e11d48 0%, #be123c 100%)'
                      : 'linear-gradient(135deg, #059669 0%, #047857 100%)'),
                color: '#ffffff',
                fontSize: 15,
                fontWeight: 800,
                letterSpacing: '0.02em',
                cursor: 'pointer',
                boxShadow: scanAlertModal.isHomeVisit
                  ? (scanAlertModal.homeVisitPhase === 'departure'
                      ? '0 4px 18px rgba(124, 58, 237, 0.45)'
                      : '0 4px 18px rgba(5, 150, 105, 0.45)')
                  : (scanAlertModal.scanType === 'OUT'
                      ? '0 4px 18px rgba(225, 29, 72, 0.45)'
                      : '0 4px 18px rgba(5, 150, 105, 0.45)'),
                transition: 'transform 0.15s ease, filter 0.15s ease',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.filter = 'brightness(1.1)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.filter = 'brightness(1)'; e.currentTarget.style.transform = 'translateY(0)'; }}
            >
              Acknowledge & Continue
            </button>
          </div>
        </div>
      )}


      {/* Hidden file inputs for complaint photo capture */}
      <input
        ref={complaintCameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={handleComplaintPhotoChange}
      />
      <input
        ref={complaintFileRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleComplaintPhotoChange}
      />

      <style>{`
        @keyframes bounce {
          0%, 80%, 100% { transform: translateY(0); }
          40% { transform: translateY(-6px); }
        }
        @keyframes fadeInModal {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes scaleUpModal {
          from { opacity: 0; transform: scale(0.92); }
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes pulseRingModal {
          0% { transform: scale(0.95); opacity: 0.8; }
          50% { transform: scale(1.2); opacity: 0.2; }
          100% { transform: scale(0.95); opacity: 0.8; }
        }
        @keyframes laserScan {
          0% { top: 12px; opacity: 0.85; }
          50% { opacity: 1; }
          100% { top: calc(100% - 15px); opacity: 0.85; }
        }
      `}</style>
      </div>
    </AntiScreenshotShield>
  );
}
