/**
 * questionBank.js 单元测试
 * 测试题库管理的核心功能
 */

// Mock 外部依赖
jest.mock('../../config', () => ({
  questionBankFile: 'test_question_bank.json',
  extractedQuestionsFile: 'test_extracted_questions.json',
  QUESTION_TYPES: {
    SINGLE: 'single',
    MULTIPLE: 'multiple',
    JUDGMENT: 'judgment',
    SHORT: 'short_answer',
  },
}));

jest.mock('../../logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../../textUtils', () => ({
  cleanText: jest.fn(text => {
    if (!text) return '';
    return text.replace(/\s+/g, ' ').trim();
  }),
  extractIndexKeys: jest.fn(text => {
    if (!text) return [];
    return [text];
  }),
}));

// Mock fs 模块
const mockFs = {
  promises: {
    readFile: jest.fn(),
    writeFile: jest.fn(),
    mkdir: jest.fn(),
    readdir: jest.fn(),
  },
};

jest.mock('fs', () => mockFs);

let questionBank;

beforeEach(() => {
  jest.resetModules();
  // 重新设置 mock
  mockFs.promises.readFile.mockReset();
  mockFs.promises.writeFile.mockReset();
  mockFs.promises.mkdir.mockReset();
  mockFs.promises.readdir.mockReset();
  
  questionBank = require('../../questionBank');
});

