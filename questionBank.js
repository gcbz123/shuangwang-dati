'use strict';

const fs = require('fs');
const path = require('path');
const config = require('./config');
const logger = require('./logger');
const { cleanText, extractIndexKeys } = require('./textUtils');

// ── 内存数据 ──
let inMemoryQuestionBank = [];
let inMemoryExtractedQuestions = [];
const questionIndex = new Map();

// ── 写锁：防止并发写入导致数据丢失 ──
let writeLock = Promise.resolve();

function withWriteLock(fn) {
  const next = writeLock.then(fn, fn);
  writeLock = next.catch(() => {}); // 防止链式 rejection
  return next;
}

// ── 题型检测 ──
function detectQuestionType(answerPart) {
  if (!answerPart) return config.QUESTION_TYPES.SINGLE;

  // 兼容前端转换可能残留的前导标点（如 ":对"、"：A.对"）
  const normalized = answerPart.replace(/^[:：\s]+/, '');
  if (!normalized) return config.QUESTION_TYPES.SHORT;

  // 判断题：答案以"对/错/正确/错误"开头（后面不能紧跟中文，避免"正确佩戴"被误判）
  if (/^(对|错|正确|错误)(?![A-Za-z\u4e00-\u9fa5])/.test(normalized)) {
    return config.QUESTION_TYPES.JUDGMENT;
  }
  // 格式为 A.对 或 B.错 的也是判断题（后面不能紧跟中文，避免 A.正确佩戴 被误判）
  if (/^A\.(对|正确)(?![A-Za-z\u4e00-\u9fa5])/i.test(normalized) || /^B\.(错|错误)(?![A-Za-z\u4e00-\u9fa5])/i.test(normalized)) {
    return config.QUESTION_TYPES.JUDGMENT;
  }
  if (/^[A-D].*;(?:[A-D]|$)/i.test(normalized) || /^[A-D]+$/.test(normalized)) {
    return config.QUESTION_TYPES.MULTIPLE;
  }
  // 多选题：A.内容B.内容（连续拼接无分隔符，如 "B.重大风险C.一般隐患"）
  if ((normalized.match(/[A-D][．.、\s]/gi) || []).length > 1) {
    return config.QUESTION_TYPES.MULTIPLE;
  }
  if (!/^[A-D]\.\s*/.test(normalized)) {
    return config.QUESTION_TYPES.SHORT;
  }
  return config.QUESTION_TYPES.SINGLE;
}

// 创建标准化题目对象
function createQuestion(question, answer, question_type, source) {
  return { question, answer, question_type, source: source || '职教考试' };
}

// ── 倒排索引 ──
function buildQuestionIndex(bank) {
  questionIndex.clear();
  for (const item of bank) {
    const keys = extractIndexKeys(item.question || '');
    for (const key of keys) {
      if (!questionIndex.has(key)) {
        questionIndex.set(key, []);
      }
      questionIndex.get(key).push(item);
    }
  }
}

function getIndexedCandidates(cleanedQuestion) {
  const unique = new Set();
  const exact = questionIndex.get(cleanedQuestion) || [];
  for (const item of exact) unique.add(item);

  const words = cleanedQuestion.match(/[\u4e00-\u9fa5]{2,}/g) || [];
  for (const word of words) {
    const list = questionIndex.get(word) || [];
    for (const item of list) unique.add(item);
  }
  return Array.from(unique);
}

// ── 去重检查（同时考虑问题+题型+来源） ──
function isQuestionExists(bank, newQuestion, newQuestionType, newSource) {
  const cleanedNew = cleanText(newQuestion);
  return bank.some(q => 
    cleanText(q.question) === cleanedNew && 
    q.question_type === newQuestionType &&
    (q.source || '职教考试') === (newSource || '职教考试')
  );
}

// ── 磁盘读写 ──
async function loadQuestionBankFromDisk() {
  try {
    const data = await fs.promises.readFile(config.questionBankFile, 'utf-8');
    try {
      const parsed = JSON.parse(data);
      inMemoryQuestionBank = Array.isArray(parsed) ? parsed : [];
    } catch (parseErr) {
      logger.error('题库文件JSON解析失败:', parseErr.message);
      inMemoryQuestionBank = [];
    }
  } catch (err) {
    if (err && err.code !== 'ENOENT') {
      logger.error('加载题库失败:', err.message);
    }
    inMemoryQuestionBank = [];
  }
  buildQuestionIndex(inMemoryQuestionBank);
  return inMemoryQuestionBank;
}

