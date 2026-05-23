'use strict';

const Fuse = require('fuse.js');
const config = require('./config');
const LRUCache = require('./cache');
const { cleanText } = require('./textUtils');
const { getQuestionBank, getIndexedCandidates } = require('./questionBank');

// ── 阈值管理 ──
let currentFuseThreshold = (function loadInitial() {
  const parsed = Number.parseFloat(config.fuseThresholdEnv || '');
  if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) return parsed;
  return config.fuseThresholdDefault;
})();

function getFuseThreshold() {
  return currentFuseThreshold;
}

function setFuseThreshold(value) {
  const parsed = Number.parseFloat(value);
  if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) {
    currentFuseThreshold = parsed;
    // 阈值变了，需要重建 Fuse 实例
    fuseInstance = null;
    fuseDataVersion = -1;
    return parsed;
  }
  return null;
}

// ── 答案缓存 ──
const answerCache = new LRUCache(config.cacheMaxSize);

// 清空答案缓存（强制下次搜索重新匹配）
function clearAnswerCache() {
  answerCache.clear();
}

// ── Fuse 实例缓存（修复原 BUG：用版本号而非引用比较） ──
let fuseInstance = null;
let fuseDataVersion = -1;
let dataVersion = 0; // 每次题库变更时递增，用于判断 Fuse 实例是否需要重建

/**
 * 通知匹配引擎题库已变更，需要重建 Fuse 索引。
 * 由 questionBank.saveQuestionBank 调用。
 */
function invalidateFuse() {
  dataVersion++;
  answerCache.clear();
}

function ensureFuseInstance() {
  if (fuseInstance && fuseDataVersion === dataVersion) {
    return fuseInstance;
  }

  const bank = getQuestionBank();
  // 性能优化：使用已缓存的 normalized_question，避免重复 cleanText
  const searchData = bank.map(item => ({
    ...item,
    normalized_question: item._normalized_question || (item._normalized_question = cleanText(item.question || '')),
  }));

  fuseInstance = new Fuse(searchData, {
    keys: ['normalized_question'],
    includeScore: true,
    threshold: currentFuseThreshold,
    ignoreLocation: true,
    minMatchCharLength: 2,
  });
  fuseDataVersion = dataVersion;
  return fuseInstance;
}

// ── 核心匹配 ──
function findAnswerWithOption(questionText, questionBank) {
  if (!questionText) return null;

  const cleaned = cleanText(questionText);
  if (!cleaned || !Array.isArray(questionBank) || questionBank.length === 0) {
    return null;
  }

  const cached = answerCache.get(cleaned);
  if (cached) return cached;

  // 先用倒排索引缩小候选集
  const candidates = getIndexedCandidates(cleaned);
  let fuse;

  if (candidates.length > 0 && candidates.length < questionBank.length) {
    // 候选集较小时，临时构建小 Fuse（不缓存）
    // 性能优化：使用已缓存的 normalized_question
    const searchData = candidates.map(item => ({
      ...item,
      normalized_question: item._normalized_question || (item._normalized_question = cleanText(item.question || '')),
    }));
    fuse = new Fuse(searchData, {
      keys: ['normalized_question'],
      includeScore: true,
      threshold: currentFuseThreshold,
      ignoreLocation: true,
      minMatchCharLength: 2,
    });
  } else {
    // 全量搜索，使用缓存实例
    fuse = ensureFuseInstance();
  }

  const matches = fuse.search(cleaned);
  if (matches.length > 0 && matches[0].item) {
    const matched = matches[0].item;
    if (matched.answer) {
      answerCache.set(cleaned, matched);
    }
    return matched;
  }

  return null;
}

