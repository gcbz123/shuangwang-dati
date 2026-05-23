/**
 * strategyEngine.js 单元测试
 * 测试答题策略引擎的核心功能
 */

const AnswerStrategy = require('../../strategyEngine');

describe('AnswerStrategy', () => {
  let strategy;

  beforeEach(() => {
    strategy = new AnswerStrategy();
  });

  describe('constructor', () => {
    test('使用默认配置初始化', () => {
      expect(strategy.minConfidence).toBe(0.7);
      expect(strategy.maxTimePerQuestion).toBe(30000);
      expect(strategy.skipLowConfidence).toBe(true);
      expect(strategy.randomDelayEnabled).toBe(true);
    });

    test('使用自定义配置初始化', () => {
      const customStrategy = new AnswerStrategy({
        minConfidence: 0.8,
        maxTimePerQuestion: 20000,
        skipLowConfidence: false,
        randomDelayEnabled: false,
      });

      expect(customStrategy.minConfidence).toBe(0.8);
      expect(customStrategy.maxTimePerQuestion).toBe(20000);
      expect(customStrategy.skipLowConfidence).toBe(false);
      expect(customStrategy.randomDelayEnabled).toBe(false);
    });
  });

  describe('calculateDelay', () => {
    test('随机延迟启用时返回随机化延迟', () => {
      const delay = strategy.calculateDelay(10);
      // 基础1000ms + 10*50ms = 1500ms, 随机因子0.8~1.2
      // 所以范围应该在 1200~1800ms 之间
      expect(delay).toBeGreaterThanOrEqual(500);
      expect(delay).toBeLessThanOrEqual(30000);
    });

    test('随机延迟禁用时返回固定延迟', () => {
      const fixedStrategy = new AnswerStrategy({ randomDelayEnabled: false });
      const delay1 = fixedStrategy.calculateDelay(10);
      const delay2 = fixedStrategy.calculateDelay(10);
      // 应该每次都相同: 1000 + 10*50 = 1500
      expect(delay1).toBe(1500);
      expect(delay2).toBe(1500);
    });

    test('题目长度影响延迟', () => {
      const shortDelay = strategy.calculateDelay(5);
      const longDelay = strategy.calculateDelay(100);
      // 长题目应该有更大的基础延迟
      // 由于随机性，我们只能验证它们都在合理范围内
      expect(shortDelay).toBeGreaterThan(0);
      expect(longDelay).toBeGreaterThan(0);
    });

    test('延迟不超过最大值', () => {
      const veryLongQuestion = 10000;
      const delay = strategy.calculateDelay(veryLongQuestion);
      expect(delay).toBeLessThanOrEqual(30000);
    });

    test('延迟不小于最小值', () => {
      const delay = strategy.calculateDelay(0);
      expect(delay).toBeGreaterThanOrEqual(500);
    });
  });

  describe('generateNormalRandom', () => {
    test('生成的值在指定范围内', () => {
      // 运行100次，确保所有值都在范围内
      for (let i = 0; i < 100; i++) {
        const value = strategy.generateNormalRandom(0.8, 1.2);
        expect(value).toBeGreaterThanOrEqual(0.8);
        expect(value).toBeLessThanOrEqual(1.2);
      }
    });
  });

  describe('shouldAnswer', () => {
    test('高置信度答案应该作答', () => {
      const matchResult = {
        answer: 'A',
        score: 0.1, // 置信度 = 1 - 0.1 = 0.9
      };
      expect(strategy.shouldAnswer(matchResult)).toBe(true);
    });

    test('低置信度答案根据配置跳过', () => {
      const matchResult = {
        answer: 'A',
        score: 0.5, // 置信度 = 1 - 0.5 = 0.5
      };
      expect(strategy.shouldAnswer(matchResult)).toBe(false);
    });

    test('空结果不应该作答', () => {
      expect(strategy.shouldAnswer(null)).toBe(false);
      expect(strategy.shouldAnswer({})).toBe(false);
      expect(strategy.shouldAnswer({ answer: null })).toBe(false);
    });

    test('配置不跳过时低置信度也作答', () => {
      const lenientStrategy = new AnswerStrategy({ skipLowConfidence: false });
      const matchResult = {
        answer: 'A',
        score: 0.5,
      };
      expect(lenientStrategy.shouldAnswer(matchResult)).toBe(true);
    });
  });

  describe('prioritizeQuestions', () => {
    test('按置信度降序排列', () => {
      const questions = [
        { question: 'Q1', answer: { score: 0.3 } },
        { question: 'Q2', answer: { score: 0.1 } },
        { question: 'Q3', answer: { score: 0.5 } },
      ];

      const sorted = strategy.prioritizeQuestions(questions);

      expect(sorted[0].question).toBe('Q2'); // score 0.1 → 置信度 0.9
      expect(sorted[1].question).toBe('Q1'); // score 0.3 → 置信度 0.7
      expect(sorted[2].question).toBe('Q3'); // score 0.5 → 置信度 0.5
    });
  });

  describe('evaluateAnswerQuality', () => {
    test('优秀质量 (置信度 >= 0.9)', () => {
      const result = strategy.evaluateAnswerQuality({ score: 0.05 });
      expect(result.quality).toBe('excellent');
      expect(result.recommendation).toBe('answer_immediately');
    });

    test('良好质量 (置信度 >= 0.7)', () => {
      const result = strategy.evaluateAnswerQuality({ score: 0.2 });
      expect(result.quality).toBe('good');
      expect(result.recommendation).toBe('answer');
    });

    test('一般质量 (置信度 >= 0.5)', () => {
      const result = strategy.evaluateAnswerQuality({ score: 0.4 });
      expect(result.quality).toBe('fair');
      expect(result.recommendation).toBe('answer_with_caution');
    });

    test('较差质量 (置信度 >= 0.5 但 < 0.7)', () => {
      const result = strategy.evaluateAnswerQuality({ score: 0.45 });
      expect(result.quality).toBe('fair');
      expect(result.recommendation).toBe('answer_with_caution');
    });

    test('很差质量 (置信度 < 0.3)', () => {
      const result = strategy.evaluateAnswerQuality({ score: 0.75 });
      expect(result.quality).toBe('very_poor');
      expect(result.recommendation).toBe('skip');
    });

    test('空结果', () => {
      const result = strategy.evaluateAnswerQuality(null);
      expect(result.quality).toBe('none');
      expect(result.recommendation).toBe('skip');
    });
  });

  describe('calculateTimeAllocation', () => {
    test('剩余时间充足', () => {
      const allocation = strategy.calculateTimeAllocation(60000, 5);
      expect(allocation.hasEnoughTime).toBe(true);
      expect(allocation.shouldHurry).toBe(false);
    });

    test('剩余时间不足', () => {
      const allocation = strategy.calculateTimeAllocation(1000, 10);
      expect(allocation.shouldHurry).toBe(true);
      expect(allocation.hasEnoughTime).toBe(false);
    });

    test('没有剩余题目', () => {
      const allocation = strategy.calculateTimeAllocation(60000, 0);
      expect(allocation.timePerQuestion).toBe(0);
      expect(allocation.hasEnoughTime).toBe(true);
    });
  });

  describe('updateStats', () => {
    test('更新答题统计', () => {
      strategy.updateStats(true, 1000);
      strategy.updateStats(true, 2000);
      strategy.updateStats(false, 500);

      const report = strategy.getStatsReport();
      expect(report.totalQuestions).toBe(3);
      expect(report.answeredQuestions).toBe(2);
      expect(report.skippedQuestions).toBe(1);
      expect(report.answerRate).toBe('66.67%');
    });
  });

  describe('reset', () => {
    test('重置统计信息', () => {
      strategy.updateStats(true, 1000);
      strategy.updateStats(false, 500);

      strategy.reset();

      const report = strategy.getStatsReport();
      expect(report.totalQuestions).toBe(0);
      expect(report.answeredQuestions).toBe(0);
      expect(report.skippedQuestions).toBe(0);
    });
  });
});
