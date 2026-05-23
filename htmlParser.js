'use strict';

const cheerio = require('cheerio');
const iconv = require('iconv-lite');
const logger = require('./logger');

// 检查是否为有效 UTF-8（无乱码）
function isValidUTF8(str) {
  // 乱码特征：连续出现无效的 UTF-8 序列或特殊字符
  // 有效 UTF-8 中文范围是 \u4E00-\u9FA5
  const invalidPatterns = [
    /\u0000[\u0001-\u0008\u000B\u000C\u000E-\u001F]/, // 空格附近的控制字符
    /[\u0080-\u009F]/, // C1 控制字符
    /[\uFFFE\uFFFF]/, // 非字符
  ];
  for (const pattern of invalidPatterns) {
    if (pattern.test(str)) return false;
  }
  // 检查是否包含大量乱码特征的字符
  const suspiciousChars = str.match(
    /[^\u4E00-\u9FA5\u3000-\u303F\uFF00-\uFFEFa-zA-Z0-9\s\r\n\t,。.，、！？!?;；:：""''（）【】《》\-\+_=()\[\]{}./\\|@#%^&*~`<>]/g
  );
  if (suspiciousChars && suspiciousChars.length > str.length * 0.1) {
    return false;
  }
  return true;
}

/**
 * 从 HTML 中提取题目和选项。
 * 针对使用 Ant Design 组件的 Vue 答题系统。
 */
function extractQuestions(htmlContent) {
  // 编码处理：优先尝试 UTF-8，如果失败再尝试 GBK
  if (Buffer.isBuffer(htmlContent)) {
    // 先尝试 UTF-8 解码
    try {
      const utf8Str = htmlContent.toString('utf-8');
      // 检查是否有效的 UTF-8（无乱码特征）
      if (isValidUTF8(utf8Str)) {
        htmlContent = utf8Str;
      } else {
        // UTF-8 失败，尝试 GBK
        htmlContent = iconv.decode(htmlContent, 'gbk');
      }
    } catch (_) {
      // UTF-8 失败，尝试 GBK
      try {
        htmlContent = iconv.decode(htmlContent, 'gbk');
      } catch (_2) {
        htmlContent = htmlContent.toString('utf-8');
      }
    }
  } else if (typeof htmlContent === 'string') {
    // 检测是否为乱码（GBK 被当作 UTF-8 或反之）
    const hasHighBytes = /[\x81-\xFE]/.test(htmlContent);
    if (hasHighBytes) {
      // 先按 UTF-8 处理，检测是否有效
      if (!isValidUTF8(htmlContent)) {
        // UTF-8 无效，尝试 GBK
        try {
          const buf = Buffer.from(htmlContent, 'latin1');
          htmlContent = iconv.decode(buf, 'gbk');
          logger.debug('GBK 编码转换成功');
        } catch (e) {
          logger.debug('GBK 编码转换失败:', e.message);
        }
      }
    }
  }

  // 加载 HTML 到 Cheerio，使用 UTF-8 解码实体
  const $ = cheerio.load(htmlContent, { decodeEntities: 'utf8' });
  const questions = [];

  // 方法1: 查找 .ti 类（原有方式）
  $('.ti').each((_i, el) => {
    const $ti = $(el);

    // 提取题干
    let question = '';
    const pEls = $ti.find('.nr .p-inline > p, .nr .p-inline');
    if (pEls.length > 0) {
      question = $(pEls[0]).text().trim();

      // 清理重复内容
      const colonIdx = question.lastIndexOf('。');
      if (colonIdx > 0) {
        const firstPart = question.substring(0, colonIdx + 1);
        const rest = question.substring(colonIdx + 1);
        if (rest.includes(firstPart.substring(0, 20))) {
          question = firstPart;
        }
      }
    }

    // 回退提取方式
    if (!question) {
      const nrText = $ti.find('.nr').text();
      const startIdx = nrText.indexOf('、');
      if (startIdx > 0 && startIdx < 50) {
        question = nrText.substring(startIdx + 1).trim();
        question = question.split(/[A-Z]\s{0,3}$/)[0];
        question = question.split(/\s{2,}/)[0];
      }
    }

    // 提取选项
    let option_a = '', option_b = '', option_c = '', option_d = '';
    const radioLabels = $ti.find('.ant-radio-wrapper, .ant-checkbox-wrapper');
    radioLabels.each((_j, label) => {
      const text = $(label).text().trim();
      const match = text.match(/^([A-D])[.\s]+(.+)/);
      if (match) {
        const letter = match[1].toUpperCase();
        const content = match[2].trim();
        if (letter === 'A') option_a = option_a || content;
        else if (letter === 'B') option_b = option_b || content;
        else if (letter === 'C') option_c = option_c || content;
        else if (letter === 'D') option_d = option_d || content;
      }
    });

    if (question) {
      questions.push({ question, option_a, option_b, option_c, option_d });
    }
  });

  // 方法2: 查找 ant-radio-group（新车务段系统）
  if (questions.length === 0) {
    const groups = $('.ant-radio-group');
    groups.each((_i, el) => {
      const $group = $(el);
      const radioOptions = $group.find('.ant-radio-wrapper');

      if (radioOptions.length === 0) return;

      // 获取题目：第一个选项的文本中的问题部分
      let optionText = '';
      let question = '';
      let option_a = '', option_b = '', option_c = '', option_d = '';

      radioOptions.each((idx, opt) => {
        const text = $(opt).text().trim();
        // 格式: "A. 答案内容" 或 "A、答案内容"
        const match = text.match(/^([A-D])[.、\s]+(.+)/);
        if (match) {
          const letter = match[1].toUpperCase();
          const content = match[2].trim();

          if (idx === 0) {
            // 第一个选项：提取问题文本（去掉答案部分）
            // 问题格式通常是 "N、问题内容" 或类似格式
            optionText = text;
            // 查找题目：通常第一个选项前面是问题
            const parent = $group.parent();
            // 尝试从父元素获取问题文本
            const questionEl = $group.prev();
            if (questionEl.length && questionEl[0].type === 'tag') {
              const qText = questionEl.text().trim();
              if (qText && !qText.match(/^[A-D][.、]/)) {
                question = qText;
              }
            }
            // 如果没找到，从当前选项提取
            if (!question) {
              // 从 text 中提取问题（假设格式为 "N. 问题? A. 答案"）
              const parts = text.split(/[A-D][.、\s]+/);
              if (parts.length > 1) {
                // 问题在答案之前
                const qMatch = optionText.match(/^(\d+[.、]?.+?)([A-D])/);
                if (qMatch) {
                  question = qMatch[1].replace(/^[A-D][.、]\s*/, '').trim();
                }
              }
            }
          }

          // 提取答案选项
          if (letter === 'A') option_a = content;
          else if (letter === 'B') option_b = content;
          else if (letter === 'C') option_c = content;
          else if (letter === 'D') option_d = content;
        }
      });

      // 从第一个选项提取问题
      if (!question && optionText) {
        // 尝试提取问题部分（去掉答案字母和内容）
        const cleanQ = optionText.replace(/^[A-D][.、]\s*/, '').trim();
        // 如果包含其他答案字母，可能是问题
        if (!cleanQ.match(/^[A-D][.、]/)) {
          question = cleanQ;
        } else {
          question = optionText;
        }
      }

      if (question && (option_a || option_b || option_c || option_d)) {
        questions.push({ question, option_a, option_b, option_c, option_d });
      }
    });
  }

  // 方法3: 直接从 label 文本提取（更简单的方式）
  if (questions.length === 0) {
    const allRadios = $('.ant-radio-wrapper');
    let currentQuestion = '';
    let currentOptions = [];

    allRadios.each((idx, el) => {
      const text = $(el).text().trim();
      const match = text.match(/^([A-D])[.、]\s*(.+)/);

      if (match) {
        const letter = match[1].toUpperCase();
        const content = match[2].trim();

        // 保存当前选项
        if (letter === 'A') currentOptions[0] = content;
        else if (letter === 'B') currentOptions[1] = content;
        else if (letter === 'C') currentOptions[2] = content;
        else if (letter === 'D') currentOptions[3] = content;
      } else if (text && !text.match(/^[A-D]/)) {
        // 这是问题文本
        if (currentQuestion && currentOptions.some(o => o)) {
          // 保存上一道题
          questions.push({
            question: currentQuestion,
            option_a: currentOptions[0] || '',
            option_b: currentOptions[1] || '',
            option_c: currentOptions[2] || '',
            option_d: currentOptions[3] || ''
          });
        }
        // 开始新题目
        currentQuestion = text;
        currentOptions = [];
      }
    });

    // 保存最后一题
    if (currentQuestion && currentOptions.some(o => o)) {
      questions.push({
        question: currentQuestion,
        option_a: currentOptions[0] || '',
        option_b: currentOptions[1] || '',
        option_c: currentOptions[2] || '',
        option_d: currentOptions[3] || ''
      });
    }
  }

  // 方法4: 局网考试（ASP.NET WebForms）
  // 特征：div[id^="pt"] 容器 + span 题干 + table 内 radio 选项
  if (questions.length === 0) {
    // 匹配 id 以 "pt" 开头的 div 元素
    $('div[id^="pt"]').each((_i, el) => {
      const $container = $(el);

      // 提取题干：查找包含题号的 span 或 div
      // 优先找 font-size: 11pt 的 span，通常是题干
      let $qSpan = $container.find('span').filter((_, el) => $(el).text().match(/^\d+[.、]/));
      if ($qSpan.length === 0) {
        // 回退：找第一个非空的 span
        $qSpan = $container.find('span').first();
      }
      
      if (!$qSpan.length) return;

      let rawText = $qSpan.text().trim();
      // 去掉题号（如 "1. " 或 "1、"）
      const questionMatch = rawText.match(/^\d+[.、\s]+\s*(.+)/);
      const question = questionMatch ? questionMatch[1].trim() : rawText;

      if (!question) return;

      // 提取选项：
      // 策略 A: 查找 label 元素
      let option_a = '', option_b = '', option_c = '', option_d = '';
      const labels = $container.find('label');
      
      function parseOptionText(text) {
        if (!text) return null;
        text = text.trim();
        // 兼容全角点（A．）、半角点（A.）、顿号（A、）以及空格（A 内容）
        // 注意：全角点 \uff0e
        const match = text.match(/^([A-D])[．.\uff0e、]\s*(.+)/i);
        if (match) {
          return { letter: match[1].toUpperCase(), content: match[2].trim() };
        }
        return null;
      }

      if (labels.length > 0) {
        labels.each((_j, label) => {
          const text = $(label).text();
          const parsed = parseOptionText(text);
          if (parsed) {
            if (parsed.letter === 'A') option_a = option_a || parsed.content;
            else if (parsed.letter === 'B') option_b = option_b || parsed.content;
            else if (parsed.letter === 'C') option_c = option_c || parsed.content;
            else if (parsed.letter === 'D') option_d = option_d || parsed.content;
          }
        });
      }

      // 策略 B: 如果 label 没提取到，尝试从 td 文本提取
      if (!option_a && !option_b && !option_c && !option_d) {
        const tds = $container.find('table td');
        tds.each((_j, td) => {
          const text = $(td).text();
          const parsed = parseOptionText(text);
          if (parsed) {
            if (parsed.letter === 'A') option_a = option_a || parsed.content;
            else if (parsed.letter === 'B') option_b = option_b || parsed.content;
            else if (parsed.letter === 'C') option_c = option_c || parsed.content;
            else if (parsed.letter === 'D') option_d = option_d || parsed.content;
          }
        });
      }

      if (question) {
        // 检测是否为多选题（checkbox 而非 radio）
        const checkboxes = $container.find('input[type="checkbox"]').length;
        const radios = $container.find('input[type="radio"]').length;
        const optionCount = [option_a, option_b, option_c, option_d].filter(o => o && o.trim()).length;
        let detectedType = 'single';
        if (checkboxes > 0 && radios === 0) detectedType = 'multiple';
        else if (optionCount === 2) detectedType = 'judgment';

        // 即使选项没提取全，也返回题目，由后端尝试处理
        questions.push({ question, option_a, option_b, option_c, option_d, detected_type: detectedType });
      }
    });
  }

  return questions.length > 0 ? questions : null;
}

module.exports = { extractQuestions };
