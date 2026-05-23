/**
 * 答题策略引擎
 * 控制答题行为，模拟人类特征，降低被检测风险
 */

const logger = require('./logger');

class AnswerStrategy {
  constructor(options = {}) {
    this.minConfidence = options.minConfidence || 0.7;
    this.maxTimePerQuestion = options.maxTimePerQuestion || 30000; // 30秒
    this.skipLowConfidence = options.skipLowConfidence !== false;
    this.randomDelayEnabled = options.randomDelayEnabled !== false;

    // 延迟参数配置
    this.delayConfig = {
      baseDelay: options.baseDelay || 1000,        // 基础延迟1秒
      perCharDelay: options.perCharDelay || 50,     // 每字符50ms
      minRandomFactor: options.minRandomFactor || 0.8,
      maxRandomFactor: options.maxRandomFactor || 1.2
    };

    // 统计信息
    this.stats = {
      totalQuestions: 0,
      answeredQuestions: 0,
      skippedQuestions: 0,
      avgDelay: 0
    };
  }

  /**
   * 计算答题延迟(模拟人类阅读时间)
   * @param {number} questionLength - 题目长度(字符数)
   * @returns {number} 延迟时间(毫秒)
   */
  calculateDelay(questionLength) {
    if (!this.randomDelayEnabled) {
      return this.delayConfig.baseDelay + questionLength * this.delayConfig.perCharDelay;
    }

    // 正态分布随机因子(更接近人类行为)
    const randomFactor = this.generateNormalRandom(
      this.delayConfig.minRandomFactor,
      this.delayConfig.maxRandomFactor
    );

    let delay = (
      this.delayConfig.baseDelay +
      questionLength * this.delayConfig.perCharDelay
    ) * randomFactor;

    // 限制最大延迟
    delay = Math.min(delay, this.maxTimePerQuestion);

    // 确保最小延迟
    delay = Math.max(delay, 500);

    return Math.round(delay);
  }

  /**
   * 生成正态分布随机数
   * @param {number} min - 最小值
   * @param {number} max - 最大值
   * @returns {number}
   */
  generateNormalRandom(min, max) {
    // Box-Muller变换生成正态分布
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();

    const mean = (min + max) / 2;
    const stddev = (max - min) / 6; // 99.7%的值在[min, max]范围内

    const normalRandom = mean + stddev * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);

    // 限制在[min, max]范围内
    return Math.max(min, Math.min(max, normalRandom));
  }

  /**
   * 判断是否应该作答
   * @param {Object} matchResult - 匹配结果(包含score字段)
   * @returns {boolean}
   */
  shouldAnswer(matchResult) {
    if (!matchResult || !matchResult.answer) {
      return false;
    }

    // 计算置信度 (score越低表示越匹配)
    const confidence = 1 - (matchResult.score || 1);

    // 如果置信度低于阈值，根据配置决定是否跳过
    if (confidence < this.minConfidence) {
      if (this.skipLowConfidence) {
        logger.debug(`[Strategy] Skipping question (confidence: ${(confidence * 100).toFixed(2)}%)`);
        return false;
      }
      // 不跳过但记录警告
      logger.warn(`[Strategy] Low confidence answer: ${(confidence * 100).toFixed(2)}%`);
    }

    return true;
  }

  /**
   * 优先级排序(先做高置信度题目)
   * @param {Array} questionsWithAnswers - 题目和答案数组
   * @returns {Array} 排序后的数组
   */
  prioritizeQuestions(questionsWithAnswers) {
    return questionsWithAnswers.sort((a, b) => {
      const confA = a.answer ? (1 - (a.answer.score || 1)) : 0;
      const confB = b.answer ? (1 - (b.answer.score || 1)) : 0;
      return confB - confA; // 降序排列，高置信度在前
    });
  }

  /**
   * 评估答案质量
   * @param {Object} matchResult - 匹配结果
   * @returns {Object} 质量评估
   */
  evaluateAnswerQuality(matchResult) {
    if (!matchResult) {
      return {
        quality: 'none',
        confidence: 0,
        recommendation: 'skip'
      };
    }

    const confidence = 1 - (matchResult.score || 1);
    let quality, recommendation;

    if (confidence >= 0.9) {
      quality = 'excellent';
      recommendation = 'answer_immediately';
    } else if (confidence >= 0.7) {
      quality = 'good';
      recommendation = 'answer';
    } else if (confidence >= 0.5) {
      quality = 'fair';
      recommendation = 'answer_with_caution';
    } else if (confidence >= this.minConfidence) {
      quality = 'poor';
      recommendation = 'consider_skip';
    } else {
      quality = 'very_poor';
      recommendation = 'skip';
    }

    return {
      quality,
      confidence,
      recommendation,
      score: matchResult.score
    };
  }

  /**
   * 计算剩余时间分配
   * @param {number} remainingTime - 剩余时间(毫秒)
   * @param {number} remainingQuestions - 剩余题目数
   * @returns {Object} 时间分配建议
   */
  calculateTimeAllocation(remainingTime, remainingQuestions) {
    if (remainingQuestions === 0) {
      return {
        timePerQuestion: 0,
        shouldHurry: false,
        hasEnoughTime: true
      };
    }

    const timePerQuestion = remainingTime / remainingQuestions;
    const recommendedTime = this.delayConfig.baseDelay + 50 * this.delayConfig.perCharDelay; // 假设平均50字符

    const shouldHurry = timePerQuestion < recommendedTime * 0.5; // 少于推荐时间的一半
    const hasEnoughTime = timePerQuestion > recommendedTime * 2; // 超过推荐时间的两倍

    return {
      timePerQuestion,
      timePerQuestionFormatted: this.formatTime(timePerQuestion),
      shouldHurry,
      hasEnoughTime,
      recommendedTime,
      recommendedTimeFormatted: this.formatTime(recommendedTime)
    };
  }

  /**
   * 格式化时间
   */
  formatTime(ms) {
    if (ms < 1000) {
      return `${ms}ms`;
    } else if (ms < 60000) {
      return `${(ms / 1000).toFixed(1)}s`;
    } else {
      return `${(ms / 60000).toFixed(1)}m`;
    }
  }

  /**
   * 更新统计信息
   * @param {boolean} answered - 是否作答
   * @param {number} delay - 实际延迟时间
   */
  updateStats(answered, delay) {
    this.stats.totalQuestions++;
    if (answered) {
      this.stats.answeredQuestions++;
    } else {
      this.stats.skippedQuestions++;
    }

    // 更新平均延迟
    this.stats.avgDelay = (
      (this.stats.avgDelay * (this.stats.totalQuestions - 1) + delay) /
      this.stats.totalQuestions
    );
  }

  /**
   * 获取统计报告
   * @returns {Object}
   */
  getStatsReport() {
    return {
      ...this.stats,
      answerRate: this.stats.totalQuestions > 0
        ? (this.stats.answeredQuestions / this.stats.totalQuestions * 100).toFixed(2) + '%'
        : '0%',
      avgDelayFormatted: this.formatTime(this.stats.avgDelay)
    };
  }

  /**
   * 重置策略状态
   */
  reset() {
    this.stats = {
      totalQuestions: 0,
      answeredQuestions: 0,
      skippedQuestions: 0,
      avgDelay: 0
    };
  }
}

module.exports = AnswerStrategy;
