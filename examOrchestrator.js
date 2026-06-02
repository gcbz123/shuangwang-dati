/**
 * 考试编排器
 * 管理考试会话、流程控制和异常处理
 */

const { v4: uuidv4 } = require('uuid');
const config = require('./config');
const logger = require('./logger');
const { extractQuestions } = require('./htmlParser');
const { findAnswerWithOption, parseAnswerLetters } = require('./questionMatcher');
const questionBank = require('./questionBank');
const PuppeteerDriver = require('./drivers/puppeteerDriver');
const OilMonkeyDriver = require('./drivers/oilMonkeyDriver');
const AnswerStrategy = require('./strategyEngine');
const monitor = require('./monitor');
const reportGenerator = require('./reportGenerator');
const fs = require('fs').promises;
const path = require('path');

/**
 * 考试会话类
 */
class ExamSession {
  constructor(params) {
    this.sessionId = uuidv4();
    this.examUrl = params.examUrl;
    this.mode = params.mode || 'manual'; // 'auto' | 'manual'
    this.startTime = Date.now();
    this.timeLimit = params.timeLimit || config.examConfig.defaultTimeLimit;
    this.questions = [];
    this.answers = [];
    this.currentIndex = 0;
    this.status = 'pending'; // pending | running | paused | completed | aborted
    this.driver = null;
    this.strategy = new AnswerStrategy(params.strategy || config.examConfig.defaultStrategy);
    this.autoSubmit = params.autoSubmit || false;
    this.endTime = null;
    this.errorLog = [];
  }

  /**
   * 添加错误日志
   */
  logError(error, context = {}) {
    this.errorLog.push({
      timestamp: Date.now(),
      error: error.message || String(error),
      stack: error.stack,
      context
    });
  }
}

/**
 * 考试编排器主类
 */
class ExamOrchestrator {
  constructor() {
    this.sessions = new Map(); // sessionId → ExamSession
    this.maxConcurrentSessions = config.examConfig.maxConcurrentSessions;
  }

  /**
   * 启动考试
   * @param {Object} params - 考试参数
   * @returns {Object} { sessionId, status }
   */
  async startExam(params) {
    const {
      examUrl,
      mode = 'manual',
      timeLimit,
      minConfidence,
      autoSubmit = false,
      domConfigName
    } = params;

    if (!examUrl) {
      throw new Error('examUrl is required');
    }

    // 检查并发限制
    const activeSessions = Array.from(this.sessions.values()).filter(
      s => s.status === 'running'
    ).length;

    if (activeSessions >= this.maxConcurrentSessions) {
      throw new Error(`Maximum concurrent sessions (${this.maxConcurrentSessions}) reached`);
    }

    // 创建会话
    const session = new ExamSession({
      examUrl,
      mode,
      timeLimit,
      autoSubmit,
      strategy: {
        ...config.examConfig.defaultStrategy,
        minConfidence: minConfidence || config.examConfig.defaultStrategy.minConfidence
      }
    });

    // 加载DOM配置
    if (domConfigName) {
      session.domConfig = await this.loadDomConfig(domConfigName);
    }

    this.sessions.set(session.sessionId, session);

    // 创建监控会话
    monitor.createSession(session.sessionId, examUrl);
    monitor.log(session.sessionId, 'session_created', {
      mode,
      timeLimit,
      autoSubmit
    });

    logger.info(`[ExamOrchestrator] Session ${session.sessionId} created, mode: ${mode}`);

    // 异步执行考试流程
    this.executeExam(session).catch(err => {
      logger.error(`[ExamOrchestrator] Session ${session.sessionId} failed:`, err.message);
      session.status = 'aborted';
      session.logError(err, { phase: 'execution' });
    });

    return {
      sessionId: session.sessionId,
      status: 'started'
    };
  }

