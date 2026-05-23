/**
 * textUtils.js 单元测试
 * 测试文本处理工具函数
 */

const { cleanText, extractIndexKeys } = require('../../textUtils');

describe('textUtils', () => {
  describe('cleanText', () => {
    test('去除前后空格', () => {
      expect(cleanText('  hello  ')).toBe('hello');
    });

    test('全角转半角 - 字母', () => {
      expect(cleanText('ＡＢＣ')).toBe('ABC');
    });

    test('全角转半角 - 数字', () => {
      expect(cleanText('１２３')).toBe('123');
    });

    test('全角空格转半角', () => {
      expect(cleanText('hello\u3000world')).toBe('hello world');
    });

    test('合并连续空白', () => {
      expect(cleanText('hello\n\nworld')).toBe('hello world');
      expect(cleanText('hello\t\tworld')).toBe('hello world');
    });

    test('去除首尾引号', () => {
      expect(cleanText('"hello"')).toBe('hello');
      expect(cleanText("'hello'")).toBe('hello');
    });

    test('空字符串', () => {
      expect(cleanText('')).toBe('');
      expect(cleanText('   ')).toBe('');
    });

    test('null/undefined 原样返回', () => {
      expect(cleanText(null)).toBeNull();
      expect(cleanText(undefined)).toBeUndefined();
    });
  });

  describe('extractIndexKeys', () => {
    test('提取完整文本', () => {
      const keys = extractIndexKeys('列车开出前');
      expect(keys).toContain('列车开出前');
    });

    test('提取连续中文词 (>=2字)', () => {
      const keys = extractIndexKeys('列车开出');
      // extractIndexKeys 提取的是完整的连续中文词，不是分词
      expect(keys).toContain('列车开出');
    });

    test('混合文本', () => {
      const keys = extractIndexKeys('第1题：列车开出');
      // 全角冒号会被 cleanText 转换为半角
      expect(keys).toContain('第1题:列车开出');
      expect(keys).toContain('列车开出');
    });

    test('空字符串', () => {
      const keys = extractIndexKeys('');
      expect(keys).toEqual([]);
    });

    test('null 输入', () => {
      const keys = extractIndexKeys(null);
      expect(keys).toEqual([]);
    });
  });
});
