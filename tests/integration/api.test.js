/**
 * API 集成测试
 * 测试核心 API 端点的功能
 */

const request = require('supertest');

// Mock 所有模块 before requiring the app
jest.mock('../../config', () => require('./testConfig'));

jest.mock('../../logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../../monitor', () => ({
  initWebSocketServer: jest.fn(),
  createSession: jest.fn(),
  log: jest.fn(),
  stopSession: jest.fn(),
  shouldStop: jest.fn(() => false),
  updateMetrics: jest.fn(),
  port: 3998,
}));

// Mock examOrchestrator (uuid ESM 兼容性问题)
jest.mock('../../examOrchestrator', () => ({
  startExam: jest.fn((params) => {
    if (!params.examUrl) throw new Error('examUrl is required');
    return Promise.resolve({
      sessionId: 'test-session-' + Date.now(),
      status: 'started',
    });
  }),
  getSessionStatus: jest.fn((sessionId) => {
    if (sessionId === 'nonexistent') return null;
    return {
      sessionId,
      status: 'running',
      progress: { current: 1, total: 10 },
      answers: 0,
      duration: 1000,
    };
  }),
  pauseExam: jest.fn(),
  resumeExam: jest.fn(),
  abortExam: jest.fn((sessionId) => {
    if (sessionId === 'nonexistent') throw new Error('Session not found');
    return Promise.resolve();
  }),
  sessions: new Map(),
}));

jest.mock('../../reportGenerator', () => ({
  saveAllFormats: jest.fn(),
  generateFullReport: jest.fn(() => ({ summary: {} })),
  getReportList: jest.fn(() => Promise.resolve([])),
  deleteReport: jest.fn(() => Promise.resolve(['json'])),
  saveJsonReport: jest.fn(),
  saveCsvReport: jest.fn(),
  saveHtmlReport: jest.fn(),
}));

// 创建测试用的 Express 应用
const express = require('express');
const { setupBodyParsers, corsMiddleware } = require('../../middleware');
const apiRouter = require('../../routes');

function createTestApp() {
  const app = express();
  setupBodyParsers(app);
  app.use(corsMiddleware);
  app.use('/api', apiRouter);
  return app;
}

describe('API Integration Tests', () => {
  let app;

  beforeAll(() => {
    app = createTestApp();
  });

  describe('GET /api/health', () => {
    test('返回健康状态', async () => {
      const response = await request(app).get('/api/health');
      expect(response.status).toBe(200);
      expect(response.body.status).toBe('ok');
      expect(response.body).toHaveProperty('uptime');
      expect(response.body).toHaveProperty('questionCount');
    });
  });

  describe('GET /api/get-env', () => {
    test('返回当前环境', async () => {
      const response = await request(app).get('/api/get-env');
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('env');
    });
  });

  describe('GET /api/matching-config', () => {
    test('返回当前匹配阈值', async () => {
      const response = await request(app).get('/api/matching-config');
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('threshold');
      expect(typeof response.body.threshold).toBe('number');
    });
  });

  describe('POST /api/matching-config', () => {
    test('更新匹配阈值', async () => {
      const response = await request(app)
        .post('/api/matching-config')
        .send({ threshold: 0.3 });
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.threshold).toBe(0.3);
    });

    test('拒绝无效阈值', async () => {
      const response = await request(app)
        .post('/api/matching-config')
        .send({ threshold: -1 });
      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
    });

    test('拒绝非数字阈值', async () => {
      const response = await request(app)
        .post('/api/matching-config')
        .send({ threshold: 'abc' });
      expect(response.status).toBe(400);
    });
  });

  describe('GET /api/question-bank', () => {
    test('返回题库列表', async () => {
      const response = await request(app).get('/api/question-bank');
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('questions');
      expect(Array.isArray(response.body.questions)).toBe(true);
    });
  });

  describe('POST /api/question-bank', () => {
    test('拒绝缺少参数的请求', async () => {
      const response = await request(app)
        .post('/api/question-bank')
        .send({});
      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
    });

    test('拒绝缺少 answer 的请求', async () => {
      const response = await request(app)
        .post('/api/question-bank')
        .send({ question: '测试题目' });
      expect(response.status).toBe(400);
    });
  });

  describe('POST /api/parse-and-get-answer', () => {
    test('拒绝缺少 htmlContent 的请求', async () => {
      const response = await request(app)
        .post('/api/parse-and-get-answer')
        .send({});
      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
    });

    test('拒绝非字符串 htmlContent', async () => {
      const response = await request(app)
        .post('/api/parse-and-get-answer')
        .send({ htmlContent: 123 });
      expect(response.status).toBe(400);
    });
  });

  describe('POST /api/start-exam', () => {
    test('拒绝缺少 examUrl 的请求', async () => {
      const response = await request(app)
        .post('/api/start-exam')
        .send({});
      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
    });

    test('成功启动考试', async () => {
      const response = await request(app)
        .post('/api/start-exam')
        .send({
          examUrl: 'http://example.com/exam',
          mode: 'manual',
        });
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('sessionId');
      expect(response.body.status).toBe('started');
    });
  });

  describe('GET /api/exam-status/:sessionId', () => {
    test('返回 404 对于不存在的会话', async () => {
      const response = await request(app).get('/api/exam-status/nonexistent');
      expect(response.status).toBe(404);
      expect(response.body.error).toBeDefined();
    });
  });

  describe('GET /api/reports', () => {
    test('返回报告列表', async () => {
      const response = await request(app).get('/api/reports');
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('reports');
      expect(Array.isArray(response.body.reports)).toBe(true);
    });
  });
});