  /**
   * 执行考试主流程
   */
  async executeExam(session) {
    const driver = await this.createDriver(session);
    session.driver = driver;

    try {
      session.status = 'running';
      monitor.log(session.sessionId, 'exam_started', {});
      logger.info(`[ExamOrchestrator] Session ${session.sessionId} started`);

      // 检查紧急停止标志
      if (monitor.shouldStop(session.sessionId)) {
        throw new Error('Emergency stop activated');
      }

      // 1. 导航到考试页面
      await driver.navigate(session.examUrl);
      monitor.log(session.sessionId, 'navigated', { url: session.examUrl });
      logger.info(`[ExamOrchestrator] Navigated to exam page`);

      // 2. 循环处理每道题
      let consecutiveFailures = 0;
      const maxFailures = 3;

      while (true) {
        // 检查紧急停止标志
        if (monitor.shouldStop(session.sessionId)) {
          monitor.log(session.sessionId, 'emergency_stop', { reason: 'manual' });
          throw new Error('Emergency stop activated');
        }

        // 检查超时
        if (Date.now() - session.startTime > session.timeLimit) {
          monitor.log(session.sessionId, 'timeout', { elapsed: Date.now() - session.startTime });
          logger.warn(`[ExamOrchestrator] Time limit exceeded for session ${session.sessionId}`);
          break;
        }

        // 检查是否暂停
        if (session.status === 'paused') {
          monitor.log(session.sessionId, 'paused', {});
          await this.waitForResume(session);
          continue;
        }

        try {
          // 检查是否还有题目
          const hasQuestion = await this.checkHasQuestion(driver, session);
          if (!hasQuestion) {
            logger.info(`[ExamOrchestrator] No more questions`);
            break;
          }

          // 提取题目
          const html = await driver.getPageSource();
          const questions = extractQuestions(html);

          if (!questions || questions.length === 0) {
            logger.warn(`[ExamOrchestrator] No questions extracted from HTML`);
            consecutiveFailures++;
            if (consecutiveFailures >= maxFailures) {
              logger.error('[ExamOrchestrator] Too many consecutive failures, aborting');
              break;
            }
            await this.sleep(2000);
            continue;
          }

          const currentQuestion = questions[0];
          session.questions.push(currentQuestion);
          consecutiveFailures = 0; // 重置失败计数

          monitor.log(session.sessionId, 'question_extracted', {
            index: session.currentIndex + 1,
            question: currentQuestion.question.substring(0, 100)
          });

          logger.info(`[ExamOrchestrator] Processing question ${session.currentIndex + 1}: ${currentQuestion.question.substring(0, 50)}...`);

          // 匹配答案
          const bank = await questionBank.getQuestionBank();
          const answer = findAnswerWithOption(currentQuestion.question, bank);

          // 策略判断: 是否作答
          const confidence = answer ? (1 - (answer.score || 1)) : 0;
          const shouldAnswer = session.strategy.shouldAnswer(answer);

          if (shouldAnswer && answer) {
            await this.answerQuestion(driver, currentQuestion, answer, session);
            session.answers.push({
              questionIndex: session.currentIndex,
              question: currentQuestion.question,
              answer: answer.answer,
              answerText: answer.question,
              confidence: confidence,
              score: answer.score,
              timestamp: Date.now(),
              skipped: false
            });

            monitor.log(session.sessionId, 'answer', {
              index: session.currentIndex,
              answer: answer.answer,
              confidence,
              skipped: false
            });

            monitor.updateMetrics(session.sessionId, {
              current: session.currentIndex + 1,
              answer: { confidence, skipped: false, timestamp: Date.now() }
            });

            logger.info(`[ExamOrchestrator] Answered with confidence ${confidence.toFixed(2)}`);
          } else {
            logger.warn(`[ExamOrchestrator] Skipped (confidence: ${confidence.toFixed(2)})`);
            session.answers.push({
              questionIndex: session.currentIndex,
              question: currentQuestion.question,
              answer: null,
              confidence: confidence,
              timestamp: Date.now(),
              skipped: true,
              reason: 'low_confidence'
            });

            monitor.log(session.sessionId, 'skip', {
              index: session.currentIndex,
              confidence,
              reason: 'low_confidence'
            });

            monitor.updateMetrics(session.sessionId, {
              current: session.currentIndex + 1,
              answer: { confidence, skipped: true, timestamp: Date.now() }
            });
          }

          // 随机延迟(模拟人类行为)
          const delay = session.strategy.calculateDelay(currentQuestion.question.length);
          await this.sleep(delay);

          // 点击下一题
          const hasNext = await this.goToNextQuestion(driver, session);
          if (!hasNext) {
            monitor.log(session.sessionId, 'next_button_not_found', { index: session.currentIndex });
            logger.info('[ExamOrchestrator] No next button found, exam may be complete');
            break;
          }

          monitor.log(session.sessionId, 'next_question', { index: session.currentIndex + 1 });

          session.currentIndex++;

        } catch (error) {
          logger.error('[ExamOrchestrator] Error processing question:', error.message);
          session.logError(error, {
            phase: 'process_question',
            questionIndex: session.currentIndex
          });

          monitor.log(session.sessionId, 'error', {
            phase: 'process_question',
            questionIndex: session.currentIndex,
            error: error.message
          });

          monitor.updateMetrics(session.sessionId, { error: error.message });

          consecutiveFailures++;
          if (consecutiveFailures >= maxFailures) {
            logger.error('[ExamOrchestrator] Too many consecutive failures, aborting');
            break;
          }

          // 异常后等待更长时间
          await this.sleep(5000);
        }
      }

      // 3. 自动提交(如果启用)
      if (session.autoSubmit) {
        await this.submitExam(driver, session);
      }

      session.status = 'completed';
      session.endTime = Date.now();
      monitor.stopSession(session.sessionId);
      monitor.log(session.sessionId, 'exam_completed', {
        duration: session.endTime - session.startTime
      });

      // 4. 生成报告
      const report = this.generateReport(session);
      logger.info(`[ExamOrchestrator] Session ${session.sessionId} completed`, JSON.stringify(report.summary));

      // 5. 保存报告(使用报告生成器)
      await reportGenerator.saveAllFormats(session);

    } catch (error) {
      session.status = 'aborted';
      session.endTime = Date.now();
      session.logError(error, { phase: 'execution' });

      logger.error(`[ExamOrchestrator] Session ${session.sessionId} aborted:`, error.message);

      // 异常截图
      try {
        if (session.driver && session.driver.isConnected()) {
          const screenshot = await session.driver.screenshot();
          const screenshotPath = path.join(__dirname, 'logs', `error_${session.sessionId}.png`);
          await fs.writeFile(screenshotPath, screenshot);
          logger.info(`[ExamOrchestrator] Error screenshot saved to ${screenshotPath}`);
        }
      } catch (e) {
        logger.error('[ExamOrchestrator] Failed to save error screenshot:', e.message);
      }

      throw error;
    } finally {
      // 清理资源
      if (session.driver) {
        await session.driver.close();
      }
    }
  }