// 获取内存中的题库（返回引用，外部修改会影响原始数据）
function getQuestionBank() {
  return inMemoryQuestionBank;
}

/**
 * 保存题库（带写锁）。
 * 返回的 Promise 在写入完成后 resolve。
 */
function saveQuestionBank(bank) {
  return withWriteLock(async () => {
    await fs.promises.writeFile(
      config.questionBankFile,
      JSON.stringify(bank, null, 2),
      'utf-8'
    );
    inMemoryQuestionBank = bank;
    buildQuestionIndex(inMemoryQuestionBank);
  });
}

// ── 提取的题干 ──
async function saveExtractedQuestions(questions) {
  const cleanedQuestions = questions.map((q, i) => ({
    id: i + 1,
    question: cleanText(q.question),
    option_a: cleanText(q.option_a || ''),
    option_b: cleanText(q.option_b || ''),
    option_c: cleanText(q.option_c || ''),
    option_d: cleanText(q.option_d || ''),
  }));

  await fs.promises.writeFile(
    config.extractedQuestionsFile,
    JSON.stringify(cleanedQuestions, null, 2),
    'utf-8'
  );
  inMemoryExtractedQuestions = cleanedQuestions;
  return cleanedQuestions.length;
}

async function loadExtractedQuestionsFromDisk() {
  try {
    const data = await fs.promises.readFile(config.extractedQuestionsFile, 'utf-8');
    try {
      const parsed = JSON.parse(data);
      inMemoryExtractedQuestions = Array.isArray(parsed) ? parsed : [];
    } catch (parseErr) {
      logger.error('提取题干文件JSON解析失败:', parseErr.message);
      inMemoryExtractedQuestions = [];
    }
  } catch (err) {
    if (err && err.code !== 'ENOENT') {
      logger.error('加载提取题干失败:', err.message);
    }
    inMemoryExtractedQuestions = [];
  }
  return inMemoryExtractedQuestions;
}

// 获取内存中的提取题干
function getExtractedQuestions() {
  return inMemoryExtractedQuestions;
}

// ── 从 TXT 文件导入题目（格式：序号. 题干 正确答案：答案） ──
async function importFromTxt(txtPath, source) {
  let content = '';
  try {
    const raw = await fs.promises.readFile(txtPath);
    // 自动检测编码：先尝试 UTF-8，GBK 乱码则 fallback
    content = raw.toString('utf-8');
    // 检测是否包含中文乱码特征（GBK 编码被当作 UTF-8 解码）
    if (/[\uFFFD\uFFFE]/.test(content) || content.indexOf('�') >= 0) {
      const Iconv = require('iconv-lite');
      content = Iconv.decode(raw, 'gbk');
    }
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      logger.error(`文件不存在: ${txtPath}`);
      return [];
    }
    logger.error(`读取题库文件失败: ${txtPath}`, err.message);
    return [];
  }

  const lines = content.split('\n').filter(line => line.trim());
  const questions = [];

  for (const line of lines) {
    // 兼容半角冒号 正确答案: 和全角冒号 正确答案：
    let idx = line.indexOf('正确答案：');
    if (idx <= 0) {
      idx = line.indexOf('正确答案:');
      if (idx <= 0) continue;
    }

    let questionPart = line.substring(0, idx).trim();
    const questionMatch = questionPart.match(/^\d+\.\s*(.+)/);
    const question = questionMatch ? questionMatch[1] : questionPart;
    const answerPart = line.substring(idx + 5).trim();
    const questionType = detectQuestionType(answerPart);

    questions.push(createQuestion(question, answerPart, questionType, source));
  }
  return questions;
}

module.exports = {
  loadQuestionBankFromDisk,
  getQuestionBank,
  saveQuestionBank,
  saveExtractedQuestions,
  loadExtractedQuestionsFromDisk,
  getExtractedQuestions,
  isQuestionExists,
  detectQuestionType,
  createQuestion,
  getIndexedCandidates,
  importFromTxt,
};
