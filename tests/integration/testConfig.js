/**
 * 集成测试服务器配置
 * 使用测试专用的配置，避免影响生产数据
 */

const path = require('path');

// 测试专用配置
const testConfig = {
  port: 3999, // 使用不同的端口避免冲突
  isProduction: false,
  questionBankFile: path.join(__dirname, '..', 'test_question_bank.json'),
  extractedQuestionsFile: path.join(__dirname, '..', 'test_extracted_questions.json'),
  examConfig: {
    defaultTimeLimit: 7200000,
    maxConcurrentSessions: 5,
    heartbeatInterval: 30000,
    defaultStrategy: {
      minConfidence: 0.7,
      maxTimePerQuestion: 30000,
      skipLowConfidence: true,
      randomDelayEnabled: true,
    },
    domConfigDir: path.join(__dirname, '..', 'domConfigs'),
    monitorPort: 3998, // 测试用 WebSocket 端口
  },
  htmlMaxLength: 1024 * 1024,
  fuseThresholdDefault: 0.22,
  fuseThresholdEnv: undefined,
  cacheMaxSize: 100,
};

module.exports = testConfig;