  /**
   * 创建浏览器驱动
   */
  async createDriver(session) {
    if (session.mode === 'auto') {
      const driver = new PuppeteerDriver();
      return driver;
    } else {
      // 手动模式使用油猴脚本驱动
      const driver = new OilMonkeyDriver(session.sessionId);
      // 注意: 油猴脚本需要前端主动连接WebSocket
      // 这里只是占位，实际由前端控制
      return driver;
    }
  }

  /**
   * 检查是否还有题目
   */
  async checkHasQuestion(driver, session) {
    // 默认实现: 总是继续，直到没有下一题按钮
    return true;
  }

  /**
   * 回答当前题目
   */
  async answerQuestion(driver, question, answer, session) {
    if (!answer || !answer.answer) {
      logger.warn('[ExamOrchestrator] No answer to fill');
      return;
    }

    const answerResults = parseAnswerLetters(answer.answer, {
      option_a: question.option_a,
      option_b: question.option_b,
      option_c: question.option_c,
      option_d: question.option_d
    });

    if (!answerResults || answerResults.length === 0) {
      logger.warn('[ExamOrchestrator] Failed to parse answer letters');
      return;
    }

    logger.debug(`[ExamOrchestrator] Answer results: ${JSON.stringify(answerResults)}`);

    // 获取DOM配置
    const domConfig = session.domConfig || await this.getDefaultDomConfig();
    const optionSelector = domConfig.optionLabels || 'label.ant-radio-wrapper, label.ant-checkbox-wrapper';

    // 简答题: 直接填写文本（letter 为空）
    if (answerResults[0].letter === '' && answerResults[0].answer) {
      const textarea = domConfig.textarea || 'textarea, input[type="text"]';
      await driver.fillInput(textarea, answerResults[0].answer);
      logger.debug('[ExamOrchestrator] Filled textarea with answer text');
      return;
    }

    // 单选题/判断题: 单个选项
    if (answerResults.length === 1) {
      const letter = answerResults[0].letter;
      const selector = `${optionSelector}:nth-child(${this.letterToIndex(letter)})`;
      await driver.click(selector);
      logger.debug(`[ExamOrchestrator] Clicked option ${letter}`);
    }
    // 多选题: 多个选项
    else {
      for (const item of answerResults) {
        const selector = `${optionSelector}:nth-child(${this.letterToIndex(item.letter)})`;
        await driver.click(selector);
        await this.sleep(200); // 多选间隔
      }
      const letters = answerResults.map(a => a.letter).join(',');
      logger.debug(`[ExamOrchestrator] Clicked multiple options: ${letters}`);
    }
  }

