'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const iconv = require('iconv-lite');
const config = require('./config');
const logger = require('./logger');
const { rateLimitMiddleware } = require('./middleware');
const { extractQuestions } = require('./htmlParser');
const {
  getQuestionBank,
  saveQuestionBank,
  saveExtractedQuestions,
  getExtractedQuestions,
  loadQuestionBankFromDisk,
  isQuestionExists,
  detectQuestionType,
  createQuestion,
} = require('./questionBank');
const {
  getFuseThreshold,
  setFuseThreshold,
  findAnswerWithOption,
  parseAnswerLetters,
  invalidateFuse,
  answerCache,
} = require('./questionMatcher');
const { cleanText } = require('./textUtils');

const router = express.Router();

// ── 健康检查（生产环境隐藏内存详情） ──
router.get('/health', (_req, res) => {
  const questionCount = getQuestionBank().length;
  const uptime = process.uptime();
  
  logger.info(`Health check: 题库${questionCount}题, 运行${Math.floor(uptime)}秒`);
  
  const info = {
    status: 'ok',
    uptime: uptime,
    questionCount: questionCount,
    cacheSize: answerCache.size,
    timestamp: new Date().toISOString(),
  };
  if (!config.isProduction) {
    info.memory = process.memoryUsage();
  }
  res.json(info);
});

