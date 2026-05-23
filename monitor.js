/**
 * 监控系统
 * 实时追踪考试进度、记录置信度、检测异常情况
 * 支持WebSocket实时推送和紧急停止功能
 */

const WebSocket = require('ws');
const logger = require('./logger');

/**
 * 监测指标
 */
class ExamMetrics {
  constructor() {
    this.questionIndex = 0;
    this.totalQuestions = 0;
    this.answeredCount = 0;
    this.skippedCount = 0;
    this.confidenceHistory = [];
    this.timingHistory = [];
    this.errorCount = 0;
    this.lastUpdate = Date.now();
  }

  /**
   * 记录答题指标
   */
  recordAnswer(answer) {
    if (answer.skipped) {
      this.skippedCount++;
    } else {
      this.answeredCount++;
      if (answer.confidence !== undefined) {
        this.confidenceHistory.push(answer.confidence);
      }
    }

    if (answer.timestamp) {
      this.timingHistory.push(answer.timestamp);
    }

    this.lastUpdate = Date.now();
  }

  /**
   * 记录错误
   */
  recordError(error) {
    this.errorCount++;
    this.lastUpdate = Date.now();
  }

  /**
   * 计算平均置信度
   */
  getAverageConfidence() {
    if (this.confidenceHistory.length === 0) return 0;
    const sum = this.confidenceHistory.reduce((a, b) => a + b, 0);
    return sum / this.confidenceHistory.length;
  }

  /**
   * 获取最小置信度
   */
  getMinConfidence() {
    if (this.confidenceHistory.length === 0) return 0;
    return Math.min(...this.confidenceHistory);
  }

  /**
   * 计算答题速度(题/分钟)
   */
  getAnsweringRate() {
    if (this.timingHistory.length < 2) return 0;
    const duration = this.timingHistory[this.timingHistory.length - 1] - this.timingHistory[0];
    if (duration <= 0) return 0;
    return (this.answeredCount / duration) * 60000;
  }

  /**
   * 检测异常情况
   */
  detectAbnormalities() {
    const abnormalities = [];

    // 低置信度题目过多
    const lowConfidenceCount = this.confidenceHistory.filter(c => c < 0.7).length;
    const lowConfidenceRatio = this.confidenceHistory.length > 0
      ? lowConfidenceCount / this.confidenceHistory.length
      : 0;

    if (lowConfidenceRatio > 0.3) {
      abnormalities.push({
        type: 'low_confidence',
        severity: 'warning',
        message: `低置信度题目占比过高: ${(lowConfidenceRatio * 100).toFixed(1)}%`,
        threshold: 0.3,
        actual: lowConfidenceRatio
      });
    }

    // 错误过多
    if (this.errorCount > 3) {
      abnormalities.push({
        type: 'high_error_rate',
        severity: 'error',
        message: `错误次数过多: ${this.errorCount}次`,
        threshold: 3,
        actual: this.errorCount
      });
    }

    // 答题速度异常
    const rate = this.getAnsweringRate();
    if (rate > 60) { // 超过60题/分钟
      abnormalities.push({
        type: 'high_speed',
        severity: 'warning',
        message: `答题速度过快: ${rate.toFixed(1)}题/分钟`,
        threshold: 60,
        actual: rate
      });
    }

    return abnormalities;
  }

  /**
   * 获取指标摘要
   */
  getSummary() {
    return {
      progress: {
        current: this.questionIndex,
        total: this.totalQuestions,
        percentage: this.totalQuestions > 0 ? (this.questionIndex / this.totalQuestions * 100).toFixed(1) + '%' : '0%'
      },
      answers: {
        answered: this.answeredCount,
        skipped: this.skippedCount,
        total: this.answeredCount + this.skippedCount
      },
      confidence: {
        average: (this.getAverageConfidence() * 100).toFixed(1) + '%',
        minimum: (this.getMinConfidence() * 100).toFixed(1) + '%',
        trend: this.getConfidenceTrend()
      },
      performance: {
        rate: this.getAnsweringRate().toFixed(1) + ' 题/分钟',
        errors: this.errorCount,
        lastUpdate: new Date(this.lastUpdate).toISOString()
      },
      abnormalities: this.detectAbnormalities()
    };
  }

  /**
   * 计算置信度趋势
   */
  getConfidenceTrend() {
    if (this.confidenceHistory.length < 3) return 'stable';

    const recent = this.confidenceHistory.slice(-3);
    const avgRecent = recent.reduce((a, b) => a + b, 0) / recent.length;

    const earlier = this.confidenceHistory.slice(0, -3);
    if (earlier.length === 0) return 'stable';
    const avgEarlier = earlier.reduce((a, b) => a + b, 0) / earlier.length;

    const diff = avgRecent - avgEarlier;
    if (diff > 0.1) return 'improving';
    if (diff < -0.1) return 'declining';
    return 'stable';
  }
}