  /**
   * 字母转索引 (A->1, B->2, ...)
   */
  letterToIndex(letter) {
    return letter.charCodeAt(0) - 'A'.charCodeAt(0) + 1;
  }

  /**
   * 智能识别并点击"下一题"按钮
   */
  async goToNextQuestion(driver, session) {
    const domConfig = session.domConfig || await this.getDefaultDomConfig();
    const selectors = domConfig.nextButton || [
      '.ant-btn-primary',
      'button:contains("下一题")',
      'button:contains("Next")',
      '[data-action="next"]',
      '.next-button',
      '.btn-next'
    ];

    const nextButtonSelector = await driver.detectNextButton(selectors);
    if (nextButtonSelector) {
      await driver.click(nextButtonSelector);
      logger.debug(`[ExamOrchestrator] Clicked next button: ${nextButtonSelector}`);

      // 等待新题目加载
      await this.sleep(1000);
      return true;
    }

    return false;
  }

  /**
   * 提交考试
   */
  async submitExam(driver, session) {
    try {
      const domConfig = session.domConfig || await this.getDefaultDomConfig();
      const submitSelector = domConfig.submitButton || 'button:contains("提交"), .submit-button';

      const submitButton = await driver.detectNextButton([submitSelector]);
      if (submitButton) {
        await driver.click(submitButton);
        logger.info('[ExamOrchestrator] Exam submitted');
      } else {
        logger.warn('[ExamOrchestrator] Submit button not found');
      }
    } catch (error) {
      logger.error('[ExamOrchestrator] Submit failed:', error.message);
    }
  }

  /**
   * 等待恢复(暂停状态)
   */
  async waitForResume(session) {
    return new Promise(resolve => {
      const checkInterval = setInterval(() => {
        if (session.status !== 'paused') {
          clearInterval(checkInterval);
          resolve();
        }
      }, 1000);
    });
  }

  /**
   * 暂停考试
   */
  pauseExam(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    if (session.status === 'running') {
      session.status = 'paused';
      monitor.log(sessionId, 'paused', { method: 'api' });
      logger.info(`[ExamOrchestrator] Session ${sessionId} paused`);
    }
  }

