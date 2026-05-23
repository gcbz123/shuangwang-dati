const path = require('path');

// 题型常量
const QUESTION_TYPES = {
  SINGLE: 'single_choice',
  MULTIPLE: 'multiple_choice',
  JUDGMENT: 'judgment',
  SHORT: 'short_answer',
};

// 配置文件
const config = {
  port: process.env.PORT || 3500, // 监听端口
  isProduction: process.env.NODE_ENV === 'production',

  // 题库文件路径
  questionBankFile: path.join(__dirname, 'question_bank.json'),
  extractedQuestionsFile: path.join(__dirname, 'extracted_questions.json'),

  // Fuse.js 匹配配置
  fuseThresholdDefault: 0.22,
  fuseThresholdEnv: process.env.FUSE_THRESHOLD,

  // LRU 缓存配置
  cacheMaxSize: Number.parseInt(process.env.CACHE_MAX_SIZE, 10) || 2000,

  // 请求体大小限制
  bodyLimit: process.env.BODY_LIMIT || '5mb',

  // CORS 配置
  allowedOrigins: (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean),

  // 限流配置
  rateLimitWindow: Number.parseInt(process.env.RATE_LIMIT_WINDOW, 10) || 60000,
  rateLimitMax: Number.parseInt(process.env.RATE_LIMIT_MAX, 10) || 60,

  // HTML 内容限制
  htmlMaxLength: Number.parseInt(process.env.HTML_MAX_LENGTH, 10) || 1024 * 1024,

  // 题型常量
  QUESTION_TYPES,

  // 考试系统配置
  examConfig: {
    defaultTimeLimit: 7200000, // 默认考试时间限制（毫秒）
    maxConcurrentSessions: 5, // 最大并发会话数
    heartbeatInterval: 30000, // 心跳间隔（毫秒）
    defaultStrategy: {
      minConfidence: 0.7, // 默认最小置信度
      maxTimePerQuestion: 30000, // 每题最大时间（毫秒）
      skipLowConfidence: true, // 跳过低置信度题目
      randomDelayEnabled: true, // 启用随机延迟
    },
    domConfigDir: path.join(__dirname, 'domConfigs'),
    monitorPort: 3501, // WebSocket监控端口
  },
};

module.exports = config;