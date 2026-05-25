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
  MdDashboard, MdPerson, MdDownload, MdLightMode, MdDarkMode, MdDeleteOutline,
  MdCalendarMonth, MdChevronRight,
} from 'react-icons/md';
import { useTheme } from '../context/ThemeContext';

// ── Constants ─────────────────────────────────────────────────────────────────
const BOT = 'bot';
const USER = 'user';
const CHAT_STORAGE_PREFIX = 'student-dashboard-chat:';

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
  INOUT_CONFIRM: 'INOUT_CONFIRM',
  // Home Visit
  HV_REASON:     'HV_REASON',
  HV_REASON_OTHER: 'HV_REASON_OTHER',
  HV_LEAVE:      'HV_LEAVE',
  HV_RETURN:     'HV_RETURN',
  // Complaint
  CPL_TYPE:      'CPL_TYPE',
  CPL_TEXT:      'CPL_TEXT',
  // Done
  DONE:          'DONE',
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
  leaveDate.setMonth(leaveDate.getMonth() + 4);
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
        ? `${dates} · Show at gate for HOME OUT / HOME IN`
        : 'Show at the hostel gate for HOME OUT or HOME IN scan',
      downloadLabel: 'Download Home Visit QR',
      zoomTitle: 'Home Visit QR Code',
      filename: isReturn ? 'home-visit-return-qr.png' : 'home-visit-departure-qr.png',
    };
  }

  const inOutLabel =
    scanType === 'IN' ? 'Return (IN)' : scanType === 'OUT' ? 'Exit (OUT)' : scanType || 'In/Out';
  return {
    cardTitle: 'HEIMDALL',
    cardSubtitle: `Daily In/Out · ${inOutLabel}${meta.place ? ` · ${meta.place}` : ''}`,
    hint: 'Tap to zoom · Show to security at the gate',
    downloadLabel: 'Download Gate Pass',
    zoomTitle: 'Daily In/Out QR Code',
    filename: 'daily-inout-qr.png',
  };
};

const BOT_LOGO_SRC = '/heimdall-bot-logo.png';
const BOT_LOGO_BG = '#4a5568';

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
        { label: '+2 days', value: addDaysToDateStr(anchor, 1) },
        { label: '+1 week', value: addDaysToDateStr(anchor, 6) },
        { label: '+2 weeks', value: addDaysToDateStr(anchor, 13) },
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