  /**
   * 恢复考试
   */
  resumeExam(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    if (session.status === 'paused') {
      session.status = 'running';
      monitor.log(sessionId, 'resumed', { method: 'api' });
      logger.info(`[ExamOrchestrator] Session ${sessionId} resumed`);
    }
  }

  /**
   * 终止考试
   */
  async abortExam(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    session.status = 'aborted';
    session.endTime = Date.now();

    monitor.stopSession(sessionId);
    monitor.log(sessionId, 'aborted', { method: 'api' });

    if (session.driver) {
      await session.driver.close();
    }

    logger.info(`[ExamOrchestrator] Session ${sessionId} aborted`);
  }

  /**
   * 生成考试报告
   */
  generateReport(session) {
    const totalQuestions = session.answers.length;
    const answeredQuestions = session.answers.filter(a => !a.skipped).length;
    const skippedQuestions = session.answers.filter(a => a.skipped).length;
    const avgConfidence = answeredQuestions > 0
      ? session.answers.filter(a => !a.skipped).reduce((sum, a) => sum + (a.confidence || 0), 0) / answeredQuestions
      : 0;

    const duration = session.endTime ? session.endTime - session.startTime : Date.now() - session.startTime;

    return {
      sessionId: session.sessionId,
      examUrl: session.examUrl,
      mode: session.mode,
      startTime: new Date(session.startTime).toISOString(),
      endTime: session.endTime ? new Date(session.endTime).toISOString() : null,
      duration: duration,
      durationFormatted: this.formatDuration(duration),
      summary: {
        totalQuestions,
        answeredQuestions,
        skippedQuestions,
        avgConfidence: (avgConfidence * 100).toFixed(2) + '%'
      },
      answers: session.answers.map(a => ({
        questionIndex: a.questionIndex + 1,
        question: a.question.substring(0, 100),
        answer: a.answer,
        confidence: (a.confidence * 100).toFixed(2) + '%',
        skipped: a.skipped,
        timestamp: new Date(a.timestamp).toISOString()
      })),
      errors: session.errorLog.map(e => ({
        timestamp: new Date(e.timestamp).toISOString(),
        error: e.error,
        context: e.context
      }))
    };
  }

  /**
   * 格式化时长
   */
  formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  /**
   * 保存报告到文件
   */
  async saveReport(session, report) {
    try {
      const reportDir = path.join(__dirname, 'exam_reports');
      await fs.mkdir(reportDir, { recursive: true });

      const reportFile = path.join(reportDir, `${session.sessionId}.json`);
      await fs.writeFile(reportFile, JSON.stringify(report, null, 2), 'utf-8');

      logger.info(`[ExamOrchestrator] Report saved to ${reportFile}`);
    } catch (error) {
      logger.error('[ExamOrchestrator] Failed to save report:', error.message);
    }
  }

  /**
   * 加载DOM配置
   */
  async loadDomConfig(configName) {
    try {
      const configPath = path.join(__dirname, 'domConfigs', `${configName}.json`);
      const content = await fs.readFile(configPath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      logger.warn(`[ExamOrchestrator] DOM config ${configName} not found, using default`);
      return await this.getDefaultDomConfig();
    }
  }

  /**
   * 获取默认DOM配置
   */
  async getDefaultDomConfig() {
    return {
      nextButton: [
        '.ant-btn-primary',
        'button:contains("下一题")',
        'button:contains("Next")',
        '[data-action="next"]',
        '.next-button'
      ],
      optionLabels: 'label.ant-radio-wrapper, label.ant-checkbox-wrapper',
      textarea: 'textarea, input[type="text"]',
      submitButton: 'button:contains("提交"), .submit-button'
    };
  }

  /**
   * 工具函数: 睡眠
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 获取会话状态
   */
  getSessionStatus(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }

    return {
      sessionId: session.sessionId,
      status: session.status,
      progress: {
        current: session.currentIndex + 1,
        total: session.questions.length
      },
      answers: session.answers.length,
      duration: Date.now() - session.startTime
    };
  }
}

// 单例导出
module.exports = new ExamOrchestrator();