/**
 * 监控会话
 */
class MonitorSession {
  constructor(sessionId, examUrl) {
    this.sessionId = sessionId;
    this.examUrl = examUrl;
    this.metrics = new ExamMetrics();
    this.startTime = Date.now();
    this.status = 'active'; // active, stopped, error
    this.clients = new Set(); // WebSocket客户端集合
    this.operationLog = [];
    this.screenshots = [];
    this.emergencyStop = false;
  }

  /**
   * 添加WebSocket客户端
   */
  addClient(ws) {
    this.clients.add(ws);

    ws.on('close', () => {
      this.clients.delete(ws);
    });

    ws.on('error', (error) => {
      logger.error(`[Monitor] WebSocket client error for session ${this.sessionId}:`, error.message);
      this.clients.delete(ws);
    });

    // 立即发送当前状态
    this.pushStatus();
  }

  /**
   * 记录操作日志
   */
  logOperation(type, data = {}) {
    const logEntry = {
      timestamp: Date.now(),
      type,
      data,
      sessionId: this.sessionId
    };

    this.operationLog.push(logEntry);
    logger.debug(`[Monitor] Session ${this.sessionId}: ${type}`, data);

    // 如果操作会影响监控状态，推送更新
    if (['answer', 'skip', 'error', 'next_question'].includes(type)) {
      this.pushStatus();
    }
  }

  /**
   * 记录异常截图
   */
  async addScreenshot(screenshot, context = {}) {
    const screenshotEntry = {
      timestamp: Date.now(),
      sessionId: this.sessionId,
      path: null,
      context
    };

    try {
      const fs = require('fs').promises;
      const path = require('path');
      const logsDir = path.join(__dirname, 'logs', 'screenshots');
      await fs.mkdir(logsDir, { recursive: true });

      const filename = `${this.sessionId}_${Date.now()}.png`;
      const filepath = path.join(logsDir, filename);
      await fs.writeFile(filepath, screenshot);

      screenshotEntry.path = filepath;
      this.screenshots.push(screenshotEntry);

      logger.info(`[Monitor] Screenshot saved: ${filepath}`);
    } catch (error) {
      logger.error(`[Monitor] Failed to save screenshot:`, error.message);
    }
  }

  /**
   * 更新指标
   */
  updateMetrics(updates) {
    if (updates.current !== undefined) {
      this.metrics.questionIndex = updates.current;
    }
    if (updates.total !== undefined) {
      this.metrics.totalQuestions = updates.total;
    }
    if (updates.answer) {
      this.metrics.recordAnswer(updates.answer);
    }
    if (updates.error) {
      this.metrics.recordError(updates.error);
    }
  }

  /**
   * 推送状态到所有客户端
   */
  pushStatus() {
    const message = JSON.stringify({
      type: 'status_update',
      sessionId: this.sessionId,
      timestamp: Date.now(),
      status: this.status,
      summary: this.metrics.getSummary(),
      emergencyStop: this.emergencyStop
    });

    this.clients.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(message);
        } catch (error) {
          logger.error(`[Monitor] Failed to send status to client:`, error.message);
          this.clients.delete(ws);
        }
      }
    });
  }

  /**
   * 推送异常通知
   */
  pushAlert(alert) {
    const message = JSON.stringify({
      type: 'alert',
      sessionId: this.sessionId,
      timestamp: Date.now(),
      alert: {
        severity: alert.severity || 'warning',
        message: alert.message,
        data: alert.data || {}
      }
    });

    this.clients.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(message);
        } catch (error) {
          logger.error(`[Monitor] Failed to send alert to client:`, error.message);
          this.clients.delete(ws);
        }
      }
    });
  }

  /**
   * 设置紧急停止
   */
  setEmergencyStop(reason = 'manual') {
    this.emergencyStop = true;
    this.status = 'stopped';
    this.logOperation('emergency_stop', { reason });

    this.pushAlert({
      severity: 'critical',
      message: `考试已紧急停止: ${reason}`,
      data: { reason }
    });
  }

  /**
   * 清除紧急停止标志
   */
  clearEmergencyStop() {
    this.emergencyStop = false;
    this.status = 'active';
    this.logOperation('emergency_stop_cleared');
    this.pushStatus();
  }

  /**
   * 检查是否应该停止
   */
  shouldStop() {
    return this.emergencyStop;
  }

  /**
   * 获取完整报告
   */
  getFullReport() {
    return {
      sessionId: this.sessionId,
      examUrl: this.examUrl,
      startTime: new Date(this.startTime).toISOString(),
      endTime: this.status !== 'active' ? new Date().toISOString() : null,
      duration: Date.now() - this.startTime,
      status: this.status,
      metrics: this.metrics.getSummary(),
      operationLog: this.operationLog,
      screenshots: this.screenshots.map(s => ({
        timestamp: s.timestamp,
        path: s.path,
        context: s.context
      })),
      abnormalities: this.metrics.detectAbnormalities()
    };
  }
}

