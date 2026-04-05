(function initQuizTextParser(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (typeof window !== 'undefined') {
    window.QuizTextParser = api;
  } else if (root) {
    root.QuizTextParser = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function buildQuizTextParser() {
  const OPTION_LINE_RE = /^\s*([A-Za-zΑ-Δα-δ])\s*([.)])(\s*)(.*?)\s*$/;
  const ANSWER_KEYS_RE = /^\s*([A-Za-zΑ-Δα-δ]{1,6})\s*(?:\((.*)\))?\s*$/;
  const ANSWER_TEXT_RE = /^\s*=>\s*(.*?)\s*$/;
  const DUPLICATE_MATCH_REASONS = {
    duplicate_question: 'Resolved from another answered duplicate question.',
    special_override: 'Resolved from a curated special-case override.',
  };

  function normalizeText(text) {
    return String(text || '')
      .replace(/\uFEFF/g, '')
      .replace(/\r\n?/g, '\n');
  }

  function stripAccents(text) {
    return String(text || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[đĐ]/g, (char) => (char === 'đ' ? 'd' : 'D'));
  }

  function normalizeSpace(text) {
    return String(text || '')
      .replace(/[ \t]+/g, ' ')
      .replace(/\s+([,.;:?!\)])/g, '$1')
      .replace(/([\(\[])\s+/g, '$1')
      .trim();
  }

  function toComparable(text) {
    return stripAccents(text)
      .toLowerCase()
      .replace(/["'`]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function basename(filePath) {
    const parts = String(filePath || '').split(/[\\/]/);
    return parts[parts.length - 1] || 'quiz.txt';
  }

  function withoutExtension(fileName) {
    return String(fileName || '').replace(/\.[^.]+$/, '');
  }

  function getSourceKey(sourceFile) {
    return toComparable(withoutExtension(basename(sourceFile))).replace(/\s+/g, '');
  }

  function hashText(text) {
    let hash = 2166136261;
    const value = String(text || '');
    for (let i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  function splitLines(text) {
    return normalizeText(text).split('\n');
  }

  function countSelectionHint(text) {
    const plain = stripAccents(text).toLowerCase();
    let match = plain.match(/\b(?:chon|choose|lua chon)\s*(\d+)/);
    if (match) return Number(match[1]);
    match = plain.match(/\b(\d+)\s*(?:dap an|answers?|cau)\b/);
    if (match && /\b(?:chon|choose|lua chon|dap an|answer|cau)\b/.test(plain)) {
      return Number(match[1]);
    }
    return null;
  }

  function isAltBlockStart(text) {
    const plain = toComparable(text);
    return plain.startsWith('kieu hoi khac') || plain.startsWith('( kieu hoi khac');
  }

  function looksLikeQuestionPrompt(text) {
    const plain = stripAccents(normalizeSpace(text)).toLowerCase();
    if (!plain) return false;
    if (plain.includes('?')) return true;
    return /\b(hoi nghi|dai hoi|duong loi|noi dung|muc tieu|thoi gian nao|la gi|bao nhieu|chu truong|cuong linh|loi keu goi|hoi nghi trung uong)\b/.test(plain);
  }

  function isSourceTag(text) {
    const value = normalizeSpace(text);
    if (!value) return false;
    const plain = stripAccents(value).toLowerCase();
    if (/(kieu hoi khac|chon|choose|lua chon|dap an|answer)/.test(plain)) return false;
    if (/[?!:]/.test(value)) return false;
    if (/^[0-9+().\s-]{6,}$/.test(value)) return true;
    return /^[\p{Lu}\p{M}0-9 .,'_-]+$/u.test(value);
  }

  function isStandaloneParenLine(text) {
    return /^\s*\(.*\)\s*$/.test(text);
  }

  function parseOptionLine(text) {
    const match = String(text || '').match(OPTION_LINE_RE);
    if (!match) return null;
    return {
      key: normalizeOptionKey(match[1]),
      text: normalizeSpace(match[4]),
      hasGap: match[3].length > 0,
    };
  }

  function normalizeOptionKey(value) {
    const key = String(value || '').trim().toLowerCase();
    if (key === 'α') return 'a';
    if (key === 'β') return 'b';
    if (key === 'γ') return 'c';
    if (key === 'δ') return 'd';
    return key;
  }

  function parseAnswerKeysLine(text) {
    const value = normalizeSpace(text);
    const match = value.match(ANSWER_KEYS_RE);
    if (!match) return null;
    const keys = match[1].split('').map((key) => normalizeOptionKey(key));
    if (!keys.every((key) => /^[a-z]$/.test(key))) return null;
    return {
      keys,
      note: normalizeSpace(match[2] || ''),
      line: value,
    };
  }

  function parseAnswerTextLine(text) {
    const match = String(text || '').match(ANSWER_TEXT_RE);
    if (!match) return null;
    const value = normalizeSpace(match[1]).replace(/\)\s*$/, '').trim();
    return value || null;
  }

  function parseQuestionMeta(line) {
    let text = normalizeSpace(line);
    const sourceTags = [];
    let changed = true;

    while (changed) {
      changed = false;
      const match = text.match(/^(.*?)(\(([^()]*)\))\s*$/);
      if (!match) break;
      const inner = normalizeSpace(match[3]);
      if (!inner || !isSourceTag(inner)) break;
      sourceTags.unshift(inner);
      text = normalizeSpace(match[1]);
      changed = true;
    }

    return {
      text,
      sourceTags,
      selectHint: countSelectionHint(text),
    };
  }

  function cloneOptions(options) {
    return Array.isArray(options)
      ? options.map((option) => ({ key: option.key, text: option.text }))
      : [];
  }

  function createDraft(kind, parentItem) {
    return {
      kind,
      parentItem,
      questionLines: [],
      options: [],
      rawLines: [],
      notes: [],
      sourceTags: [],
      answerKeys: [],
      answerLine: '',
      answerNote: '',
      answerText: '',
      selectHint: null,
      lastOptionIndex: -1,
    };
  }

  function addQuestionLine(draft, line) {
    const meta = parseQuestionMeta(line);
    if (meta.sourceTags.length) {
      draft.sourceTags.push(...meta.sourceTags);
    }
    if (meta.selectHint) {
      draft.selectHint = Math.max(draft.selectHint || 0, meta.selectHint);
    }
    if (!meta.text) return;
    if (!draft.questionLines.length) {
      draft.questionLines.push(meta.text);
      return;
    }
    draft.questionLines[draft.questionLines.length - 1] = normalizeSpace(
      `${draft.questionLines[draft.questionLines.length - 1]} ${meta.text}`
    );
  }

  function appendToLastOption(draft, line) {
    if (draft.lastOptionIndex < 0 || !draft.options[draft.lastOptionIndex]) {
      draft.notes.push(normalizeSpace(line));
      return;
    }
    draft.options[draft.lastOptionIndex].text = normalizeSpace(
      `${draft.options[draft.lastOptionIndex].text} ${line}`
    );
  }

  function extractCorrectTexts(item) {
    if (!item || !Array.isArray(item.correct_keys) || !Array.isArray(item.options)) {
      return [];
    }
    const keys = new Set(item.correct_keys.map((key) => String(key).toLowerCase()));
    return item.options
      .filter((option) => keys.has(String(option.key).toLowerCase()))
      .map((option) => option.text);
  }

  function resolveKeysByAnswerText(answerText, options) {
    const comparableAnswer = toComparable(answerText);
    if (!comparableAnswer || !Array.isArray(options) || !options.length) return [];

    const exactMatches = options
      .filter((option) => toComparable(option.text) === comparableAnswer)
      .map((option) => option.key);
    if (exactMatches.length) return exactMatches;

    const partialMatches = options
      .filter((option) => {
        const comparableOption = toComparable(option.text);
        return comparableOption && (
          comparableOption.includes(comparableAnswer) ||
          comparableAnswer.includes(comparableOption)
        );
      })
      .map((option) => option.key);

    return partialMatches.length === 1 ? partialMatches : [];
  }

  function resolveKeysFromParent(parentItem, options) {
    const correctTexts = extractCorrectTexts(parentItem);
    if (!correctTexts.length || !Array.isArray(options) || !options.length) return [];

    const resolved = [];
    correctTexts.forEach((text) => {
      const matches = resolveKeysByAnswerText(text, options);
      if (matches.length === 1 && !resolved.includes(matches[0])) {
        resolved.push(matches[0]);
      }
    });
    return resolved.length === correctTexts.length ? resolved : [];
  }

  function computeType(correctKeys, selectHint) {
    if (Array.isArray(correctKeys) && correctKeys.length > 1) return 'multiple';
    if ((selectHint || 0) > 1) return 'multiple';
    return 'single';
  }

  function cleanupQuestionText(question) {
    let value = normalizeSpace(question);
    if (value.startsWith('(') && countParens(value) > 0) {
      value = normalizeSpace(value.slice(1));
    }
    return value;
  }

  function cleanupOptionArtifacts(options, draft) {
    if (!Array.isArray(options) || !options.length) return options;
    const cleaned = options.map((option) => ({ ...option }));
    const firstRawLine = normalizeSpace((draft.rawLines && draft.rawLines[0]) || '');
    const looksWrapped = firstRawLine.startsWith('(') || isAltBlockStart(firstRawLine);

    if (looksWrapped) {
      const last = cleaned[cleaned.length - 1];
      if (last && /\)\s*$/.test(last.text)) {
        last.text = normalizeSpace(last.text.replace(/\)\s*$/, ''));
      }
    }

    return cleaned;
  }

  function finalizeDraft(draft, context) {
    const question = cleanupQuestionText(draft.questionLines.join(' '));
    let options = draft.options
      .filter((option) => option && option.key)
      .map((option) => ({
        key: String(option.key).toLowerCase(),
        text: normalizeSpace(option.text),
      }));

    options = cleanupOptionArtifacts(options, draft);

    if (!question) return null;

    let correctKeys = [];
    if (draft.answerKeys.length) {
      correctKeys = draft.answerKeys
        .map((key) => String(key).toLowerCase())
        .filter((key, index, arr) => arr.indexOf(key) === index);
    } else if (draft.answerText) {
      correctKeys = resolveKeysByAnswerText(draft.answerText, options);
      if (!correctKeys.length && draft.parentItem) {
        correctKeys = resolveKeysByAnswerText(draft.answerText, draft.parentItem.options || []);
        if (correctKeys.length && !options.length) {
          correctKeys = correctKeys.slice();
        } else if (!correctKeys.length) {
          correctKeys = resolveKeysFromParent(draft.parentItem, options);
        }
      }
    } else if (draft.kind === 'alternate' && draft.parentItem) {
      if (!draft.options.length && Array.isArray(draft.parentItem.correct_keys)) {
        correctKeys = draft.parentItem.correct_keys.slice();
      } else {
        correctKeys = resolveKeysFromParent(draft.parentItem, options);
      }
    }

    const validKeys = new Set(options.map((option) => option.key));
    correctKeys = correctKeys.filter((key) => validKeys.has(key));

    context.questionNumber += 1;

    const item = {
      id: `${context.chapterCode}-${String(context.questionNumber).padStart(4, '0')}-${hashText(`${question}|${options.map((option) => `${option.key}:${option.text}`).join('|')}`)}`,
      chapter_code: context.chapterCode,
      chapter_order: context.chapterOrder,
      question_number: context.questionNumber,
      question,
      options,
      correct_keys: correctKeys,
      type: computeType(correctKeys, draft.selectHint),
      answer_line: draft.answerLine || '',
      raw: draft.rawLines.join('\n'),
      source_kind: draft.kind,
    };

    if (draft.parentItem) item.parent_id = draft.parentItem.id;
    if (draft.answerNote) item.answer_note = draft.answerNote;
    if (draft.answerText) item.answer_text = draft.answerText;
    if (draft.notes.length) item.notes = draft.notes.map((note) => normalizeSpace(note)).filter(Boolean);
    if (draft.sourceTags.length) item.source_tags = draft.sourceTags.filter(Boolean);
    if (draft.selectHint) item.selection_hint = draft.selectHint;
    if (!correctKeys.length) item.unresolved_answer = true;

    return item;
  }

  function countParens(text) {
    let count = 0;
    const value = String(text || '');
    for (let i = 0; i < value.length; i += 1) {
      if (value[i] === '(') count += 1;
      if (value[i] === ')') count -= 1;
    }
    return count;
  }

  function consumeAltBlock(lines, startIndex) {
    const blockLines = [];
    let depth = 0;
    let index = startIndex;
    let sawOption = false;
    let sawAnswer = false;

    while (index < lines.length) {
      const line = lines[index];
      const normalized = normalizeSpace(line);

      if (
        index > startIndex &&
        depth > 0 &&
        sawOption &&
        (sawAnswer || looksLikeQuestionPrompt(normalized)) &&
        normalized &&
        !parseOptionLine(normalized) &&
        !parseAnswerKeysLine(normalized) &&
        !parseAnswerTextLine(normalized) &&
        (looksLikeQuestionPrompt(normalized) || isAltBlockStart(normalized))
      ) {
        break;
      }

      blockLines.push(line);
      depth += countParens(line);
      if (parseOptionLine(normalized)) sawOption = true;
      if (parseAnswerKeysLine(normalized) || parseAnswerTextLine(normalized)) sawAnswer = true;
      if (depth <= 0 && index > startIndex) break;
      index += 1;
      if (depth <= 0) break;
    }

    return {
      blockLines,
      nextIndex: index,
    };
  }

  function isAnonymousAltBlockStart(lines, index) {
    const line = normalizeSpace(lines[index] || '');
    if (!line.startsWith('(') || isAltBlockStart(line)) return false;
    if (!looksLikeQuestionPrompt(line.slice(1))) return false;

    for (let cursor = index + 1; cursor < Math.min(lines.length, index + 8); cursor += 1) {
      const probe = normalizeSpace(lines[cursor] || '');
      if (!probe) continue;
      if (parseOptionLine(probe)) return true;
      if (!probe.startsWith('(') && looksLikeQuestionPrompt(probe)) return false;
    }
    return false;
  }

  function stripAltWrapper(blockLines, removeNamedPrefix) {
    const cleaned = blockLines.slice();
    if (!cleaned.length) return cleaned;
    cleaned[0] = cleaned[0].replace(/^\s*\(\s*/, '');
    if (removeNamedPrefix) {
      cleaned[0] = cleaned[0].replace(/^Ki[^\:]*\:\s*/i, '');
    }
    cleaned[cleaned.length - 1] = cleaned[cleaned.length - 1].replace(/\)\s*$/, '');
    return cleaned;
  }

  function shouldSplitAltPrompt(previousLine, nextLine) {
    if (!previousLine) return false;
    if (countSelectionHint(nextLine)) return false;
    if (isStandaloneParenLine(nextLine)) return false;
    return /[?)]\s*$/.test(previousLine) && /^[\p{L}\p{M}0-9]/u.test(nextLine);
  }

  function buildAltPrompts(lines) {
    const prompts = [];
    let current = '';

    lines.forEach((line) => {
      const value = normalizeSpace(line);
      if (!value) return;
      if (!current) {
        current = value;
        return;
      }
      if (shouldSplitAltPrompt(current, value)) {
        prompts.push(normalizeSpace(current));
        current = value;
        return;
      }
      current = normalizeSpace(`${current} ${value}`);
    });

    if (current) prompts.push(normalizeSpace(current));
    return prompts;
  }

  function buildAlternateItems(blockLines, parentItem, context, options) {
    const cleanedLines = stripAltWrapper(blockLines, options && options.removeNamedPrefix);
    const promptLines = [];
    const sharedOptions = [];
    const sourceTags = [];
    const notes = [];
    let selectHint = null;
    let answerKeys = [];
    let answerLine = '';
    let answerNote = '';
    let answerText = '';
    let lastOptionIndex = -1;

    cleanedLines.forEach((rawLine) => {
      const line = normalizeSpace(rawLine);
      if (!line) return;

      const option = parseOptionLine(line);
      if (option && (option.hasGap || promptLines.length || sharedOptions.length)) {
        sharedOptions.push({ key: option.key, text: option.text });
        lastOptionIndex = sharedOptions.length - 1;
        return;
      }

      const answerByKeys = parseAnswerKeysLine(line);
      if (answerByKeys && (sharedOptions.length || parentItem)) {
        answerKeys = answerByKeys.keys;
        answerLine = answerByKeys.line;
        answerNote = answerByKeys.note;
        return;
      }

      const answerByText = parseAnswerTextLine(line);
      if (answerByText) {
        answerText = answerByText;
        return;
      }

      if (sharedOptions.length && lastOptionIndex >= 0) {
        sharedOptions[lastOptionIndex].text = normalizeSpace(`${sharedOptions[lastOptionIndex].text} ${line}`);
        return;
      }

      const meta = parseQuestionMeta(line);
      if (meta.sourceTags.length) sourceTags.push(...meta.sourceTags);
      if (meta.selectHint) selectHint = Math.max(selectHint || 0, meta.selectHint);
      if (!meta.text) return;
      if (isStandaloneParenLine(meta.text) && !countSelectionHint(meta.text)) {
        notes.push(meta.text);
        return;
      }
      promptLines.push(meta.text);
    });

    const prompts = buildAltPrompts(promptLines);
    const inheritedPrompts = [];
    let localPrompts = prompts.slice();

    if (sharedOptions.length && prompts.length > 1 && parentItem) {
      inheritedPrompts.push(...prompts.slice(0, -1));
      localPrompts = prompts.slice(-1);
    }

    const items = [];

    inheritedPrompts.forEach((prompt) => {
      const draft = createDraft('alternate', parentItem);
      draft.questionLines = [prompt];
      draft.options = cloneOptions(parentItem ? parentItem.options : []);
      draft.rawLines = blockLines.slice();
      draft.notes = notes.slice();
      draft.sourceTags = sourceTags.slice();
      draft.selectHint = selectHint;
      const item = finalizeDraft(draft, context);
      if (item) items.push(item);
    });

    const baseOptions = sharedOptions.length ? sharedOptions : cloneOptions(parentItem ? parentItem.options : []);
    localPrompts.forEach((prompt) => {
      const draft = createDraft('alternate', parentItem);
      draft.questionLines = [prompt];
      draft.options = cloneOptions(baseOptions);
      draft.rawLines = blockLines.slice();
      draft.notes = notes.slice();
      draft.sourceTags = sourceTags.slice();
      draft.answerKeys = answerKeys.slice();
      draft.answerLine = answerLine;
      draft.answerNote = answerNote;
      draft.answerText = answerText;
      draft.selectHint = selectHint;
      const item = finalizeDraft(draft, context);
      if (item) items.push(item);
    });

    return items;
  }

  function looksLikeNewQuestionAfterBrokenBlock(line) {
    const plain = stripAccents(line).toLowerCase();
    if (!line || isStandaloneParenLine(line)) return false;
    if (line.includes('?')) return true;
    return /\b(theo|tai sao|vi sao|dau|ai|bao nhieu|hinh thuc|dieu kien|noi dung|muc dich|chuc nang|nguyen nhan)\b/.test(plain);
  }

  function attachPostNote(item, line) {
    if (!item) return;
    const value = normalizeSpace(line.replace(/^\(|\)$/g, ''));
    if (!value) return;
    if (!Array.isArray(item.notes)) item.notes = [];
    item.notes.push(value);
  }

  function applyResolvedKeys(item, keys, reason, note) {
    if (!item || !Array.isArray(keys) || !keys.length) return false;
    item.correct_keys = keys.slice();
    item.type = computeType(item.correct_keys, item.selection_hint);
    item.answer_line = item.answer_line || `[auto:${reason}] ${item.correct_keys.join('').toUpperCase()}`;
    item.resolution_reason = DUPLICATE_MATCH_REASONS[reason] || reason;
    if (note) item.resolution_note = note;
    delete item.unresolved_answer;
    return true;
  }

  function buildAnsweredQuestionMap(items) {
    const map = new Map();
    items.forEach((item) => {
      addAnsweredQuestion(map, item);
    });
    return map;
  }

  function addAnsweredQuestion(map, item) {
    if (!map || !item || !Array.isArray(item.correct_keys) || !item.correct_keys.length) return;
    const key = toComparable(item.question);
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    if (!map.get(key).includes(item)) {
      map.get(key).push(item);
    }
  }

  function resolveByDuplicateQuestion(item, answeredByQuestion) {
    const candidates = answeredByQuestion.get(toComparable(item.question)) || [];
    const resolvedSets = [];

    candidates.forEach((candidate) => {
      const candidateTexts = extractCorrectTexts(candidate);
      let keys = [];

      if (candidateTexts.length) {
        candidateTexts.forEach((text) => {
          const matches = resolveKeysByAnswerText(text, item.options);
          if (matches.length === 1 && !keys.includes(matches[0])) {
            keys.push(matches[0]);
          }
        });
      } else if (Array.isArray(candidate.correct_keys) && candidate.correct_keys.length) {
        const validKeys = new Set(item.options.map((option) => option.key));
        keys = candidate.correct_keys.filter((key) => validKeys.has(key));
      }

      if (keys.length) {
        resolvedSets.push(keys.sort().join(','));
      }
    });

    const unique = [...new Set(resolvedSets)];
    if (unique.length !== 1) return null;
    return unique[0].split(',').filter(Boolean);
  }

  function buildSpecialCaseMap() {
    const defs = {
      mln131: [
        {
          question: 'Dau khong phai la tien de khoa hoc tu nhien cho su ra doi cua chu nghia xa hoi khoa hoc?',
          answerText: 'Chu nghia xa hoi khong tuong cua Phap',
        },
        {
          question: 'Dau la tac pham kinh dien chu yeu cua chu nghia xa hoi khoa hoc?',
          answerText: 'Tuyen ngon cua Dang Cong san',
        },
        {
          question: 'Quyen binh dang giua cac dan toc la co so de thuc hien van de gi?',
          answerText: 'Quyen dan toc tu quyet va xay dung moi quan he huu nghi hop tac giua cac dan toc',
        },
        {
          question: 'Can cu vao pham vi tac dong cua quyen luc nha nuoc chuc nang cua nha nuoc xa hoi chu nghia duoc chia thanh nhung hinh thuc nao?',
          answerText: 'Chuc nang doi noi va chuc nang doi ngoai',
        },
        {
          question: 'Cac the luc thu dich su dung chien luoc dien bien hoa binh chong pha su nghiep xay dung To quoc xa hoi chu nghia cua nhan dan ta tren phuong dien trong yeu nao?',
          answerText: 'Chinh tri tu tuong',
        },
      ],
      vnr202: [
        {
          question: 'Chu truong trong quan he quoc te cua Viet Nam duoc Dai hoi Dang lan thu IX dua ra la:',
          answerText:
            'Viet Nam san sang la ban, la doi tac tin cay cua cac nuoc trong dong dong quoc te, phan dau vi hoa binh doc lap va phat trien.',
        },
        {
          question: 'Dai hoi Dang lan thu III (9/1960) xac dinh muc tieu chung truoc mat cua ca nuoc la:',
          answerText: 'Giai phong mien Nam, hoa binh, thong nhat To quoc',
        },
        {
          question:
            'Cuong linh xay dung dat nuoc trong thoi ky qua do len chu nghia xa hoi (bo sung, phat trien nam 2011) da sung dac trung cua xa hoi xa hoi chu nghia ma nhan dan ta xay dung. Diem bo sung do la:',
          answerText: 'Dan giau, nuoc manh, dan chu, cong bang, van minh',
        },
        {
          question: 'Noi dung nao khong dung trong dac trung chu yeu cua duong loi cong nghiep hoa thoi ky truoc doi moi?',
          answerText: 'Cong nghiep hoa duoc thuc hien thong qua co che thi truong dinh huong xa hoi chu nghia.',
        },
        {
          question: 'Loi keu goi toan quoc khang chien cua Chu tich Ho Chi Minh duoc phat ra vao thoi gian nao?',
          answerText: '19-12-1946',
        },
      ],
    };

    const buckets = {};
    Object.keys(defs).forEach((sourceKey) => {
      const bucket = new Map();
      defs[sourceKey].forEach((entry) => {
        const questionKey = toComparable(entry.question);
        bucket.set(questionKey, entry);
      });
      buckets[sourceKey] = bucket;
    });
    return buckets;
  }

  const SPECIAL_CASES = buildSpecialCaseMap();

  function getSpecialCaseOverride(item, sourceFile) {
    const sourceKey = getSourceKey(sourceFile);
    const bucket = SPECIAL_CASES[sourceKey];
    if (!bucket) return null;

    const direct = bucket.get(toComparable(item.question));
    if (direct) return direct;

    const compact = toComparable(item.question).replace(/\blua chon phuong an dung nhat\b/g, '').trim();
    return bucket.get(compact) || null;
  }

  function resolveWithSpecialCase(item, sourceFile) {
    const override = getSpecialCaseOverride(item, sourceFile);
    if (!override) return false;

    let keys = [];
    if (Array.isArray(override.keys) && override.keys.length) {
      keys = override.keys
        .map((key) => String(key).toLowerCase())
        .filter((key) => item.options.some((option) => option.key === key));
    } else if (override.answerText) {
      keys = resolveKeysByAnswerText(override.answerText, item.options);
    }

    if (!keys.length) return false;
    return applyResolvedKeys(item, keys, 'special_override', override.answerText || '');
  }

  function applyPostParseResolutions(items, options) {
    const answeredByQuestion = buildAnsweredQuestionMap(items);
    let resolvedCount = 0;

    items.forEach((item) => {
      if (!item.unresolved_answer) return;

      const fromDuplicate = resolveByDuplicateQuestion(item, answeredByQuestion);
      if (fromDuplicate && applyResolvedKeys(item, fromDuplicate, 'duplicate_question')) {
        addAnsweredQuestion(answeredByQuestion, item);
        resolvedCount += 1;
        return;
      }

      if (resolveWithSpecialCase(item, options.sourceFile || 'quiz.txt')) {
        addAnsweredQuestion(answeredByQuestion, item);
        resolvedCount += 1;
      }
    });

    return resolvedCount;
  }

  function parseQuizText(text, options) {
    const opts = options || {};
    const sourceFile = opts.sourceFile || 'quiz.txt';
    const sourceName = withoutExtension(basename(sourceFile));
    const chapterCode = opts.chapterCode || sourceName;
    const lines = splitLines(text);
    const context = {
      chapterCode,
      chapterOrder: Number(opts.chapterOrder || 1),
      questionNumber: 0,
    };

    const items = [];
    let current = null;
    let lastPrimaryItem = null;
    let lastItem = null;

    for (let index = 0; index < lines.length; index += 1) {
      const rawLine = lines[index];
      const line = normalizeSpace(rawLine);
      if (!line) continue;

      if (isAltBlockStart(line) || isAnonymousAltBlockStart(lines, index)) {
        if (current && current.questionLines.length) {
          const unfinished = finalizeDraft(current, context);
          if (unfinished) {
            items.push(unfinished);
            lastItem = unfinished;
            if (unfinished.source_kind === 'primary') lastPrimaryItem = unfinished;
          }
          current = null;
        }

        const block = consumeAltBlock(lines, index);
        const altItems = buildAlternateItems(block.blockLines, lastPrimaryItem || lastItem, context, {
          removeNamedPrefix: isAltBlockStart(line),
        });
        altItems.forEach((item) => items.push(item));
        if (altItems.length) lastItem = altItems[altItems.length - 1];
        index = block.nextIndex;
        continue;
      }

      if (!current) {
        const standaloneAnswer = parseAnswerKeysLine(line);
        if (standaloneAnswer && lastItem && !lastItem.correct_keys.length) {
          const validKeys = standaloneAnswer.keys.filter((key) =>
            Array.isArray(lastItem.options) && lastItem.options.some((option) => option.key === key)
          );
          if (validKeys.length) {
            lastItem.correct_keys = validKeys;
            lastItem.answer_line = standaloneAnswer.line;
            if (standaloneAnswer.note) lastItem.answer_note = standaloneAnswer.note;
            lastItem.type = computeType(lastItem.correct_keys, lastItem.selection_hint);
            delete lastItem.unresolved_answer;
            continue;
          }
        }

        if (isStandaloneParenLine(line) && !isAltBlockStart(line)) {
          attachPostNote(lastItem, line);
          continue;
        }

        current = createDraft('primary', null);
      }

      current.rawLines.push(rawLine);

      const option = parseOptionLine(line);
      if (option && (option.hasGap || current.questionLines.length || current.options.length)) {
        current.options.push(option);
        current.lastOptionIndex = current.options.length - 1;
        continue;
      }

      const answerByKeys = parseAnswerKeysLine(line);
      if (answerByKeys && current.options.length) {
        current.answerKeys = answerByKeys.keys;
        current.answerLine = answerByKeys.line;
        current.answerNote = answerByKeys.note;

        const item = finalizeDraft(current, context);
        if (item) {
          items.push(item);
          lastItem = item;
          lastPrimaryItem = item;
        }
        current = null;
        continue;
      }

      const answerByText = parseAnswerTextLine(line);
      if (answerByText && current.options.length) {
        current.answerText = answerByText;

        const item = finalizeDraft(current, context);
        if (item) {
          items.push(item);
          lastItem = item;
          lastPrimaryItem = item;
        }
        current = null;
        continue;
      }

      if (current.options.length) {
        if (looksLikeNewQuestionAfterBrokenBlock(line)) {
          const item = finalizeDraft(current, context);
          if (item) {
            items.push(item);
            lastItem = item;
            lastPrimaryItem = item;
          }
          current = createDraft('primary', null);
          current.rawLines.push(rawLine);
          addQuestionLine(current, line);
          continue;
        }
        appendToLastOption(current, line);
        continue;
      }

      addQuestionLine(current, line);
    }

    if (current && current.questionLines.length) {
      const item = finalizeDraft(current, context);
      if (item) items.push(item);
    }

    applyPostParseResolutions(items, opts);
    return items;
  }

  function serializeQuizText(text, options) {
    const opts = options || {};
    const sourceFile = opts.sourceFile || 'quiz.txt';
    const items = parseQuizText(text, opts);
    const unresolvedAnswers = items.filter((item) => item.unresolved_answer).length;
    const alternateItems = items.filter((item) => item.source_kind === 'alternate').length;
    const autoResolvedAnswers = items.filter((item) => item.resolution_reason).length;

    return {
      version: 7,
      title: opts.title || withoutExtension(basename(sourceFile)),
      note: 'Serialized from TXT with alternate-question, duplicate-question, and special-case handling.',
      source_files: [sourceFile],
      total_questions: items.length,
      parse_meta: {
        unresolved_answers: unresolvedAnswers,
        alternate_items: alternateItems,
        auto_resolved_answers: autoResolvedAnswers,
      },
      items,
    };
  }

  return {
    parseQuizText,
    serializeQuizText,
  };
});
