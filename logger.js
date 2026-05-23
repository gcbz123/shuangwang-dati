'use strict';

const fs = require('fs');
const path = require('path');
const config = require('./config');

const LOG_FILE = path.join(__dirname, 'server.log');

// 日志级别
const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10MB
// 开发环境和生产环境均使用 INFO 级别（debug 日志默认不输出）
const currentLevel = config.isProduction ? LOG_LEVELS.info : LOG_LEVELS.info;

// 写入日志文件（含自动清空逻辑）
function writeToFile(level, args) {
  try {
    // 检查日志文件大小，超过10MB则清空
    if (fs.existsSync(LOG_FILE)) {
      const { size } = fs.statSync(LOG_FILE);
      if (size > MAX_LOG_SIZE) {
        fs.writeFileSync(LOG_FILE, '', 'utf-8');
        fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] [INFO] 日志文件超过10MB，已自动清空\n`, 'utf-8');
      }
    }
    const text = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${text}\n`;
    fs.appendFileSync(LOG_FILE, line, 'utf-8');
  } catch (_) {
    // 写入失败静默处理
  }
}

const logger = {
  info: (...args) => {
    if (currentLevel <= LOG_LEVELS.info) {
      console.log('[INFO]', new Date().toISOString(), ...args);
      writeToFile('info', args);
    }
  },
  warn: (...args) => {
    if (currentLevel <= LOG_LEVELS.warn) {
      console.warn('[WARN]', new Date().toISOString(), ...args);
      writeToFile('warn', args);
    }
  },
  error: (...args) => {
    if (currentLevel <= LOG_LEVELS.error) {
      console.error('[ERROR]', new Date().toISOString(), ...args);
      writeToFile('error', args);
    }
  },
  debug: (...args) => {
    if (currentLevel <= LOG_LEVELS.debug) {
      console.log('[DEBUG]', new Date().toISOString(), ...args);
      writeToFile('debug', args);
    }
  },
};

module.exports = logger;
