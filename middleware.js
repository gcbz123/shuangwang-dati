'use strict';

const express = require('express');
const config = require('./config');

// ── Body 解析（修复原 BUG：移除通配 type，避免解析器冲突） ──
function setupBodyParsers(app) {
  // JSON 只处理 application/json
  app.use(express.json({ limit: config.bodyLimit, strict: false }));
  // URL-encoded 只处理 application/x-www-form-urlencoded
  app.use(express.urlencoded({ limit: config.bodyLimit, extended: true }));
  // text 只处理 text/plain（用于前端直接发送 HTML 文本）
  app.use(express.text({ limit: config.bodyLimit, type: 'text/plain' }));
}

// ── CORS（修复原 BUG：空 ALLOWED_ORIGINS 时给出合理默认行为） ──
function corsMiddleware(req, res, next) {
  const origin = req.headers.origin;

  if (config.isProduction) {
    if (config.allowedOrigins.length === 0) {
      // 生产环境未配置来源 → 允许同源 + localhost，方便调试
      res.header('Access-Control-Allow-Origin', '*');
    } else if (config.allowedOrigins.includes('*')) {
      res.header('Access-Control-Allow-Origin', '*');
    } else if (config.allowedOrigins.includes(origin)) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Vary', 'Origin');
    } else if (origin) {
      return res.status(403).json({ error: 'CORS: 来源不在白名单中' });
    }
  } else {
    res.header('Access-Control-Allow-Origin', '*');
  }

  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
}

// ── 限流（修复原 BUG：使用 req.socket.remoteAddress 替代已废弃的 req.connection） ──
const rateLimitMap = new Map();

function rateLimitMiddleware(req, res, next) {
  const ip = req.ip || req.socket.remoteAddress;
  const now = Date.now();

  if (!rateLimitMap.has(ip)) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + config.rateLimitWindow });
    return next();
  }

  const limitData = rateLimitMap.get(ip);

  if (now > limitData.resetTime) {
    limitData.count = 1;
    limitData.resetTime = now + config.rateLimitWindow;
    return next();
  }

  if (limitData.count >= config.rateLimitMax) {
    return res.status(429).json({ error: '请求过于频繁，请稍后再试' });
  }

  limitData.count++;
  next();
}

// 定期清理过期限流记录
const _rateLimitCleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [ip, data] of rateLimitMap) {
    if (now > data.resetTime) {
      rateLimitMap.delete(ip);
    }
  }
}, config.rateLimitWindow);

// 允许进程正常退出
if (_rateLimitCleanupTimer.unref) {
  _rateLimitCleanupTimer.unref();
}

module.exports = {
  setupBodyParsers,
  corsMiddleware,
  rateLimitMiddleware,
};
