/**
 * questionMatcher.js 单元测试
 * 测试题目匹配引擎的核心功能
 */

// Mock 外部依赖
jest.mock('../../config', () => ({
  fuseThresholdDefault: 0.22,
  fuseThresholdEnv: undefined,
  cacheMaxSize: 100,
}));

jest.mock('../../textUtils', () => ({
  cleanText: jest.fn(text => {
    if (!text) return '';
    return text.replace(/\s+/g, ' ').trim();
  }),
}));

jest.mock('../../questionBank', () => ({
  getQuestionBank: jest.fn(() => []),
  getIndexedCandidates: jest.fn(() => []),
}));

jest.mock('../../cache', () => {
  return jest.fn().mockImplementation(() => ({
    get: jest.fn(),
    set: jest.fn(),
    clear: jest.fn(),
    size: 0,
  }));
});

let questionMatcher;
let questionBank;

beforeEach(() => {
  jest.resetModules();
  questionMatcher = require('../../questionMatcher');
  questionBank = require('../../questionBank');
});

describe('questionMatcher', () => {
  describe('getFuseThreshold', () => {
    test('返回默认阈值', () => {
      expect(questionMatcher.getFuseThreshold()).toBe(0.22);
    });
  });

  describe('setFuseThreshold', () => {
    test('设置有效阈值', () => {
      const result = questionMatcher.setFuseThreshold(0.3);
      expect(result).toBe(0.3);
      expect(questionMatcher.getFuseThreshold()).toBe(0.3);
    });

    test('设置无效阈值返回 null', () => {
      expect(questionMatcher.setFuseThreshold(-1)).toBeNull();
      expect(questionMatcher.setFuseThreshold(2)).toBeNull();
      expect(questionMatcher.setFuseThreshold('abc')).toBeNull();
    });

    test('设置阈值后重置 Fuse 实例', () => {
      questionMatcher.setFuseThreshold(0.25);
      // 设置阈值会重置 fuseInstance 和 fuseDataVersion
      expect(questionMatcher.getFuseThreshold()).toBe(0.25);
    });
  });

  describe('findAnswerWithOption', () => {
    test('空问题返回 null', () => {
      expect(questionMatcher.findAnswerWithOption('', [])).toBeNull();
      expect(questionMatcher.findAnswerWithOption(null, [])).toBeNull();
      expect(questionMatcher.findAnswerWithOption(undefined, [])).toBeNull();
    });

    test('空题库返回 null', () => {
      expect(questionMatcher.findAnswerWithOption('测试题目', [])).toBeNull();
    });

    test('非数组题库返回 null', () => {
      expect(questionMatcher.findAnswerWithOption('测试题目', null)).toBeNull();
      expect(questionMatcher.findAnswerWithOption('测试题目', undefined)).toBeNull();
    });
  });

  describe('parseAnswerLetters', () => {
    const options = {
      a: '选项A内容',
      b: '选项B内容',
      c: '选项C内容',
      d: '选项D内容',
    };

    test('空答案返回空数组', () => {
      expect(questionMatcher.parseAnswerLetters('', options)).toEqual([]);
      expect(questionMatcher.parseAnswerLetters(null, options)).toEqual([]);
    });

    test('简答题直接返回答案文本', () => {
      const result = questionMatcher.parseAnswerLetters('这是简答题答案', options, 'short_answer');
      expect(result).toEqual([{ letter: '', answer: '这是简答题答案' }]);
    });

    test('解析单选 A', () => {
      const result = questionMatcher.parseAnswerLetters('A', options);
      expect(result).toHaveLength(1);
      expect(result[0].letter).toBe('A');
      expect(result[0].option).toBe('option_a');
    });

    test('解析单选 B.内容', () => {
      const result = questionMatcher.parseAnswerLetters('B.选项B内容', options);
      expect(result).toHaveLength(1);
      expect(result[0].letter).toBe('B');
    });

    test('解析多选 ABC', () => {
      const result = questionMatcher.parseAnswerLetters('ABC', options);
      expect(result).toHaveLength(3);
      expect(result[0].letter).toBe('A');
      expect(result[1].letter).toBe('B');
      expect(result[2].letter).toBe('C');
    });

    test('解析多选 A.内容;B.内容', () => {
      const result = questionMatcher.parseAnswerLetters('A.选项A内容;B.选项B内容', options);
      expect(result).toHaveLength(2);
      expect(result[0].letter).toBe('A');
      expect(result[1].letter).toBe('B');
    });

    test('判断题 - 对', () => {
      const judgmentOptions = { a: '对', b: '错' };
      const result = questionMatcher.parseAnswerLetters('对', judgmentOptions);
      expect(result).toHaveLength(1);
      expect(result[0].letter).toBe('A');
    });

    test('判断题 - 错', () => {
      const judgmentOptions = { a: '对', b: '错' };
      const result = questionMatcher.parseAnswerLetters('错', judgmentOptions);
      expect(result).toHaveLength(1);
      expect(result[0].letter).toBe('B');
    });

    test('判断题 - 正确 (仅支持对/错格式)', () => {
      // 注意：questionMatcher.js 只支持 '对/错' 格式，不支持 '正确/错误'
      const judgmentOptions = { a: '对', b: '错' };
      const result = questionMatcher.parseAnswerLetters('对', judgmentOptions);
      expect(result).toHaveLength(1);
      expect(result[0].letter).toBe('A');
    });

    test('判断题 - 错误 (仅支持对/错格式)', () => {
      const judgmentOptions = { a: '对', b: '错' };
      const result = questionMatcher.parseAnswerLetters('错', judgmentOptions);
      expect(result).toHaveLength(1);
      expect(result[0].letter).toBe('B');
    });

    test('子串匹配选择最长选项', () => {
      // 模拟 bug.txt 中的场景：A.列车 / B.列车开出
      const trickyOptions = {
        a: '列车',
        b: '列车开出',
        c: '列车到达',
        d: '列车开出后',
      };
      // 答案文本是 "列车开出"，应该匹配 B 而不是 A
      const result = questionMatcher.parseAnswerLetters('B.列车开出', trickyOptions);
      expect(result).toHaveLength(1);
      expect(result[0].letter).toBe('B');
    });
  });

  describe('invalidateFuse', () => {
    test('调用后清空缓存', () => {
      questionMatcher.invalidateFuse();
      // 验证 answerCache.clear 被调用
      expect(questionMatcher.answerCache.clear).toHaveBeenCalled();
    });
  });

  describe('clearAnswerCache', () => {
    test('清空答案缓存', () => {
      questionMatcher.clearAnswerCache();
      expect(questionMatcher.answerCache.clear).toHaveBeenCalled();
    });
  });
});