export default function StudentDashboard() {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [messages, setMessages] = useState([]);
  const [step, setStep]         = useState(STEPS.IDLE);
  const [input, setInput]       = useState('');
  const [loading, setLoading]   = useState(false);
  const [hvData, setHvData]     = useState({});
  const [zoomedQR, setZoomedQR] = useState(null);
  const bottomRef = useRef(null);
  const menuTimerRef = useRef(null);
  const bootTimerRef = useRef(null);
  const lastBotRef = useRef({ content: '', type: '', at: 0 });
  const [chatHydrated, setChatHydrated] = useState(false);
  // Safe initial mobile check — avoids SSR/layout-shift issues
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 768);
  const msgIdRef = useRef(0);

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
    botSay('🏠 *Home Visit Request*\n\nStep 1/3 — Select a reason below, or type your own:', 'buttons', {
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
        botSay('🏠 *Home Visit Request*\n\nStep 1/3 — Please select a reason below, or type your own:', 'buttons', {
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
        botSay('🧾 *File a Complaint*\n\nSelect complaint type:', 'buttons', {
          buttons: [
            { id: 'electricity', label: '⚡ Electricity' },
            { id: 'wifi', label: '📶 WiFi' },
            { id: 'washing_machine', label: '🧺 Washing Machine' },
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
      setHvData((d) => ({ ...d, complaint_type: id }));
      setStep(STEPS.CPL_TEXT);
      const typeLabelMap = {
        electricity: 'Electricity',
        wifi: 'WiFi',
        washing_machine: 'Washing Machine',
        others: 'Others',
      };
      botSay(`📝 Got it — *${typeLabelMap[id] || 'Others'}*.\n\nPlease describe your complaint in detail:`);
    } else if (step === STEPS.HV_REASON) {
      if (id === 'hv_other') {
        setStep(STEPS.HV_REASON_OTHER);
        botSay('Please type your detailed reason below:\n\n_Type *menu* or *cancel* anytime to go back._');
        return;
      }
      // Use the button label as the reason
      setHvData({ reason: label });
      setStep(STEPS.HV_LEAVE);
      botSay('📅 Step 2/3 — Please select your *date of leaving* using the calendar below:', 'date_picker', {
        pickerStep: STEPS.HV_LEAVE,
      });
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
      setStep(STEPS.HV_LEAVE);
      botSay('📅 Step 2/3 — Please select your *date of leaving* using the calendar below. Only dates from the current month are allowed:', 'date_picker', {
        pickerStep: STEPS.HV_LEAVE,
      });
    } else if (step === STEPS.INOUT_OTHER) {
      if (text.length < 2) {
        botSay('❌ Please enter a valid location name.');
        return;
      }
      await submitInOutRequest(text);
    } else if (step === STEPS.HV_LEAVE || step === STEPS.HV_RETURN) {
      await processHomeVisitDate(text, step);
    } else if (step === STEPS.CPL_TEXT) {
      if (text.length < 10 || text.split(/\s+/).length < 2) {
        botSay('❌ That description is too short. Please provide a genuine, detailed description of your complaint:');
        return;
      }
      await submitComplaint(text);
    } else if ([STEPS.HV_REASON, STEPS.HV_LEAVE, STEPS.HV_RETURN, STEPS.CPL_TEXT, STEPS.INOUT_OTHER].includes(step)) {
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
        `✅ *Home Visit Request Submitted!*\n\n📝 Reason: ${data.reason}\n📅 Leave: ${data.leave_date}\n📅 Return: ${data.return_date}\n\n⏳ The warden will call your parent to confirm permission. Once confirmed, your QR gate pass will be generated.`
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
        `📅 Step 3/3 — Select your *expected return date* below (after ${leaveDate}).`,
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
        botSay('❌ Leave date missing. Starting again from step 2.');
        setStep(STEPS.HV_LEAVE);
        botSay('📅 Step 2/3 — Select your *date of leaving* below:', 'date_picker', {
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
        botSay(`❌ Return date cannot be more than 4 months after leave. Maximum: ${maxReturnDate}.`);
        return;
      }
      await submitHomeVisit({ ...hvData, return_date: returnDate });
    }
  }, [loading, hvData, botSay, userSay, scrollChatToBottom, submitHomeVisit]);

  const submitComplaint = async (text) => {
    setLoading(true);
    try {
      await api.post('/student/complaint', {
        // Send hostel as well for backward compatibility with older backend route validation.
        hostel: user?.hostel,
        complaint_type: hvData.complaint_type || 'others',
        complaint_text: text,
      });
      const typeLabelMap = {
        electricity: 'Electricity',
        wifi: 'WiFi',
        washing_machine: 'Washing Machine',
        others: 'Others',
      };
      botSay(
        `✅ *Complaint Filed!*\n\n🏷️ Type: ${typeLabelMap[hvData.complaint_type] || 'Others'}\n📝 "${text.substring(0, 60)}${text.length > 60 ? '…' : ''}"\n\nThe warden will review it shortly.`
      );
      setHvData({});
      goToMainMenu();
    } catch (err) {
      botSay(`❌ ${err.response?.data?.message || 'Failed to file complaint.'}`);
    } finally {
      setLoading(false);
    }
  };

  const fetchStatus = async () => {
    setLoading(true);
    try {
      const res = await api.get('/student/status');
      const s = res.data.status;

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

  const handleLogout = () => {
    logout();
    navigate('/login');
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
                <img
                  key={m.meta.qrToken || m.id}
                  src={m.meta.qrDataUrl}
                  alt="Home visit QR code"
                  style={{ width: 200, height: 200, borderRadius: 10,
                    border: '2px solid var(--glass-border)' }}
                />
              ) : (
                <div style={{ width: 200, height: 200, background: 'var(--bg-input)',
                  borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#8696a0', fontSize: 12 }}>Loading QR...</div>
              )}
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>
                {pass.hint}
              </div>
            </div>

            {/* Download button */}
            <button onClick={() => downloadQR(m.meta.qrDataUrl, pass.filename)}
              style={{
                width: '100%', padding: '11px 16px', border: 'none',
                borderTop: '1px solid var(--glass-border)',
                background: 'var(--glass)',
                color: '#818cf8', fontSize: 13.5, fontWeight: 600,
                cursor: 'pointer', display: 'flex', alignItems: 'center',
                justifyContent: 'center', gap: 6,
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-card-hover)'}
              onMouseLeave={e => e.currentTarget.style.background = 'var(--glass)'}
            >
              <MdDownload size={16} /> {pass.downloadLabel}
            </button>
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
      const isInteractiveButtons = isLatestButtons || hasFlowActions;
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
            {m.content}
            <div style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'right', marginTop: 4 }}>
              {m.time}
            </div>
          </div>
          {/* Quick-reply buttons */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {m.meta.buttons.map((btn) => {
              const isFlowBtn = btn.id?.startsWith('flow_');
              const canClick = isLatestButtons || isFlowBtn;
              return (
              <button key={btn.id} id={`btn-${btn.id}`}
                onClick={() => canClick && handleButton(btn.id, btn.label)}
                disabled={loading || !canClick}
                style={{
                  padding: '8px 16px', borderRadius: 999,
                  border: '1px solid var(--primary)',
                  background: 'transparent',
                  color: 'var(--primary-light)',
                  fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  transition: 'all 0.15s',
                  opacity: loading ? 0.5 : 1,
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = 'var(--primary)';
                  e.currentTarget.style.color = '#fff';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = 'var(--primary-light)';
                }}
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
            {m.content}
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
                  disabled={loading}
                  onClick={() => handleButton(btn.id, btn.label)}
                  style={{
                    padding: '7px 12px',
                    borderRadius: 999,
                    border: '1px solid var(--primary)',
                    background: 'transparent',
                    color: 'var(--primary-light)',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: loading ? 'not-allowed' : 'pointer',
                    opacity: loading ? 0.5 : 1,
                  }}
                >
                  {btn.label}
                </button>
              ))}
            </div>
          )}
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
        {m.content}
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
        <div style={{ padding: '24px 20px 16px', borderBottom: '1px solid var(--glass-border)' }}>
          <div style={{ fontWeight: 800, fontSize: 16, color: 'var(--text-primary)' }}>🛡️ HEIMDALL</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Student Portal</div>
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <div style={{
              width: 36, height: 36, borderRadius: '50%',
              background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 700, color: '#fff', fontSize: 15, flexShrink: 0,
            }}>
              {user?.name?.charAt(0).toUpperCase()}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user?.name}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
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
            }}>
            <MdLogout size={15} /> Logout
          </button>
        </div>
      </aside>

      {/* ── Chat Area ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Header */}
        <div style={{
          padding: isMobile ? '10px 12px' : '14px 24px',
          background: 'var(--bg-card)',
          borderBottom: '1px solid var(--glass-border)',
          display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 14,
          boxShadow: 'var(--shadow-sm)',
          flexWrap: isMobile ? 'wrap' : 'nowrap',
        }}>
          <div className="chatbot-avatar" style={{ background: BOT_LOGO_BG }}>
            <img
              src={BOT_LOGO_SRC}
              alt="HEIMDALL Bot"
              className="chatbot-avatar-img"
            />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' }}>
              HEIMDALL Bot
            </div>
            <div style={{ fontSize: 12, color: '#10b981', display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#10b981', display: 'inline-block' }} />
              Online
            </div>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {/* Theme Toggle */}
            <button
              onClick={toggleTheme}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '4px',
              }}
              aria-label="Toggle theme"
            >
              {theme === 'light' ? <MdDarkMode size={18} /> : <MdLightMode size={18} />}
            </button>
            <div style={{
              padding: '4px 12px', borderRadius: 99, fontSize: 11, fontWeight: 700,
              background: 'rgba(99,102,241,0.15)', color: 'var(--primary-light)',
              border: '1px solid rgba(99,102,241,0.3)',
            }}>
              🎓 Student
            </div>
            {isMobile && (
              <button
                onClick={handleLogout}
                style={{
                  padding: '4px 12px',
                  borderRadius: 99,
                  fontSize: 11,
                  fontWeight: 700,
                  border: '1px solid rgba(239,68,68,0.35)',
                  background: 'transparent',
                  color: '#fca5a5',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4
                }}
              >
                <MdLogout size={12} /> Logout
              </button>
            )}
          </div>
        </div>

        {/* Messages */}
        <div style={{
          flex: 1, overflowY: 'auto', padding: isMobile ? '12px 10px' : '20px 32px',
          display: 'flex', flexDirection: 'column', gap: 8,
          backgroundImage: 'radial-gradient(circle at 50% 50%, rgba(99,102,241,0.03) 0%, transparent 70%)',
          overscrollBehavior: 'contain',
        }}>
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
        {[STEPS.INOUT_OTHER, STEPS.HV_REASON_OTHER, STEPS.CPL_TEXT].includes(step) && (
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
                  step === STEPS.INOUT_OTHER
                    ? 'Type destination, or menu to go back...' :
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
            background: 'var(--bg-card)', borderRadius: 20, padding: 32,
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16,
            border: '1px solid var(--glass-border)',
          }}>
            <div style={{ fontWeight: 700, fontSize: 18, color: 'var(--text-primary)' }}>
              {zoomedQR.zoomTitle || 'Gate Pass QR'}
            </div>
            <img src={zoomedQR.dataUrl} alt="QR"
              style={{ width: 300, height: 300, borderRadius: 12 }} />
            <div style={{ display: 'flex', gap: 12, width: '100%' }}>
              <button onClick={() => downloadQR(zoomedQR.dataUrl, zoomedQR.filename)} style={{
                flex: 1, padding: '11px 0', borderRadius: 10,
                background: 'var(--primary)', border: 'none',
                color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}>
                <MdDownload size={16} /> Download
              </button>
              <button onClick={() => setZoomedQR(null)} style={{
                flex: 1, padding: '11px 0', borderRadius: 10,
                background: theme === 'light' ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.07)', border: 'none',
                color: 'var(--text-primary)', fontSize: 14, cursor: 'pointer',
              }}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes bounce {
          0%, 80%, 100% { transform: translateY(0); }
          40% { transform: translateY(-6px); }
        }
      `}</style>
    </div>
  );
}