/**
 * 监控系统主类
 */
class ExamMonitor {
  constructor() {
    this.sessions = new Map(); // sessionId -> MonitorSession
    this.wss = null;
    this.port = 3501; // WebSocket服务端口
  }

  /**
   * 初始化WebSocket服务器
   */
  initWebSocketServer() {
    if (this.wss) {
      return;
    }

    this.wss = new WebSocket.Server({ port: this.port });

    this.wss.on('listening', () => {
      logger.info(`[Monitor] WebSocket server started on port ${this.port}`);
    });

    this.wss.on('connection', (ws, req) => {
      // 从URL获取sessionId
      const url = new URL(req.url, `http://${req.headers.host}`);
      const sessionId = url.searchParams.get('sessionId');

      if (!sessionId) {
        ws.send(JSON.stringify({
          type: 'error',
          message: 'sessionId is required'
        }));
        ws.close();
        return;
      }

      logger.info(`[Monitor] Client connected for session ${sessionId}`);

      const session = this.sessions.get(sessionId);
      if (session) {
        session.addClient(ws);

        ws.send(JSON.stringify({
          type: 'connected',
          sessionId: sessionId,
          message: 'Monitoring connection established'
        }));
      } else {
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Session not found'
        }));
        ws.close();
      }
    });

    this.wss.on('error', (error) => {
      logger.error('[Monitor] WebSocket server error:', error.message);
    });
  }

  /**
   * 创建监控会话
   */
  createSession(sessionId, examUrl) {
    if (this.sessions.has(sessionId)) {
      return this.sessions.get(sessionId);
    }

    const session = new MonitorSession(sessionId, examUrl);
    this.sessions.set(sessionId, session);

    logger.info(`[Monitor] Session ${sessionId} monitoring started`);

    return session;
  }

  /**
   * 获取监控会话
   */
  getSession(sessionId) {
    return this.sessions.get(sessionId);
  }

  /**
   * 停止并清理监控会话
   */
  stopSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = 'stopped';
      session.pushStatus();
      logger.info(`[Monitor] Session ${sessionId} monitoring stopped`);
    }
  }

  /**
   * 删除监控会话
   */
  removeSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.clients.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.close();
        }
      });
      this.sessions.delete(sessionId);
      logger.info(`[Monitor] Session ${sessionId} removed`);
    }
  }

  /**
   * 记录操作（通过sessionId）
   */
  log(sessionId, type, data = {}) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.logOperation(type, data);

      // 检测异常情况并推送
      if (type === 'answer' && data.confidence !== undefined && data.confidence < 0.7) {
        session.pushAlert({
          severity: 'warning',
          message: `低置信度答案: ${(data.confidence * 100).toFixed(1)}%`,
          data: { question: data.question?.substring(0, 50) }
        });
      }
    }
  }

  /**
   * 更新指标（通过sessionId）
   */
  updateMetrics(sessionId, updates) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.updateMetrics(updates);

      // 检测异常并推送警告
      const abnormalities = session.metrics.detectAbnormalities();
      abnormalities.forEach(abnormality => {
        session.pushAlert({
          severity: abnormality.severity,
          message: abnormality.message,
          data: abnormality
        });
      });
    }
  }

  /**
   * 紧急停止
   */
  emergencyStop(sessionId, reason = 'manual') {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.setEmergencyStop(reason);
    }
  }

  /**
   * 清除紧急停止
   */
  clearEmergencyStop(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.clearEmergencyStop();
    }
  }

  /**
   * 检查会话是否应停止
   */
  shouldStop(sessionId) {
    const session = this.sessions.get(sessionId);
    return session ? session.shouldStop() : false;
  }

  /**
   * 获取所有活跃会话
   */
  getActiveSessions() {
    return Array.from(this.sessions.values())
      .filter(s => s.status === 'active')
      .map(s => ({
        sessionId: s.sessionId,
        examUrl: s.examUrl,
        startTime: new Date(s.startTime).toISOString(),
        status: s.status,
        connectedClients: s.clients.size,
        summary: s.metrics.getSummary()
      }));
  }

  /**
   * 关闭WebSocket服务器
   */
  close() {
    if (this.wss) {
      this.wss.clients.forEach(ws => {
        ws.close();
      });
      this.wss.close();
      logger.info('[Monitor] WebSocket server closed');
    }
  }
}

// 单例导出
module.exports = new ExamMonitor();

// 如果直接运行此文件，启动监控服务器
if (require.main === module) {
  const monitor = require('./monitor');
  monitor.initWebSocketServer();

  process.on('SIGINT', () => {
    logger.info('[Monitor] Shutting down...');
    monitor.close();
    process.exit(0);
  });
}