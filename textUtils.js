'use strict';

/**
 * 全角 → 半角，合并空白，去除首尾引号。
 */
function cleanText(text) {
  if (!text) return text;

  // 逐字符处理：全角转半角、合并空白
  const result = [];
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (code === 0x3000) {
      // 全角空格 → 半角空格
      result.push(' ');
    } else if (code >= 0xFF01 && code <= 0xFF5E) {
      // 全角字母/数字/符号 → 半角
      result.push(String.fromCharCode(code - 0xFEE0));
    } else {
      result.push(char);
    }
  }

  let cleaned = result.join('').trim();
  cleaned = cleaned.replace(/\s+/g, ' ');         // 合并连续空白为一个空格
  // 归一化括号内空白：( ) → ()，解决全角/半角括号空格差异
  cleaned = cleaned.replace(/\(\s+\)/g, '()');
  cleaned = cleaned.replace(/^[""\\'\"']+|[""\\'\"']+$/g, '');  // 去除首尾引号
  return cleaned;
}

/**
 * 提取用于倒排索引的 key 集合：全文 + 连续中文词片段。
 */
function extractIndexKeys(text) {
  const cleaned = cleanText(text || '');
  if (!cleaned) return [];
  const keySet = new Set([cleaned]);
  const words = cleaned.match(/[\u4e00-\u9fa5]{2,}/g) || [];
  for (const word of words) keySet.add(word);
  return Array.from(keySet);
}

module.exports = { cleanText, extractIndexKeys };
