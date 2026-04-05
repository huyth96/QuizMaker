(() => {
  const DEFAULT_JSON = 'VNR202_quiz_sources.json';
  const DEFAULT_QUESTION_COUNT = 20;
  const QUESTION_COUNT_PRESETS = [10, 20, 40, 'all'];
  const MAX_RAIL_ITEMS = 28;
  const MAX_QUEUE_ITEMS = 60;
  const LS_SETTINGS = 'quizmaker_focus_canvas_settings_v1';
  const LS_PROGRESS = 'quizmaker_focus_canvas_progress_v1';

  const els = {
    body: document.body,
    btnReload: document.getElementById('btnReload'),
    fileInput: document.getElementById('fileInput'),
    questionStage: document.querySelector('.question-stage'),
    questionWrap: document.querySelector('.question-wrap'),
    sessionState: document.getElementById('sessionState'),
    sessionBar: document.getElementById('sessionBar'),
    currentIndex: document.getElementById('currentIndex'),
    totalCount: document.getElementById('totalCount'),
    railProgressBar: document.getElementById('railProgressBar'),
    railDots: document.getElementById('railDots'),
    questionTag: document.getElementById('questionTag'),
    questionTone: document.getElementById('questionTone'),
    questionClock: document.getElementById('questionClock'),
    questionTitle: document.getElementById('questionTitle'),
    focusNote: document.getElementById('focusNote'),
    optionGrid: document.getElementById('optionGrid'),
    questionQueue: document.getElementById('questionQueue'),
    queueStat: document.getElementById('queueStat'),
    btnPrev: document.getElementById('btnPrev'),
    btnNext: document.getElementById('btnNext'),
    btnShuffle: document.getElementById('btnShuffle'),
    stageDock: document.querySelector('.stage-dock'),
    modeButtons: Array.from(document.querySelectorAll('.mode-toggle')),
    countButtons: Array.from(document.querySelectorAll('.preset-chip')),
  };

  let DATA = null;
  let ALL_ITEMS = [];
  let SESSION_ITEMS = [];
  let activeIndex = 0;
  let mode = 'focus';
  let questionCount = DEFAULT_QUESTION_COUNT;
  let isLoading = true;
  let loadError = '';
  let fitFrame = 0;
  let selections = loadJson(LS_PROGRESS, {});

  function pad(value) {
    return String(value).padStart(2, '0');
  }

  function loadJson(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
    } catch {
      return fallback;
    }
  }

  function saveJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function parseQuestionCount(value) {
    return value === 'all' ? 'all' : Number(value);
  }

  function isValidQuestionCount(value) {
    return QUESTION_COUNT_PRESETS.includes(value);
  }

  function getResolvedQuestionCount() {
    if (questionCount === 'all') return ALL_ITEMS.length;
    return Math.min(questionCount, ALL_ITEMS.length);
  }

  function getVisibleRange(total, active, maxItems) {
    if (total <= maxItems) {
      return { start: 0, end: total };
    }

    const half = Math.floor(maxItems / 2);
    let start = Math.max(0, active - half);
    let end = Math.min(total, start + maxItems);

    if (end - start < maxItems) {
      start = Math.max(0, end - maxItems);
    }

    return { start, end };
  }

  function sameSet(left, right) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    const a = new Set(left.map((value) => String(value).toLowerCase()));
    const b = new Set(right.map((value) => String(value).toLowerCase()));
    if (a.size !== b.size) return false;
    for (const value of a) {
      if (!b.has(value)) return false;
    }
    return true;
  }

  function shuffle(items) {
    const copy = items.slice();
    for (let index = copy.length - 1; index > 0; index -= 1) {
      const other = Math.floor(Math.random() * (index + 1));
      [copy[index], copy[other]] = [copy[other], copy[index]];
    }
    return copy;
  }

  function getModeLabel() {
    return {
      focus: 'Focus',
      review: 'Review',
      exam: 'Exam',
    }[mode];
  }

  function normalizeItems(items) {
    return (items || []).map((item, index) => {
      const correctKeys = Array.isArray(item.correct_keys)
        ? item.correct_keys.map((key) => String(key).toLowerCase())
        : [];
      const selectionHint = item.selection_hint || correctKeys.length || 1;
      const isMultiple = item.type === 'multiple' || selectionHint > 1;

      return {
        id: item.id || `item-${index + 1}`,
        chapter: item.chapter_code || 'Tổng hợp',
        prompt: item.question || '(Không có nội dung câu hỏi)',
        options: Array.isArray(item.options)
          ? item.options.map((option) => ({
              key: String(option.key || '').toLowerCase(),
              text: option.text || '',
            }))
          : [],
        correctKeys,
        selectionHint,
        isMultiple,
        answerNote: item.answer_note || '',
        notes: Array.isArray(item.notes) ? item.notes : [],
        sourceTags: Array.isArray(item.source_tags) ? item.source_tags : [],
        unresolvedAnswer: !!item.unresolved_answer,
      };
    });
  }

  function getSelection(questionId) {
    return Array.isArray(selections[questionId])
      ? selections[questionId].map((value) => String(value).toLowerCase())
      : [];
  }

  function saveSelection(questionId, selected) {
    selections[questionId] = selected.slice();
    saveJson(LS_PROGRESS, selections);
  }

  function saveSettings() {
    saveJson(LS_SETTINGS, {
      mode,
      questionCount,
      activeIndex,
      sourceLabel: DATA && DATA.__sourceLabel ? DATA.__sourceLabel : DEFAULT_JSON,
      sessionIds: SESSION_ITEMS.map((item) => item.id),
    });
  }

  function getSelectionLimit(question) {
    return Math.max(1, question.selectionHint || question.correctKeys.length || 1);
  }

  function hasAnswer(question) {
    return Array.isArray(question.correctKeys) && question.correctKeys.length > 0;
  }

  function shouldReveal(question) {
    const selected = getSelection(question.id);
    if (!hasAnswer(question)) return false;
    if (mode === 'review') return true;
    if (mode === 'focus') {
      return question.isMultiple ? selected.length >= getSelectionLimit(question) : selected.length > 0;
    }
    return false;
  }

  function gradeQuestion(question) {
    const selected = getSelection(question.id);
    if (!selected.length) return null;
    if (!hasAnswer(question)) return 'open';
    return sameSet(selected, question.correctKeys) ? 'right' : 'wrong';
  }

  function getQueueStatusLabel(question) {
    const selected = getSelection(question.id);
    if (!selected.length) return question.chapter;

    const grade = gradeQuestion(question);
    if (mode === 'exam') return `${question.chapter} • Đã chọn`;
    if (grade === 'right') return `${question.chapter} • Đúng`;
    if (grade === 'wrong') return `${question.chapter} • Sai`;
    return `${question.chapter} • Đã chọn`;
  }

  function getHintText(question) {
    const selected = getSelection(question.id);
    const parts = [];

    parts.push(question.isMultiple ? `Chọn ${getSelectionLimit(question)} đáp án.` : 'Chọn 1 đáp án.');

    if (!hasAnswer(question)) {
      parts.push('Câu này chưa có đáp án chuẩn.');
    } else if (shouldReveal(question)) {
      parts.push(`Đáp án: ${question.correctKeys.join(', ').toUpperCase()}.`);
    } else if (mode === 'exam' && selected.length) {
      parts.push(`Đã chọn: ${selected.join(', ').toUpperCase()}.`);
    }

    if (question.answerNote) {
      parts.push(question.answerNote);
    } else if (question.notes.length) {
      parts.push(question.notes[0]);
    } else if (question.sourceTags.length) {
      parts.push(question.sourceTags.slice(0, 2).join(' • '));
    }

    return parts.join(' ');
  }

  function computeSessionStats() {
    const answered = SESSION_ITEMS.reduce((count, question) => count + (getSelection(question.id).length ? 1 : 0), 0);
    const gradable = SESSION_ITEMS.reduce((count, question) => count + (hasAnswer(question) ? 1 : 0), 0);
    const correct = SESSION_ITEMS.reduce((count, question) => count + (gradeQuestion(question) === 'right' ? 1 : 0), 0);
    return { answered, gradable, correct };
  }

  function buildSession(requestedIds = []) {
    if (!ALL_ITEMS.length) {
      SESSION_ITEMS = [];
      activeIndex = 0;
      return;
    }

    const lookup = new Map(ALL_ITEMS.map((item) => [item.id, item]));
    const restored = requestedIds
      .map((id) => lookup.get(id))
      .filter(Boolean);

    SESSION_ITEMS = restored.length
      ? restored
      : shuffle(ALL_ITEMS).slice(0, getResolvedQuestionCount());

    activeIndex = clamp(activeIndex || 0, 0, Math.max(SESSION_ITEMS.length - 1, 0));
  }

  function setData(data, sourceLabel) {
    DATA = {
      ...data,
      __sourceLabel: sourceLabel || DEFAULT_JSON,
    };
    ALL_ITEMS = normalizeItems(Array.isArray(DATA.items) ? DATA.items : []);

    const settings = loadJson(LS_SETTINGS, {});
    mode = ['focus', 'review', 'exam'].includes(settings.mode) ? settings.mode : mode;
    questionCount = isValidQuestionCount(settings.questionCount) ? settings.questionCount : questionCount;
    activeIndex = Number.isInteger(settings.activeIndex) ? settings.activeIndex : 0;
    selections = loadJson(LS_PROGRESS, {});

    buildSession(Array.isArray(settings.sessionIds) ? settings.sessionIds : []);
    isLoading = false;
    loadError = '';
    saveSettings();
    render();
  }

  function renderDots() {
    els.railDots.innerHTML = '';
    const fragment = document.createDocumentFragment();
    const { start, end } = getVisibleRange(SESSION_ITEMS.length, activeIndex, MAX_RAIL_ITEMS);

    SESSION_ITEMS.slice(start, end).forEach((question, offset) => {
      const index = start + offset;
      const dot = document.createElement('button');
      dot.className = 'rail-dot';
      dot.title = `Câu ${index + 1}`;

      if (index === activeIndex) dot.classList.add('active');
      if (getSelection(question.id).length) dot.classList.add('done');

      dot.addEventListener('click', () => {
        activeIndex = index;
        saveSettings();
        render();
      });

      fragment.append(dot);
    });

    els.railDots.append(fragment);
  }

  function renderQueue() {
    els.questionQueue.innerHTML = '';
    const fragment = document.createDocumentFragment();
    const { start, end } = getVisibleRange(SESSION_ITEMS.length, activeIndex, MAX_QUEUE_ITEMS);

    SESSION_ITEMS.slice(start, end).forEach((question, offset) => {
      const index = start + offset;
      const item = document.createElement('button');
      item.className = 'queue-item';

      const grade = gradeQuestion(question);
      if (index === activeIndex) item.classList.add('active');
      if (getSelection(question.id).length) item.classList.add('done');
      if (grade === 'right' && mode !== 'exam') item.classList.add('right');
      if (grade === 'wrong' && mode !== 'exam') item.classList.add('wrong');

      item.innerHTML = `
        <strong>${pad(index + 1)}. ${question.prompt}</strong>
        <span>${getQueueStatusLabel(question)}</span>
      `;

      item.addEventListener('click', () => {
        activeIndex = index;
        saveSettings();
        render();
      });

      fragment.append(item);
    });

    els.questionQueue.append(fragment);
  }

  function handleOptionSelect(question, optionKey) {
    const key = String(optionKey).toLowerCase();
    const current = getSelection(question.id);

    if (question.isMultiple) {
      const limit = getSelectionLimit(question);
      const next = current.includes(key)
        ? current.filter((value) => value !== key)
        : current.length < limit
          ? [...current, key]
          : current;

      saveSelection(question.id, next);
    } else {
      saveSelection(question.id, [key]);
    }

    saveSettings();
    render();
  }

  function renderOptions(question) {
    els.optionGrid.innerHTML = '';
    const selected = getSelection(question.id);
    const reveal = shouldReveal(question);

    question.options.forEach((option) => {
      const card = document.createElement('button');
      card.className = 'option-card';

      const isActive = selected.includes(option.key);
      const isCorrect = question.correctKeys.includes(option.key);

      if (isActive) card.classList.add('active');
      if (isActive && mode === 'exam') card.classList.add('done');
      if (reveal && isCorrect) card.classList.add('correct');
      if (reveal && isActive && !isCorrect) card.classList.add('wrong');

      card.innerHTML = `
        <span class="option-key">${option.key.toUpperCase()}</span>
        <strong>${option.text}</strong>
      `;

      card.addEventListener('click', () => handleOptionSelect(question, option.key));
      els.optionGrid.append(card);
    });
  }

  function renderProgress() {
    const { answered, gradable, correct } = computeSessionStats();
    const completion = SESSION_ITEMS.length ? Math.round((answered / SESSION_ITEMS.length) * 100) : 0;
    const stepCompletion = SESSION_ITEMS.length ? Math.round(((activeIndex + 1) / SESSION_ITEMS.length) * 100) : 0;

    els.totalCount.textContent = `/ ${pad(SESSION_ITEMS.length || 0)}`;
    els.currentIndex.textContent = pad(SESSION_ITEMS.length ? activeIndex + 1 : 0);
    els.queueStat.textContent = `${answered} / ${SESSION_ITEMS.length}`;
    els.sessionBar.style.width = `${completion}%`;

    if (window.matchMedia('(max-width: 980px)').matches) {
      els.railProgressBar.style.width = `${stepCompletion}%`;
      els.railProgressBar.style.height = '100%';
    } else {
      els.railProgressBar.style.height = `${stepCompletion}%`;
      els.railProgressBar.style.width = '100%';
    }

    if (isLoading) {
      els.sessionState.textContent = 'Loading';
    } else if (loadError) {
      els.sessionState.textContent = 'No Data';
    } else if (mode === 'review') {
      els.sessionState.textContent = `Review • ${correct}/${gradable || SESSION_ITEMS.length}`;
    } else if (mode === 'exam') {
      els.sessionState.textContent = `Exam • ${answered}/${SESSION_ITEMS.length}`;
    } else {
      els.sessionState.textContent = `Focus • ${answered}/${SESSION_ITEMS.length}`;
    }
  }

  function getTextLength(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().length;
  }

  function resetStageScale() {
    if (!els.questionStage) return;

    [
      '--question-area-size',
      '--option-area-size',
      '--title-base',
      '--title-line',
      '--stage-gap',
      '--stage-pad-y',
      '--stage-pad-x',
      '--note-size',
      '--note-line',
      '--note-gap',
      '--option-gap',
      '--option-card-gap',
      '--option-card-pad',
      '--option-card-min-height',
      '--option-text-size',
      '--option-text-line',
      '--option-key-size',
    ].forEach((property) => {
      els.questionStage.style.removeProperty(property);
    });
  }

  function applyStageProfile(question = null) {
    if (!els.questionStage) return;
    resetStageScale();
    if (!question) return;

    const compactViewport = window.matchMedia('(max-width: 980px)').matches;
    const promptLength = getTextLength(question.prompt);
    const hintLength = getTextLength(getHintText(question));
    const optionLengths = question.options.map((option) => getTextLength(option.text));
    const optionCount = Math.max(question.options.length, 1);
    const longestOption = optionLengths.length ? Math.max(...optionLengths) : 0;
    const totalOptionLength = optionLengths.reduce((sum, value) => sum + value, 0);
    const averageOptionLength = optionLengths.length ? totalOptionLength / optionLengths.length : 0;

    const questionArea = clamp(
      0.9 + promptLength / (compactViewport ? 120 : 180) + hintLength / (compactViewport ? 260 : 360),
      compactViewport ? 1.05 : 0.95,
      compactViewport ? 2.35 : 1.95
    );
    const optionArea = clamp(
      1.05 + optionCount * 0.24 + totalOptionLength / (compactViewport ? 150 : 260) + longestOption / (compactViewport ? 180 : 300),
      compactViewport ? 1.35 : 1.2,
      compactViewport ? 4.2 : 3.1
    );
    const titleBase = clamp(
      (compactViewport ? 1.9 : 3.1) - promptLength / (compactViewport ? 260 : 210),
      compactViewport ? 1.18 : 1.6,
      compactViewport ? 1.9 : 3.1
    );
    const noteSize = clamp(
      (compactViewport ? 0.88 : 1) - hintLength / (compactViewport ? 620 : 860),
      compactViewport ? 0.76 : 0.84,
      compactViewport ? 0.88 : 1
    );
    const optionTextSize = clamp(
      (compactViewport ? 0.96 : 1.06) - longestOption / (compactViewport ? 380 : 560),
      compactViewport ? 0.8 : 0.88,
      compactViewport ? 0.96 : 1.06
    );
    const optionMinHeight = clamp(
      (compactViewport ? 76 : 100) + averageOptionLength * (compactViewport ? 0.45 : 0.35),
      compactViewport ? 76 : 100,
      compactViewport ? 140 : 168
    );

    els.questionStage.style.setProperty('--question-area-size', `${questionArea.toFixed(2)}fr`);
    els.questionStage.style.setProperty('--option-area-size', `${optionArea.toFixed(2)}fr`);
    els.questionStage.style.setProperty('--title-base', `${titleBase.toFixed(2)}rem`);
    els.questionStage.style.setProperty('--title-line', promptLength > (compactViewport ? 110 : 180) ? '1.08' : '1');
    els.questionStage.style.setProperty('--note-size', `${noteSize.toFixed(2)}rem`);
    els.questionStage.style.setProperty('--note-line', compactViewport ? '1.34' : '1.55');
    els.questionStage.style.setProperty('--option-text-size', `${optionTextSize.toFixed(2)}rem`);
    els.questionStage.style.setProperty('--option-card-min-height', `${Math.round(optionMinHeight)}px`);
  }

  function scheduleStageFit(question) {
    if (!els.questionStage) return;
    const nextQuestion = question === undefined ? SESSION_ITEMS[activeIndex] || null : question;
    if (fitFrame) cancelAnimationFrame(fitFrame);
    fitFrame = requestAnimationFrame(() => {
      fitFrame = 0;
      applyStageProfile(nextQuestion);
    });
  }

  function renderEmptyState(title, note) {
    els.btnPrev.disabled = true;
    els.btnNext.disabled = true;
    els.btnShuffle.disabled = true;
    els.questionTag.textContent = 'QuizMaker';
    els.questionTone.textContent = 'Waiting';
    els.questionClock.textContent = '--';
    els.questionTitle.textContent = title;
    els.focusNote.textContent = note;
    els.optionGrid.innerHTML = '';
    els.questionQueue.innerHTML = '';
    els.railDots.innerHTML = '';
    els.queueStat.textContent = '0 / 0';
    els.currentIndex.textContent = '00';
    els.totalCount.textContent = '/ 00';
    els.sessionBar.style.width = '0%';
    if (window.matchMedia('(max-width: 980px)').matches) {
      els.railProgressBar.style.width = '0%';
      els.railProgressBar.style.height = '100%';
    } else {
      els.railProgressBar.style.height = '0%';
      els.railProgressBar.style.width = '100%';
    }
    scheduleStageFit(null);
  }

  function renderQuestion() {
    if (isLoading) {
      renderEmptyState('Đang nạp bộ câu hỏi...', 'QuizMaker đang tải dữ liệu thật cho phiên học này.');
      renderProgress();
      return;
    }

    if (loadError || !SESSION_ITEMS.length) {
      renderEmptyState('Không thể mở bộ câu hỏi.', loadError || 'Không có dữ liệu phù hợp để hiển thị.');
      renderProgress();
      return;
    }

    const question = SESSION_ITEMS[activeIndex];
    const limit = getSelectionLimit(question);
    const typeLabel = question.unresolvedAnswer
      ? 'Open'
      : question.isMultiple
        ? 'Multi'
        : 'Single';

    els.btnPrev.disabled = false;
    els.btnNext.disabled = false;
    els.btnShuffle.disabled = false;
    els.questionTag.textContent = question.chapter;
    els.questionTone.textContent = typeLabel;
    els.questionClock.textContent = question.isMultiple ? `${limit} đáp án` : '1 đáp án';
    els.questionTitle.textContent = question.prompt;
    els.focusNote.textContent = getHintText(question);

    renderOptions(question);
    renderQueue();
    renderDots();
    renderProgress();
    scheduleStageFit(question);
  }

  function render() {
    els.body.dataset.mode = mode;

    els.modeButtons.forEach((button) => {
      button.classList.toggle('active', button.dataset.mode === mode);
    });
    els.countButtons.forEach((button) => {
      button.classList.toggle('active', button.dataset.count === String(questionCount));
    });

    renderQuestion();
  }

  function nextQuestion() {
    if (!SESSION_ITEMS.length) return;
    activeIndex = (activeIndex + 1) % SESSION_ITEMS.length;
    saveSettings();
    render();
  }

  function prevQuestion() {
    if (!SESSION_ITEMS.length) return;
    activeIndex = (activeIndex - 1 + SESSION_ITEMS.length) % SESSION_ITEMS.length;
    saveSettings();
    render();
  }

  function shuffleSessionOrder() {
    if (!SESSION_ITEMS.length) return;
    const currentId = SESSION_ITEMS[activeIndex].id;
    SESSION_ITEMS = shuffle(SESSION_ITEMS);
    activeIndex = Math.max(SESSION_ITEMS.findIndex((question) => question.id === currentId), 0);
    saveSettings();
    render();
  }

  function createNewSession() {
    if (!ALL_ITEMS.length) return;
    SESSION_ITEMS = shuffle(ALL_ITEMS).slice(0, getResolvedQuestionCount());
    activeIndex = 0;
    saveSettings();
    render();
  }

  function handleKeydown(event) {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    const activeEl = document.activeElement;
    if (activeEl && /input|textarea|select/i.test(activeEl.tagName)) return;

    const question = SESSION_ITEMS[activeIndex];
    if (!question) return;

    if (event.key === 'ArrowRight') {
      event.preventDefault();
      nextQuestion();
      return;
    }

    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      prevQuestion();
      return;
    }

    const option = question.options.find((item) => item.key === event.key.toLowerCase());
    if (option) {
      event.preventDefault();
      handleOptionSelect(question, option.key);
    }
  }

  async function fetchDefaultData() {
    isLoading = true;
    loadError = '';
    render();

    try {
      const response = await fetch(DEFAULT_JSON, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setData(await response.json(), DEFAULT_JSON);
    } catch (error) {
      console.error(error);
      isLoading = false;
      loadError = 'Không tìm thấy hoặc không đọc được tệp JSON mặc định.';
      render();
    }
  }

  function readFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const rawText = typeof reader.result === 'string' ? reader.result : '';

        if (/\.json$/i.test(file.name)) {
          setData(JSON.parse(rawText), file.name);
          return;
        }

        if (!(window.QuizTextParser && typeof window.QuizTextParser.serializeQuizText === 'function')) {
          throw new Error('TXT parser unavailable');
        }

        const serialized = window.QuizTextParser.serializeQuizText(rawText, {
          sourceFile: file.name,
          title: file.name.replace(/\.[^.]+$/, ''),
        });
        setData(serialized, `${file.name} (serialized)`);
      } catch (error) {
        console.error(error);
        loadError = 'Tệp không hợp lệ hoặc chưa thể xử lý.';
        isLoading = false;
        render();
      }
    };

    reader.readAsText(file, 'utf-8');
  }

  els.modeButtons.forEach((button) => {
    button.addEventListener('click', () => {
      mode = button.dataset.mode;
      saveSettings();
      render();
    });
  });

  els.countButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const nextCount = parseQuestionCount(button.dataset.count);
      if (!isValidQuestionCount(nextCount) || nextCount === questionCount) return;
      questionCount = nextCount;
      createNewSession();
    });
  });

  els.btnPrev.addEventListener('click', prevQuestion);
  els.btnNext.addEventListener('click', nextQuestion);
  els.btnShuffle.addEventListener('click', shuffleSessionOrder);
  els.btnReload.addEventListener('click', (event) => {
    if (!DATA || loadError || event.shiftKey) {
      els.fileInput.click();
      return;
    }
    createNewSession();
  });
  els.fileInput.addEventListener('change', (event) => {
    const file = event.target.files && event.target.files[0];
    if (file) readFile(file);
    event.target.value = '';
  });
  window.addEventListener('resize', () => {
    renderProgress();
    scheduleStageFit();
  });
  window.addEventListener('keydown', handleKeydown);

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      scheduleStageFit();
    }).catch(() => {});
  }

  render();
  fetchDefaultData();
})();