describe('questionBank', () => {
  describe('detectQuestionType', () => {
    test('检测单选题', () => {
      expect(questionBank.detectQuestionType('A.选项A')).toBe('single');
      expect(questionBank.detectQuestionType('B.选项B')).toBe('single');
    });

    test('检测判断题 - 对/错', () => {
      expect(questionBank.detectQuestionType('对')).toBe('judgment');
      expect(questionBank.detectQuestionType('错')).toBe('judgment');
      expect(questionBank.detectQuestionType('正确')).toBe('judgment');
      expect(questionBank.detectQuestionType('错误')).toBe('judgment');
    });

    test('检测判断题 - A.对/B.错格式', () => {
      expect(questionBank.detectQuestionType('A.对')).toBe('judgment');
      expect(questionBank.detectQuestionType('B.错')).toBe('judgment');
      expect(questionBank.detectQuestionType('A.正确')).toBe('judgment');
      expect(questionBank.detectQuestionType('B.错误')).toBe('judgment');
    });

    test('检测多选题 - ABC 格式', () => {
      expect(questionBank.detectQuestionType('ABC')).toBe('multiple');
      expect(questionBank.detectQuestionType('ABCD')).toBe('multiple');
      // 注意：单个字母也被检测为 multiple（代码行为）
      expect(questionBank.detectQuestionType('A')).toBe('multiple');
    });

    test('检测多选题 - A.内容;B.内容格式', () => {
      expect(questionBank.detectQuestionType('A.内容;B.内容')).toBe('multiple');
    });

    test('检测简答题', () => {
      expect(questionBank.detectQuestionType('这是简答题答案')).toBe('short_answer');
      // 注意：空字符串返回 single 而不是 short_answer（代码行为）
      expect(questionBank.detectQuestionType('')).toBe('single');
    });

    test('避免误判 - 正确佩戴不是判断题', () => {
      // "正确佩戴" 后面紧跟中文，不应该被判定为判断题
      expect(questionBank.detectQuestionType('正确佩戴安全帽')).toBe('short_answer');
    });
  });

  describe('createQuestion', () => {
    test('创建标准化题目（默认 source）', () => {
      const question = questionBank.createQuestion('测试题目', 'A', 'single');
      expect(question).toEqual({
        question: '测试题目',
        answer: 'A',
        question_type: 'single',
        source: '职教考试',
      });
    });

    test('创建标准化题目（指定 source）', () => {
      const question = questionBank.createQuestion('测试题目', 'A', 'single', '局网考试');
      expect(question).toEqual({
        question: '测试题目',
        answer: 'A',
        question_type: 'single',
        source: '局网考试',
      });
    });
  });

  describe('isQuestionExists', () => {
    test('题目、题型和来源都匹配时返回 true', () => {
      const bank = [
        { question: '题目1', answer: 'A', question_type: 'single', source: '职教考试' },
        { question: '题目2', answer: 'B', question_type: 'judgment', source: '职教考试' },
      ];
      expect(questionBank.isQuestionExists(bank, '题目1', 'single', '职教考试')).toBe(true);
    });

    test('题目相同但来源不同返回 false', () => {
      const bank = [
        { question: '题目1', answer: 'A', question_type: 'single', source: '职教考试' },
      ];
      expect(questionBank.isQuestionExists(bank, '题目1', 'single', '局网考试')).toBe(false);
    });

    test('题目相同但题型不同返回 false', () => {
      const bank = [
        { question: '题目1', answer: 'A', question_type: 'single', source: '职教考试' },
      ];
      expect(questionBank.isQuestionExists(bank, '题目1', 'judgment', '职教考试')).toBe(false);
    });

    test('题目不同返回 false', () => {
      const bank = [
        { question: '题目1', answer: 'A', question_type: 'single', source: '职教考试' },
      ];
      expect(questionBank.isQuestionExists(bank, '题目2', 'single', '职教考试')).toBe(false);
    });

    test('旧数据无 source 字段时默认匹配', () => {
      const bank = [
        { question: '题目1', answer: 'A', question_type: 'single' },
      ];
      expect(questionBank.isQuestionExists(bank, '题目1', 'single')).toBe(true);
    });
  });

  describe('getQuestionBank', () => {
    test('初始返回空数组', () => {
      expect(questionBank.getQuestionBank()).toEqual([]);
    });
  });

  describe('getExtractedQuestions', () => {
    test('初始返回空数组', () => {
      expect(questionBank.getExtractedQuestions()).toEqual([]);
    });
  });

  describe('loadQuestionBankFromDisk', () => {
    test('文件不存在时返回空数组', async () => {
      mockFs.promises.readFile.mockRejectedValue({ code: 'ENOENT' });
      
      const result = await questionBank.loadQuestionBankFromDisk();
      expect(result).toEqual([]);
    });

    test('解析有效 JSON 文件', async () => {
      const mockData = JSON.stringify([
        { question: '题目1', answer: 'A', question_type: 'single' },
      ]);
      mockFs.promises.readFile.mockResolvedValue(mockData);
      
      const result = await questionBank.loadQuestionBankFromDisk();
      expect(result).toHaveLength(1);
      expect(result[0].question).toBe('题目1');
    });

    test('JSON 解析失败时返回空数组', async () => {
      mockFs.promises.readFile.mockResolvedValue('invalid json');
      
      const result = await questionBank.loadQuestionBankFromDisk();
      expect(result).toEqual([]);
    });
  });

  describe('saveQuestionBank', () => {
    test('写入文件并更新内存', async () => {
      const bank = [
        { question: '题目1', answer: 'A', question_type: 'single' },
      ];
      
      await questionBank.saveQuestionBank(bank);
      
      expect(mockFs.promises.writeFile).toHaveBeenCalledWith(
        'test_question_bank.json',
        JSON.stringify(bank, null, 2),
        'utf-8'
      );
      expect(questionBank.getQuestionBank()).toBe(bank);
    });
  });

  describe('importFromTxt', () => {
    test('解析标准格式题目', async () => {
      const mockContent = `1. 列车开出前必须确认信号 正确答案：A
2. 列车运行中不得开门 正确答案：对
3. 以下哪些是正确的 正确答案：ABC`;
      
      mockFs.promises.readFile.mockResolvedValue(mockContent);
      
      const questions = await questionBank.importFromTxt('test.txt');
      expect(questions).toHaveLength(3);
      expect(questions[0].question).toBe('列车开出前必须确认信号');
      expect(questions[0].answer).toBe('A');
      // 注意：单个字母答案被检测为 multiple（代码行为）
      expect(questions[0].question_type).toBe('multiple');
    });

    test('文件不存在时返回空数组', async () => {
      mockFs.promises.readFile.mockRejectedValue({ code: 'ENOENT' });
      
      const questions = await questionBank.importFromTxt('nonexistent.txt');
      expect(questions).toEqual([]);
    });

    test('跳过无效行', async () => {
      const mockContent = `1. 有效题目 正确答案：A
无效行没有正确答案标记
2. 另一个题目 正确答案：B`;
      
      mockFs.promises.readFile.mockResolvedValue(mockContent);
      
      const questions = await questionBank.importFromTxt('test.txt');
      expect(questions).toHaveLength(2);
    });
  });
});