// ── 答案字母解析 ──
function parseAnswerLetters(answerStr, options, questionType) {
  const results = [];
  // 性能优化：缓存 cleanText 结果
  const optionMap = {
    a: options._cleaned_a || (options._cleaned_a = cleanText(options.a || '')),
    b: options._cleaned_b || (options._cleaned_b = cleanText(options.b || '')),
    c: options._cleaned_c || (options._cleaned_c = cleanText(options.c || '')),
    d: options._cleaned_d || (options._cleaned_d = cleanText(options.d || '')),
  };

  if (!answerStr) return results;

  // 简答题：直接返回完整答案文本
  if (questionType === 'short_answer') {
    return [{ letter: '', answer: answerStr }];
  }

  function findOptionByText(answerText) {
    const cleanedAnswerText = cleanText(answerText || '');
    if (!cleanedAnswerText) return null;

    let bestLetter = null;
    let bestLen = -1;

    for (const letter of ['a', 'b', 'c', 'd']) {
      const optionText = optionMap[letter];
      if (!optionText) continue;

      // 精确匹配 → 立即返回
      if (optionText === cleanedAnswerText) {
        return letter;
      }

      // 子串匹配：选选项文本最长的（最具体的那个）
      if (
        optionText.includes(cleanedAnswerText) ||
        cleanedAnswerText.includes(optionText)
      ) {
        // 越长越具体，靠选项文本长度区分"列车" vs "列车开出"
        if (optionText.length > bestLen) {
          bestLen = optionText.length;
          bestLetter = letter;
        }
      }
    }

    return bestLetter;
  }

  // 将匹配到的选项字母加入结果列表
  function pushOption(letter) {
    const content = options[letter];
    if (content) {
      results.push({
        letter: letter.toUpperCase(),
        option: 'option_' + letter,
        content,
      });
    }
  }

  // 多选：A.内容;B.内容;C.内容
  if (answerStr.includes(';')) {
    const parts = answerStr.split(';');
    for (const part of parts) {
      const m = part.match(/^([A-D])\s*[.．、]?\s*(.*)/i);
      if (m) {
        const text = (m[2] || '').trim();
        if (text) {
          // 正文匹配页面选项，回退到字母前缀
          const found = findOptionByText(text);
          pushOption(found || m[1].toLowerCase());
        } else {
          pushOption(m[1].toLowerCase());
        }
      }
    }
  }
  // 多选：纯字母 "ABC"
  else if (/^[A-D]+$/.test(answerStr)) {
    for (const char of answerStr.toUpperCase()) {
      if ('ABCD'.includes(char)) {
        pushOption(char.toLowerCase());
      }
    }
  }
  // 多选：A.内容B.内容（连续拼接无分隔符，如 "B.重大风险C.一般隐患"）
  else if ((answerStr.match(/[A-D][．.、\s]/gi) || []).length > 1) {
    const parts = answerStr.split(/(?=[A-D][．.、\s])/).filter(Boolean);
    for (const part of parts) {
      const m = part.match(/^([A-D])\s*[．.、\s]?\s*(.*)/i);
      if (m) {
        const text = (m[2] || '').trim();
        if (text) {
          const found = findOptionByText(text);
          pushOption(found || m[1].toLowerCase());
        } else {
          pushOption(m[1].toLowerCase());
        }
      }
    }
  }
  // 单选：A.内容 或 A
  else {
    // 提取字母前缀和正文（如 "A.报警处理" → letter=A, text=报警处理）
    const prefixMatch = answerStr.match(/^([A-D])\s*[.．、]?\s*(.*)/i);
    if (prefixMatch) {
      const letter = prefixMatch[1].toLowerCase();
      const text = (prefixMatch[2] || '').trim();
      if (text) {
        // 有正文内容，优先用文本匹配页面选项
        const foundLetter = findOptionByText(text);
        if (foundLetter) {
          pushOption(foundLetter);
        } else {
          // 文本匹配失败，回退到字母前缀
          pushOption(letter);
        }
      } else {
        // 只有字母无正文（如 "A"）
        pushOption(letter);
      }
    }
    // 纯文本（无字母前缀），直接文本匹配
    else if (answerStr !== '对' && answerStr !== '正确' && answerStr !== '错' && answerStr !== '错误') {
      const foundLetter = findOptionByText(answerStr);
      if (foundLetter) {
        pushOption(foundLetter);
      }
    }
    // 判断题
    else if (answerStr === '对' || answerStr === '正确') {
      if (options.a === '对') pushOption('a');
    } else if (answerStr === '错' || answerStr === '错误') {
      if (options.b === '错') pushOption('b');
    }
  }

  return results;
}

module.exports = {
  getFuseThreshold,
  setFuseThreshold,
  findAnswerWithOption,
  parseAnswerLetters,
  invalidateFuse,
  clearAnswerCache,
  answerCache,
};
