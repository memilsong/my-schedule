/* =========================================================
   나의 일정 - 개인 일정 관리 앱
   - 순수 HTML/CSS/JavaScript로 동작 (서버 없음)
   - 일정 데이터는 브라우저 localStorage에 저장
   - 알림은 "시작 30분 전"으로 표시만 하며 실제 알림은 보내지 않음
   ========================================================= */

(() => {
  'use strict';

  const STORAGE_KEY = 'my-schedule:events:v1';
  const WEEKDAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];
  const DEFAULT_TIME = '09:00';
  const DEFAULT_NOTIFY_MINUTES = 30;
  const NOTIFY_OPTIONS = [0, 10, 30, 60];
  const CATEGORIES = {
    personal: { label: '개인' },
    family: { label: '가족' },
    other: { label: '기타' },
  };
  const DEFAULT_CATEGORY = 'personal';

  const ICONS = {
    clock:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M12 7.5V12l3 1.8"></path></svg>',
    bell:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 7-3 9h18c0-2-3-2-3-9"></path><path d="M10.3 21a2 2 0 0 0 3.4 0"></path></svg>',
    pencil:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>',
    trash:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"></path><path d="M8 6V4.5A1.5 1.5 0 0 1 9.5 3h5A1.5 1.5 0 0 1 16 4.5V6"></path><path d="M19 6l-.9 13.1A2 2 0 0 1 16.1 21H7.9a2 2 0 0 1-2-1.9L5 6"></path><path d="M10 11v5"></path><path d="M14 11v5"></path></svg>',
  };

  const els = {
    monthLabel: document.getElementById('monthLabel'),
    calendarGrid: document.getElementById('calendarGrid'),
    prevMonthBtn: document.getElementById('prevMonthBtn'),
    nextMonthBtn: document.getElementById('nextMonthBtn'),
    todayBtn: document.getElementById('todayBtn'),
    addEventBtn: document.getElementById('addEventBtn'),
    addForSelectedBtn: document.getElementById('addForSelectedBtn'),
    selectedDateLabel: document.getElementById('selectedDateLabel'),
    dayEventCount: document.getElementById('dayEventCount'),
    dayEventList: document.getElementById('dayEventList'),
    dayEmptyState: document.getElementById('dayEmptyState'),
    modalBackdrop: document.getElementById('modalBackdrop'),
    modalTitle: document.getElementById('modalTitle'),
    eventForm: document.getElementById('eventForm'),
    eventDate: document.getElementById('eventDate'),
    eventTitle: document.getElementById('eventTitle'),
    eventTime: document.getElementById('eventTime'),
    eventNotify: document.getElementById('eventNotify'),
    eventMemo: document.getElementById('eventMemo'),
    memoCount: document.getElementById('memoCount'),
    formError: document.getElementById('formError'),
    closeModalBtn: document.getElementById('closeModalBtn'),
    cancelBtn: document.getElementById('cancelBtn'),
    deleteEventBtn: document.getElementById('deleteEventBtn'),
    toast: document.getElementById('toast'),
  };

  const now = new Date();

  const state = {
    events: [],
    viewDate: new Date(now.getFullYear(), now.getMonth(), 1),
    selectedDate: toDateKey(now),
    editingId: null,
    lastFocused: null,
    toastTimer: null,
  };

  /* ---------- 날짜/시간 유틸 ---------- */

  function pad(number) {
    return String(number).padStart(2, '0');
  }

  function toDateKey(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function fromDateKey(key) {
    const [year, month, day] = key.split('-').map(Number);
    return new Date(year, month - 1, day);
  }

  function formatDateLabel(key) {
    const date = fromDateKey(key);
    return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일 (${WEEKDAY_NAMES[date.getDay()]})`;
  }

  function minutesOf(time) {
    const [hours, minutes] = String(time).split(':').map(Number);
    return hours * 60 + minutes;
  }

  function normalizeTime(value) {
    return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
      ? value
      : DEFAULT_TIME;
  }

  function normalizeNotify(value) {
    const minutes = Number(value);
    return NOTIFY_OPTIONS.includes(minutes) ? minutes : DEFAULT_NOTIFY_MINUTES;
  }

  function normalizeCategory(value) {
    return Object.prototype.hasOwnProperty.call(CATEGORIES, value)
      ? value
      : DEFAULT_CATEGORY;
  }

  function formatNotify(minutes) {
    if (!minutes) return '알림 없음';
    if (minutes % 60 === 0) return `${minutes / 60}시간 전 알림`;
    return `${minutes}분 전 알림`;
  }

  function compareEvents(a, b) {
    const diff = minutesOf(a.time) - minutesOf(b.time);
    return diff !== 0 ? diff : a.title.localeCompare(b.title, 'ko');
  }

  function createId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return `ev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function groupEventsByDate(events) {
    const map = new Map();
    events.forEach((event) => {
      if (!map.has(event.date)) map.set(event.date, []);
      map.get(event.date).push(event);
    });
    map.forEach((list) => list.sort(compareEvents));
    return map;
  }

  /* ---------- 저장소 ---------- */

  function loadEvents() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];

      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];

      const seenIds = new Set();

      return parsed.reduce((result, item) => {
        if (!item || typeof item !== 'object') return result;

        const id = typeof item.id === 'string' && item.id ? item.id : createId();
        if (seenIds.has(id)) return result;

        const date = typeof item.date === 'string' ? item.date : '';
        const title = typeof item.title === 'string' ? item.title.trim() : '';

        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !title) return result;
        if (toDateKey(fromDateKey(date)) !== date) return result;

        seenIds.add(id);
        result.push({
          id,
          date,
          title: title.slice(0, 60),
          time: normalizeTime(item.time),
          memo: typeof item.memo === 'string' ? item.memo.slice(0, 500) : '',
          notifyMinutes: normalizeNotify(item.notifyMinutes),
          category: normalizeCategory(item.category),
        });
        return result;
      }, []);
    } catch (error) {
      console.warn('저장된 일정을 불러오지 못했습니다.', error);
      return [];
    }
  }

  function persistEvents() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state.events));
    } catch (error) {
      console.warn('일정을 저장하지 못했습니다.', error);
      showToast('저장 공간이 부족해 일정을 저장하지 못했습니다.');
    }
  }

  /* ---------- 초기화 ---------- */

  function init() {
    state.events = loadEvents();
    renderCalendar();
    renderDayPanel();
    bindEvents();
  }

  function bindEvents() {
    els.prevMonthBtn.addEventListener('click', () => changeMonth(-1));
    els.nextMonthBtn.addEventListener('click', () => changeMonth(1));
    els.todayBtn.addEventListener('click', goToToday);
    els.addEventBtn.addEventListener('click', () => openCreate(state.selectedDate));
    els.addForSelectedBtn.addEventListener('click', () => openCreate(state.selectedDate));

    els.closeModalBtn.addEventListener('click', closeModal);
    els.cancelBtn.addEventListener('click', closeModal);
    els.eventForm.addEventListener('submit', handleSubmit);
    els.deleteEventBtn.addEventListener('click', deleteEditingEvent);
    els.eventForm.addEventListener('input', hideFormError);

    els.eventMemo.addEventListener('input', updateMemoCount);
    els.modalBackdrop.addEventListener('mousedown', (event) => {
      if (event.target === els.modalBackdrop) closeModal();
    });

    document.addEventListener('keydown', handleGlobalKeydown);

    let resizeTimer = 0;
    window.addEventListener('resize', () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(renderCalendar, 150);
    });
  }

  /* ---------- 달력 렌더링 ---------- */

  function changeMonth(delta) {
    const nextView = new Date(
      state.viewDate.getFullYear(),
      state.viewDate.getMonth() + delta,
      1
    );
    state.viewDate = nextView;

    const selected = fromDateKey(state.selectedDate);
    if (
      selected.getFullYear() !== nextView.getFullYear() ||
      selected.getMonth() !== nextView.getMonth()
    ) {
      state.selectedDate = toDateKey(nextView);
      renderDayPanel();
    }

    renderCalendar();
  }

  function goToToday() {
    const today = new Date();
    state.viewDate = new Date(today.getFullYear(), today.getMonth(), 1);
    state.selectedDate = toDateKey(today);
    renderCalendar();
    renderDayPanel();
  }

  function selectDate(key) {
    const selected = fromDateKey(key);
    state.selectedDate = key;

    if (
      selected.getFullYear() !== state.viewDate.getFullYear() ||
      selected.getMonth() !== state.viewDate.getMonth()
    ) {
      state.viewDate = new Date(selected.getFullYear(), selected.getMonth(), 1);
    }

    renderCalendar();
    renderDayPanel();
  }

  function renderCalendar() {
    const year = state.viewDate.getFullYear();
    const month = state.viewDate.getMonth();

    els.monthLabel.textContent = `${year}년 ${month + 1}월`;

    const grid = els.calendarGrid;
    grid.replaceChildren();

    const monthStart = new Date(year, month, 1);
    const gridStart = new Date(year, month, 1 - monthStart.getDay());
    const todayKey = toDateKey(new Date());
    const eventsByDate = groupEventsByDate(state.events);
    const maxVisibleChips = window.innerWidth <= 700 ? 2 : 3;

    for (let index = 0; index < 42; index += 1) {
      const date = new Date(
        gridStart.getFullYear(),
        gridStart.getMonth(),
        gridStart.getDate() + index
      );
      const key = toDateKey(date);
      const dayEvents = eventsByDate.get(key) || [];
      const isOutside = date.getMonth() !== month;

      const cell = document.createElement('div');
      cell.className = 'day-cell';
      cell.setAttribute('role', 'gridcell');
      cell.setAttribute('tabindex', '0');
      cell.dataset.date = key;
      cell.setAttribute('aria-selected', key === state.selectedDate ? 'true' : 'false');
      cell.setAttribute(
        'aria-label',
        `${formatDateLabel(key)}${dayEvents.length ? `, 일정 ${dayEvents.length}개` : ', 일정 없음'}`
      );

      if (date.getDay() === 0) cell.classList.add('is-sun');
      if (date.getDay() === 6) cell.classList.add('is-sat');
      if (isOutside) cell.classList.add('is-outside');
      if (key === todayKey) {
        cell.classList.add('is-today');
        cell.setAttribute('aria-current', 'date');
      }
      if (key === state.selectedDate) cell.classList.add('is-selected');

      const dayNumber = document.createElement('span');
      dayNumber.className = 'day-num';
      dayNumber.textContent = String(date.getDate());
      cell.append(dayNumber);

      if (dayEvents.length > 0) {
        const chipWrap = document.createElement('div');
        chipWrap.className = 'cell-events';

        dayEvents.slice(0, maxVisibleChips).forEach((event) => {
          const chip = document.createElement('button');
          chip.type = 'button';
          chip.className = `event-chip cat-${event.category}`;
          chip.dataset.id = event.id;
          chip.title = `${CATEGORIES[event.category].label} · ${event.time} ${event.title}`;

          const time = document.createElement('span');
          time.className = 'chip-time';
          time.textContent = event.time;

          const title = document.createElement('span');
          title.className = 'chip-title';
          title.textContent = event.title;

          chip.append(time, title);
          chip.addEventListener('click', (clickEvent) => {
            clickEvent.stopPropagation();
            openEdit(event.id);
          });
          chipWrap.append(chip);
        });

        if (dayEvents.length > maxVisibleChips) {
          const moreButton = document.createElement('button');
          moreButton.type = 'button';
          moreButton.className = 'more-btn';
          moreButton.textContent = `+${dayEvents.length - maxVisibleChips}개 더`;
          moreButton.addEventListener('click', (clickEvent) => {
            clickEvent.stopPropagation();
            selectDate(key);
          });
          chipWrap.append(moreButton);
        }

        cell.append(chipWrap);
      }

      cell.addEventListener('click', () => selectDate(key));
      cell.addEventListener('keydown', (keyEvent) => {
        if (keyEvent.target !== cell) return;
        if (keyEvent.key === 'Enter' || keyEvent.key === ' ') {
          keyEvent.preventDefault();
          selectDate(key);
        }
      });

      grid.append(cell);
    }
  }

  /* ---------- 선택 날짜 패널 ---------- */

  function renderDayPanel() {
    els.selectedDateLabel.textContent = formatDateLabel(state.selectedDate);

    const dayEvents = state.events
      .filter((event) => event.date === state.selectedDate)
      .sort(compareEvents);

    els.dayEventCount.textContent = String(dayEvents.length);
    els.dayEventCount.setAttribute('aria-label', `일정 ${dayEvents.length}개`);

    const list = els.dayEventList;
    list.replaceChildren();
    list.hidden = dayEvents.length === 0;
    els.dayEmptyState.hidden = dayEvents.length > 0;

    dayEvents.forEach((event) => {
      list.append(buildEventCard(event));
    });
  }

  function buildEventCard(event) {
    const item = document.createElement('li');
    item.className = `event-item cat-${event.category}`;
    item.dataset.id = event.id;

    const meta = document.createElement('div');
    meta.className = 'event-meta';

    const time = document.createElement('span');
    time.className = 'event-time';
    time.innerHTML = ICONS.clock;
    const timeText = document.createElement('span');
    timeText.textContent = event.time;
    time.append(timeText);

    const categoryBadge = document.createElement('span');
    categoryBadge.className = `category-badge cat-${event.category}`;
    categoryBadge.textContent = CATEGORIES[event.category].label;

    const actions = document.createElement('div');
    actions.className = 'event-actions';

    const editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.className = 'icon-btn event-edit';
    editButton.setAttribute('aria-label', `'${event.title}' 일정 수정`);
    editButton.title = '수정';
    editButton.innerHTML = ICONS.pencil;
    editButton.addEventListener('click', (clickEvent) => {
      clickEvent.stopPropagation();
      openEdit(event.id);
    });

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'icon-btn event-delete';
    deleteButton.setAttribute('aria-label', `'${event.title}' 일정 삭제`);
    deleteButton.title = '삭제';
    deleteButton.innerHTML = ICONS.trash;
    deleteButton.addEventListener('click', (clickEvent) => {
      clickEvent.stopPropagation();
      confirmDelete(event);
    });

    actions.append(editButton, deleteButton);
    meta.append(time, categoryBadge, actions);

    const title = document.createElement('p');
    title.className = 'event-title';
    title.textContent = event.title;

    const notify = document.createElement('p');
    notify.className = 'event-notify';
    if (!event.notifyMinutes) notify.classList.add('is-off');
    notify.innerHTML = ICONS.bell;
    const notifyText = document.createElement('span');
    notifyText.textContent = formatNotify(event.notifyMinutes);
    notify.append(notifyText);

    item.append(meta, title, notify);

    if (event.memo) {
      const memo = document.createElement('p');
      memo.className = 'event-memo';
      memo.textContent = event.memo;
      item.append(memo);
    }

    item.addEventListener('click', () => openEdit(event.id));

    return item;
  }

  /* ---------- 일정 추가/수정 ---------- */

  function setCategory(category) {
    const value = normalizeCategory(category);
    const radio = els.eventForm.querySelector(
      `input[name="category"][value="${value}"]`
    );
    if (radio) radio.checked = true;
  }

  function openCreate(dateKey) {
    state.editingId = null;
    state.lastFocused = document.activeElement;

    els.eventForm.reset();
    els.eventDate.value = dateKey;
    els.eventTime.value = DEFAULT_TIME;
    els.eventNotify.value = String(DEFAULT_NOTIFY_MINUTES);
    setCategory(DEFAULT_CATEGORY);
    els.memoCount.textContent = '0 / 500';
    els.modalTitle.textContent = '새 일정';
    els.deleteEventBtn.hidden = true;
    hideFormError();
    openModal(false);
  }

  function openEdit(id) {
    const event = state.events.find((item) => item.id === id);
    if (!event) return;

    state.editingId = id;
    state.lastFocused = document.activeElement;

    els.eventDate.value = event.date;
    els.eventTitle.value = event.title;
    els.eventTime.value = event.time;
    els.eventNotify.value = String(event.notifyMinutes);
    setCategory(event.category);
    els.eventMemo.value = event.memo || '';
    els.memoCount.textContent = `${(event.memo || '').length} / 500`;
    els.modalTitle.textContent = '일정 수정';
    els.deleteEventBtn.hidden = false;
    hideFormError();
    openModal(true);
  }

  function openModal(isEditing) {
    els.modalBackdrop.hidden = false;
    document.body.classList.add('modal-open');

    window.setTimeout(() => {
      els.eventTitle.focus();
      if (isEditing) els.eventTitle.select();
    }, 0);
  }

  function closeModal() {
    if (els.modalBackdrop.hidden) return;

    els.modalBackdrop.hidden = true;
    document.body.classList.remove('modal-open');
    state.editingId = null;

    const target = state.lastFocused;
    state.lastFocused = null;
    if (target && typeof target.focus === 'function' && document.contains(target)) {
      target.focus({ preventScroll: true });
    }
  }

  function updateMemoCount() {
    els.memoCount.textContent = `${els.eventMemo.value.length} / 500`;
  }

  function handleSubmit(submitEvent) {
    submitEvent.preventDefault();

    const date = els.eventDate.value;
    const title = els.eventTitle.value.trim();
    const time = els.eventTime.value;
    const memo = els.eventMemo.value.trim();
    const notifyMinutes = normalizeNotify(els.eventNotify.value);
    const category = normalizeCategory(
      els.eventForm.querySelector('input[name="category"]:checked')?.value
    );

    if (!date) {
      showFormError('날짜를 선택해 주세요.', els.eventDate);
      return;
    }
    if (!title) {
      showFormError('일정 제목을 입력해 주세요.', els.eventTitle);
      return;
    }
    if (!time) {
      showFormError('시작 시간을 선택해 주세요.', els.eventTime);
      return;
    }

    const wasEditing = Boolean(state.editingId);

    if (wasEditing) {
      const index = state.events.findIndex((item) => item.id === state.editingId);
      if (index === -1) {
        closeModal();
        showToast('수정할 일정을 찾을 수 없습니다.');
        return;
      }
      state.events[index] = {
        ...state.events[index],
        date,
        title: title.slice(0, 60),
        time,
        memo: memo.slice(0, 500),
        notifyMinutes,
        category,
      };
    } else {
      state.events.push({
        id: createId(),
        date,
        title: title.slice(0, 60),
        time,
        memo: memo.slice(0, 500),
        notifyMinutes,
        category,
      });
    }

    persistEvents();
    closeModal();
    focusDate(date);
    showToast(wasEditing ? '일정을 수정했습니다.' : '일정을 추가했습니다.');
  }

  function deleteEditingEvent() {
    const event = state.events.find((item) => item.id === state.editingId);
    if (!event) return;

    const confirmed = window.confirm(
      `'${event.title}' 일정을 삭제할까요?\n삭제한 일정은 되돌릴 수 없습니다.`
    );
    if (!confirmed) return;

    state.events = state.events.filter((item) => item.id !== event.id);
    persistEvents();
    closeModal();
    renderCalendar();
    renderDayPanel();
    showToast('일정을 삭제했습니다.');
  }

  function confirmDelete(event) {
    const confirmed = window.confirm(
      `'${event.title}' 일정을 삭제할까요?\n삭제한 일정은 되돌릴 수 없습니다.`
    );
    if (!confirmed) return;

    state.events = state.events.filter((item) => item.id !== event.id);
    persistEvents();
    renderCalendar();
    renderDayPanel();
    showToast('일정을 삭제했습니다.');
  }

  function focusDate(dateKey) {
    const date = fromDateKey(dateKey);
    state.selectedDate = dateKey;
    state.viewDate = new Date(date.getFullYear(), date.getMonth(), 1);
    renderCalendar();
    renderDayPanel();
  }

  /* ---------- 폼 오류/토스트 ---------- */

  function showFormError(message, field) {
    els.formError.textContent = message;
    els.formError.hidden = false;
    if (field) field.focus();
  }

  function hideFormError() {
    if (els.formError.hidden) return;
    els.formError.textContent = '';
    els.formError.hidden = true;
  }

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.add('is-visible');

    window.clearTimeout(state.toastTimer);
    state.toastTimer = window.setTimeout(() => {
      els.toast.classList.remove('is-visible');
    }, 2600);
  }

  /* ---------- 키보드 접근성 ---------- */

  function handleGlobalKeydown(event) {
    if (els.modalBackdrop.hidden) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      closeModal();
      return;
    }

    if (event.key === 'Tab') {
      trapFocus(event);
    }
  }

  function trapFocus(event) {
    const focusable = Array.from(
      els.modalBackdrop.querySelectorAll(
        'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])'
      )
    ).filter(
      (node) =>
        !node.hasAttribute('hidden') &&
        !node.disabled &&
        node.getClientRects().length > 0
    );

    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