// ── 保存环境设置 ──
const ENV_FILE = path.join(__dirname, 'env.conf');
router.post('/save-env', (req, res) => {
  const { env } = req.body;
  if (env !== 'development' && env !== 'production') {
    return res.json({ success: false, error: '无效的环境值' });
  }
  try {
    fs.writeFileSync(ENV_FILE, env, 'utf-8');
    logger.info(`环境设置已保存: ${env}，请重启服务生效`);
    res.json({ success: true, message: `已保存为 ${env}，请重启服务` });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

router.get('/get-env', (_req, res) => {
  try {
    if (fs.existsSync(ENV_FILE)) {
      const env = fs.readFileSync(ENV_FILE, 'utf-8').trim();
      return res.json({ env });
    }
  } catch (_) {}
  res.json({ env: config.isProduction ? 'production' : 'development' });
});

// 限流应用到下方所有路由
router.use(rateLimitMiddleware);

// ── 读取 page 目录下的文件（自动检测编码） ──
router.get('/read-page-file', async (req, res) => {
  const filename = req.query?.file;
  if (!filename || !/^[1-3]\.txt$/.test(filename)) {
    return res.status(400).json({ error: '无效的文件名' });
  }

  const fs = require('fs');
  const path = require('path');
  const filePath = path.join(__dirname, 'page', filename);

  try {
    // 先读取Buffer，检测编码
    const buffer = fs.readFileSync(filePath);

    // 尝试检测GBK编码（检查是否包含GBK特征字节）
    let content;
    try {
      // 先尝试用UTF-8解码
      content = buffer.toString('utf-8');
      // 如果包含UTF-8 BOM或看起来是UTF-8，直接使用
      if (buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
        // UTF-8 BOM
      } else {
        // 检查是否包含GBK特征（高位字节）
        const hasHighBytes = buffer.some(b => b > 127);
        if (hasHighBytes) {
          // 尝试用iconv-lite转换GBK
          const iconv = require('iconv-lite');
          content = iconv.decode(buffer, 'gbk');
        }
      }
    } catch (e) {
      // 回退到GBK
      const iconv = require('iconv-lite');
      content = iconv.decode(buffer, 'gbk');
    }

    res.send(content);
  } catch (err) {
    res.status(500).json({ error: '读取文件失败: ' + err.message });
  }
});

// ── 解析 HTML 并匹配答案 ──
router.post('/parse-and-get-answer', async (req, res) => {
  try {
    let htmlContent = req.body?.htmlContent || req.body;

    // Buffer → string
    if (Buffer.isBuffer(htmlContent)) {
      htmlContent = htmlContent.toString('utf-8');
    }

    // 尝试解析 JSON 包装
    if (typeof htmlContent === 'string' && htmlContent.trim().startsWith('{')) {
      try {
        const obj = JSON.parse(htmlContent);
        htmlContent = obj.htmlContent || obj;
      } catch (_) {
        // 不是 JSON，保持原样
      }
    }

    // 类型校验
    if (!htmlContent || typeof htmlContent !== 'string') {
      return res.status(400).json({ error: '缺少或无效的 htmlContent 参数' });
    }

    // 长度校验（防 DoS）
    if (htmlContent.length > config.htmlMaxLength) {
      return res.status(413).json({
        error: `HTML 内容超过最大限制 (${Math.round(config.htmlMaxLength / 1024)}KB)`,
      });
    }

    // 确保题库已加载
    const questionBank = getQuestionBank();
    if (questionBank.length === 0) {
      await loadQuestionBankFromDisk();
    }
    const bank = getQuestionBank();

    // 提取题目
    const questionTexts = extractQuestions(htmlContent);
    if (!questionTexts) {
      return res.status(400).json({ error: '无法从HTML中提取题目' });
    }

    // 保存提取的题干
    const savedCount = await saveExtractedQuestions(questionTexts);
    logger.debug('提取:', questionTexts.length, '保存:', savedCount);

// 题型统计
      const typeStats = {
        '单选': 0,
        '多选': 0,
        '判断': 0,
        '简答': 0
      };

      // 匹配答案（questionTexts 一定是数组，extractQuestions 返回 array | null）
      const resultLines = [];
      for (let i = 0; i < questionTexts.length; i++) {
        const q = questionTexts[i];
        const options = {
          a: q.option_a || '',
          b: q.option_b || '',
          c: q.option_c || '',
          d: q.option_d || '',
        };

        const matched = findAnswerWithOption(q.question, bank);
        let answer = '';
        let questionTypeLabel = '';

        // 根据提取的选项判断题型（优先使用 parser 检测到的类型）
        const optionCount = [q.option_a, q.option_b, q.option_c, q.option_d].filter(o => o && o.trim()).length;
        const parserType = q.detected_type;
        const expectedType = parserType || (
          optionCount === 4 ? 'single' :
          optionCount === 2 ? 'judgment' :
          'short_answer'
        );

        if (matched) {
          // 如果题库中有多个相似题目，优先选择题型匹配的
          const candidates = bank.filter(b => cleanText(b.question) === cleanText(matched.normalized_question || matched.question));
          const typeMatched = candidates.find(c => c.question_type === expectedType);
          const finalMatch = typeMatched || matched;

          // 题型标签映射：优先用 parser 检测的类型，回退到题库的类型
          const typeMap = {
            'single': '单选',
            'multiple': '多选',
            'judgment': '判断',
            'short_answer': '简答'
          };
          const effectiveType = parserType || finalMatch.question_type;
          questionTypeLabel = typeMap[effectiveType] || '';

          // 判断题型：简答题直接返回原始答案，判断题返回对/错
          if (finalMatch.question_type === 'short_answer') {
            answer = finalMatch.answer || '';
          } else if (finalMatch.question_type === 'judgment') {
            // 判断题返回对或错
            const answerText = finalMatch.answer || '';
            if (answerText.includes('对') || answerText.includes('正确')) {
              answer = '对';
            } else if (answerText.includes('错') || answerText.includes('错误')) {
              answer = '错';
            } else {
              answer = answerText;
            }
          } else {
            const answers = parseAnswerLetters(finalMatch.answer, options);
            answer = answers.map(a => a.letter).join(',');
          }
        } else {
          logger.debug('未匹配题号:', i + 1, '题干:', q.question.substring(0, 80));
        }

        // 题型标签回退：从答案格式推断（当 parser 和题库都没提供类型时）
        if (!questionTypeLabel && answer) {
          if (answer === '对' || answer === '错') {
            questionTypeLabel = '判断';
          } else if (answer.includes(',')) {
            questionTypeLabel = '多选';
          } else if (/^[A-D]$/.test(answer)) {
            questionTypeLabel = '单选';
          } else {
            questionTypeLabel = '简答';
          }
        }

        // 补记题型统计（包括 fallback 推断的）
        typeStats[questionTypeLabel] = (typeStats[questionTypeLabel] || 0) + 1;

        resultLines.push(`${questionTypeLabel}-第${i + 1}题答案：${answer}`);
      }

      // 在最后一行返回题型统计
      const statsLine = `题型统计: 单选${typeStats['单选']}题, 多选${typeStats['多选']}题, 判断${typeStats['判断']}题, 简答${typeStats['简答']}题`;
      resultLines.push(statsLine);

      return res.send(resultLines.join('\n'));
  } catch (err) {
    logger.error('解析并匹配答案失败:', err.message);
    res.status(500).json({ error: '服务器处理失败' });
  }
});

// ── 获取题库 ──
router.get('/question-bank', (_req, res) => {
  res.json({ questions: getQuestionBank() });
});

// ── 题库搜索 ──
router.get('/question-bank/search', (req, res) => {
  try {
    const { q } = req.query;
    if (!q || typeof q !== 'string') {
      return res.json({ success: true, questions: [] });
    }
    
    const bank = getQuestionBank();
    const keyword = cleanText(q);
    const results = [];
    
    // 遍历题库进行模糊匹配
    for (const item of bank) {
      const cleanedQ = cleanText(item.question);
      // 匹配条件：清洗后的题干包含关键词，或原始题干包含关键词
      if (cleanedQ.includes(keyword) || item.question.includes(q)) {
        results.push({
          question: item.question,
          answer: item.answer,
          question_type: item.question_type,
          source: item.source || '职教考试'
        });
      }
      // 限制返回数量，防止响应过大
      if (results.length >= 50) break;
    }
    
    res.json({ success: true, questions: results, total: results.length });
  } catch (err) {
    logger.error('题库搜索失败:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── 匹配配置 ──
router.get('/matching-config', (_req, res) => {
  res.json({ threshold: getFuseThreshold() });
});

router.post('/matching-config', (req, res) => {
  const result = setFuseThreshold(req.body?.threshold);
  if (result === null) {
    return res.status(400).json({ error: 'threshold 必须是 0 到 1 的数字' });
  }
  logger.info(`匹配相似度已更新为: ${result.toFixed(2)}`);
  res.json({ success: true, threshold: result });
});

// ── 新增单条题目 ──
router.post('/question-bank', async (req, res) => {
  try {
    const { question, answer, question_type } = req.body;
    if (!question || !answer) {
      return res.status(400).json({ error: '缺少参数' });
    }
    const bank = [...getQuestionBank()];
    bank.push(createQuestion(question, answer, question_type || 'single'));
    await saveQuestionBank(bank);
    invalidateFuse();
    res.json({ success: true });
  } catch (err) {
    logger.error('新增题目失败:', err.message);
    res.status(500).json({ error: '保存题库失败' });
  }
});

// ── 批量导入题库（从转换结果文本） ──
router.post('/question-bank/import', async (req, res) => {
  try {
    const { content, source } = req.body;
    if (!content || typeof content !== 'string') {
      return res.status(400).json({ error: '缺少内容' });
    }

    logger.info('========== 题库导入开始 ==========');

    const lines = content.split('\n').filter(line => line.trim());
    const bank = [...getQuestionBank()];
    let addedCount = 0;
    let duplicateCount = 0;
    let errorCount = 0;
    // 按来源统计
    const bySource = {};

    for (const line of lines) {
      const idx = line.indexOf('正确答案：');
      if (idx <= 0) {
        errorCount++;
        continue;
      }

      const questionPart = line.substring(0, idx).trim();
      const questionMatch = questionPart.match(/^\d+\.\s*(.+)/);
      const question = questionMatch ? questionMatch[1] : questionPart;
      const answerPart = line.substring(idx + 5).trim();

      // 先检测题型，再检查重复（同时考虑问题+题型+来源）
      const questionType = detectQuestionType(answerPart);
      if (isQuestionExists(bank, question, questionType, source)) {
        duplicateCount++;
        logger.debug(`[跳过重复] ${question.substring(0, 50)}...`);
        continue;
      }

      bank.push(createQuestion(question, answerPart, questionType, source));
      addedCount++;
      // 按来源统计
      const src = source || '职教考试';
      bySource[src] = (bySource[src] || 0) + 1;
    }

    await saveQuestionBank(bank);
    invalidateFuse();
    logger.info(`========== 导入完成: 新增 ${addedCount}, 重复 ${duplicateCount}, 错误 ${errorCount}, 共 ${bank.length} ==========`);

    res.json({
      success: true,
      added: addedCount,
      duplicate: duplicateCount,
      error: errorCount,
      total: bank.length,
      bySource,
    });
  } catch (err) {
    logger.error('批量导入题库失败:', err.message);
    res.status(500).json({ error: '导入题库失败' });
  }
});

// ── 直接导入题库文件 ──
router.post('/question-bank/import-file', async (req, res) => {
  try {
    let content = '';
    const { source } = req.body;

    if (req.body.fileContent) {
      content = req.body.fileContent;
    } else if (req.body.fileContentBase64) {
      const buffer = Buffer.from(req.body.fileContentBase64, 'base64');
      const isGbk = /[\x81-\xFE]/.test(buffer.toString('binary'));
      content = isGbk ? iconv.decode(buffer, 'gbk') : buffer.toString('utf-8');
    } else {
      return res.status(400).json({ error: '缺少文件内容' });
    }

    logger.info('========== 直接导入题库文件 ==========');

    const lines = content.split('\n').filter(line => line.trim());
    const bank = [...getQuestionBank()];
    let addedCount = 0;
    let duplicateCount = 0;
    let errorCount = 0;
    let validLines = 0;

    for (const line of lines) {
      const idx = line.indexOf('正确答案：');
      if (idx <= 0) {
        errorCount++;
        continue;
      }

      validLines++;

      const questionPart = line.substring(0, idx).trim();
      const questionMatch = questionPart.match(/^\d+\.\s*(.+)/);
      const question = questionMatch ? questionMatch[1] : questionPart;
      const answerPart = line.substring(idx + 5).trim();

      // 先检测题型，再检查重复（同时考虑问题+题型+来源）
      const questionType = detectQuestionType(answerPart);
      if (isQuestionExists(bank, question, questionType, source)) {
        duplicateCount++;
        continue;
      }

      bank.push(createQuestion(question, answerPart, questionType, source));
      addedCount++;
    }

    await saveQuestionBank(bank);
    invalidateFuse();
    logger.info(`========== 直接导入完成: 新增 ${addedCount}, 重复 ${duplicateCount}, 错误 ${errorCount}, 有效行 ${validLines}, 共 ${bank.length} ==========`);

    res.json({
      success: true,
      added: addedCount,
      duplicate: duplicateCount,
      error: errorCount,
      validLines,
      total: bank.length,
    });
  } catch (err) {
    logger.error('直接导入题库文件失败:', err.message);
    res.status(500).json({ error: '导入失败: ' + err.message });
  }
});

// ── 获取提取的题干 ──
router.get('/extracted-questions', (_req, res) => {
  res.json({ questions: getExtractedQuestions() });
});

// ==================== 自动考试系统 API ====================

const examOrchestrator = require('./examOrchestrator');
const monitor = require('./monitor');
const reportGenerator = require('./reportGenerator');

// ── 启动考试 ──
router.post('/start-exam', async (req, res) => {
  try {
    const {
      examUrl,
      mode = 'manual',
      timeLimit,
      minConfidence,
      autoSubmit = false,
      domConfigName
    } = req.body;

    if (!examUrl) {
      return res.status(400).json({ error: 'examUrl is required' });
    }

    logger.info(`[API] Starting exam: mode=${mode}, url=${examUrl}`);

    const result = await examOrchestrator.startExam({
      examUrl,
      mode,
      timeLimit,
      minConfidence,
      autoSubmit,
      domConfigName
    });

    res.json(result);
  } catch (error) {
    logger.error('[API] Start exam failed:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ── 查询考试状态 ──
router.get('/exam-status/:sessionId', (req, res) => {
  const status = examOrchestrator.getSessionStatus(req.params.sessionId);

  if (!status) {
    return res.status(404).json({ error: 'Session not found' });
  }

  res.json(status);
});

// ── 暂停考试 ──
router.post('/pause-exam/:sessionId', (req, res) => {
  try {
    examOrchestrator.pauseExam(req.params.sessionId);
    res.json({ success: true, message: 'Exam paused' });
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
});

// ── 恢复考试 ──
router.post('/resume-exam/:sessionId', (req, res) => {
  try {
    examOrchestrator.resumeExam(req.params.sessionId);
    res.json({ success: true, message: 'Exam resumed' });
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
});

// ── 终止考试 ──
router.post('/abort-exam/:sessionId', async (req, res) => {
  try {
    await examOrchestrator.abortExam(req.params.sessionId);
    res.json({ success: true, message: 'Exam aborted' });
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
});

// ── 生成考试报告 ──
router.get('/exam-report/:sessionId', async (req, res) => {
  // 注意: 需要会话已完成才能生成报告
  const session = examOrchestrator.sessions.get(req.params.sessionId);

  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  if (session.status !== 'completed' && session.status !== 'aborted') {
    return res.status(400).json({ error: 'Exam not finished yet' });
  }

  const report = await reportGenerator.generateFullReport(session);
  res.json(report);
});

// ── 导入DOM选择器配置 ──
router.post('/import-dom-config', async (req, res) => {
  try {
    const { configName, config } = req.body;

    if (!configName || !config) {
      return res.status(400).json({ error: 'configName and config are required' });
    }

    const fs = require('fs').promises;
    const path = require('path');
    const configPath = path.join(__dirname, 'domConfigs', `${configName}.json`);

    await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');

    logger.info(`[API] DOM config imported: ${configName}`);
    res.json({ success: true, message: `DOM config saved to ${configName}.json` });
  } catch (error) {
    logger.error('[API] Import DOM config failed:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ==================== 监控系统 API ====================

// ── 获取所有活跃监控会话 ──
router.get('/monitor/active-sessions', (req, res) => {
  const sessions = monitor.getActiveSessions();
  res.json({ sessions });
});

// ── 获取监控会话详情 ──
router.get('/monitor/session/:sessionId', (req, res) => {
  const session = monitor.getSession(req.params.sessionId);

  if (!session) {
    return res.status(404).json({ error: 'Monitor session not found' });
  }

  const report = session.getFullReport();
  res.json(report);
});

// ── 紧急停止考试 ──
router.post('/monitor/emergency-stop/:sessionId', (req, res) => {
  try {
    const { reason } = req.body || {};
    monitor.emergencyStop(req.params.sessionId, reason || 'manual');

    // 同时终止考试编排器中的会话
    examOrchestrator.pauseExam(req.params.sessionId);

    res.json({ success: true, message: 'Emergency stop activated' });
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
});

// ── 清除紧急停止 ──
router.post('/monitor/clear-stop/:sessionId', (req, res) => {
  try {
    monitor.clearEmergencyStop(req.params.sessionId);
    res.json({ success: true, message: 'Emergency stop cleared' });
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
});

// ==================== 报告生成 API ====================

// ── 生成所有格式报告 ──
router.post('/reports/generate/:sessionId', async (req, res) => {
  try {
    const { format = 'all' } = req.body;
    const session = examOrchestrator.sessions.get(req.params.sessionId);

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    if (session.status !== 'completed' && session.status !== 'aborted') {
      return res.status(400).json({ error: 'Exam not finished yet' });
    }

    let paths;
    if (format === 'all') {
      paths = await reportGenerator.saveAllFormats(session);
    } else if (format === 'json') {
      paths = { json: await reportGenerator.saveJsonReport(session) };
    } else if (format === 'csv') {
      paths = { csv: await reportGenerator.saveCsvReport(session) };
    } else if (format === 'html') {
      paths = { html: await reportGenerator.saveHtmlReport(session) };
    } else {
      return res.status(400).json({ error: 'Invalid format. Use: json, csv, html, or all' });
    }

    res.json({
      success: true,
      sessionId: req.params.sessionId,
      files: paths
    });
  } catch (error) {
    logger.error('[API] Generate report failed:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ── 获取报告列表 ──
router.get('/reports', async (req, res) => {
  try {
    const reports = await reportGenerator.getReportList();
    res.json({ reports });
  } catch (error) {
    logger.error('[API] Get report list failed:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ── 获取报告详情 ──
router.get('/reports/:sessionId', async (req, res) => {
  try {
    const session = examOrchestrator.sessions.get(req.params.sessionId);

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const report = await reportGenerator.generateFullReport(session);
    res.json(report);
  } catch (error) {
    logger.error('[API] Get report failed:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ── 下载报告文件 ──
router.get('/reports/:sessionId/:format', async (req, res) => {
  try {
    const { sessionId, format } = req.params;
    const fs = require('fs');
    const path = require('path');
    const reportsDir = path.join(__dirname, 'exam_reports');

    if (!['json', 'csv', 'html'].includes(format)) {
      return res.status(400).json({ error: 'Invalid format' });
    }

    const filePath = path.join(reportsDir, `${sessionId}.${format}`);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Report file not found' });
    }

    const contentType = {
      json: 'application/json',
      csv: 'text/csv',
      html: 'text/html'
    }[format];

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${sessionId}.${format}"`);

    res.sendFile(filePath);
  } catch (error) {
    logger.error('[API] Download report failed:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ── 删除报告 ──
router.delete('/reports/:sessionId', async (req, res) => {
  try {
    const deleted = await reportGenerator.deleteReport(req.params.sessionId);
    res.json({ success: true, deleted });
  } catch (error) {
    logger.error('[API] Delete report failed:', error.message);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
