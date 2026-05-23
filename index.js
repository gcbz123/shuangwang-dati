'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');

// ── 读取环境配置文件 ──
const ENV_FILE = path.join(__dirname, 'env.conf');
if (fs.existsSync(ENV_FILE)) {
  const savedEnv = fs.readFileSync(ENV_FILE, 'utf-8').trim();
  if (savedEnv === 'production' || savedEnv === 'development') {
    process.env.NODE_ENV = savedEnv;
    console.log('已读取环境配置:', savedEnv);
  }
}

const config = require('./config');
const logger = require('./logger');
const { setupBodyParsers, corsMiddleware } = require('./middleware');
const apiRouter = require('./routes');
const monitor = require('./monitor');
const {
  loadQuestionBankFromDisk,
  loadExtractedQuestionsFromDisk,
  getQuestionBank,
  saveQuestionBank,
  isQuestionExists,
  importFromTxt,
} = require('./questionBank');
const { getFuseThreshold, invalidateFuse } = require('./questionMatcher');

const app = express();

// ── 简单请求日志（仅开发环境） ──
if (!config.isProduction) {
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      logger.info(`${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`);
    });
    next();
  });
} else {
  app.use((_req, _res, next) => next());
}

// ── 中间件 ──
setupBodyParsers(app);
app.use(corsMiddleware);

// ── API 路由 ──
app.use('/api', apiRouter);

// ── scripts 目录（油猴脚本） ──
app.use('/scripts', express.static(path.join(__dirname, 'scripts')));

// ── 前端静态文件 ──
app.use(express.static(path.join(__dirname, 'web')));

// ── 全局错误处理 ──
app.use((err, req, res, next) => {
  logger.error('未捕获错误:', err.message);
  res.status(500).json({ code: 500, message: '服务器内部错误' });
});

// ── 启动 ──
app.listen(config.port, '0.0.0.0', async () => {
  try {
    // 1. 加载题库
    await loadQuestionBankFromDisk();
    await loadExtractedQuestionsFromDisk();

    // 2. 初始化监控系统WebSocket服务器
    monitor.initWebSocketServer();

    logger.info(`Server running on http://0.0.0.0:${config.port}`);
    logger.info(`前端页面: http://localhost:${config.port}/index.html`);
    logger.info(`监控WebSocket: ws://0.0.0.0:${monitor.port}`);

    // 3. 扫描题库导入目录
    const importDir = path.join(__dirname, '题库导入');
    try {
      await fs.promises.mkdir(importDir, { recursive: true });
    } catch (err) {
      if (err.code !== 'EEXIST') {
        logger.error('创建题库导入目录失败:', err.message);
      }
    }

    let txtFiles = [];
    try {
      txtFiles = (await fs.promises.readdir(importDir)).filter(f => f.endsWith('.txt'));
    } catch (err) {
      if (!err || err.code !== 'ENOENT') {
        logger.error('扫描题库导入目录失败:', err.message);
      }
    }

    if (txtFiles.length > 0) {
      const bank = [...getQuestionBank()];
      let totalAdded = 0;
      let totalDuplicate = 0;

      for (const txtFile of txtFiles) {
        const txtPath = path.join(importDir, txtFile);
        let newQuestions = [];
        let fileAdded = 0;
        try {
          newQuestions = await importFromTxt(txtPath);
          for (const q of newQuestions) {
            if (!isQuestionExists(bank, q.question, q.question_type)) {
              bank.push(q);
              totalAdded++;
              fileAdded++;
            }
          }
          const fileDuplicate = newQuestions.length - fileAdded;
          totalDuplicate += fileDuplicate;
          logger.info(`[${txtFile}] 导入完成: 新增 ${fileAdded} 道, 跳过重复 ${fileDuplicate} 道`);
        } catch (err) {
          logger.error(`处理文件 ${txtFile} 时出错: ${err.message}`);
        }
      }

      await saveQuestionBank(bank);
      invalidateFuse();
      logger.info(`题库导入完成: 新增 ${totalAdded} 道, 跳过重复 ${totalDuplicate} 道, 共 ${bank.length} 道`);
    } else {
      logger.info('题库导入目录为空或不存在');
    }

    logger.info(`匹配相似度: ${getFuseThreshold()}`);
    logger.info(`环境: ${config.isProduction ? '生产' : '开发'}`);
  } catch (err) {
    logger.error('启动初始化失败:', err.message);
  }
});
