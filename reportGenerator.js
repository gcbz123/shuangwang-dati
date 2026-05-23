/**
 * 报告生成器
 * 生成详细的考试报告，支持JSON/CSV导出和可视化数据
 */

const fs = require('fs').promises;
const path = require('path');
const logger = require('./logger');

/**
 * 报告生成器类
 */
class ReportGenerator {
  constructor() {
    this.reportsDir = path.join(__dirname, 'exam_reports');
    this.chartsDir = path.join(__dirname, 'exam_reports', 'charts');
  }

  /**
   * 确保报告目录存在
   */
  async ensureDirectories() {
    try {
      await fs.mkdir(this.reportsDir, { recursive: true });
      await fs.mkdir(this.chartsDir, { recursive: true });
    } catch (error) {
      logger.error('[ReportGenerator] Failed to create directories:', error.message);
    }
  }

  /**
   * 生成完整报告
   * @param {Object} session - 考试会话对象
   * @returns {Object} 完整报告对象
   */
  async generateFullReport(session) {
    await this.ensureDirectories();

    const now = Date.now();

    // 统计数据
    const stats = this.calculateStatistics(session);

    // 答题时间分析
    const timingAnalysis = this.analyzeTiming(session);

    // 置信度分析
    const confidenceAnalysis = this.analyzeConfidence(session);

    // 题型分析
    const typeAnalysis = this.analyzeQuestionTypes(session);

    // 异常情况总结
    const abnormalities = this.summarizeAbnormalities(session);

    const report = {
      metadata: {
        sessionId: session.sessionId,
        examUrl: session.examUrl,
        mode: session.mode,
        generatedAt: new Date(now).toISOString(),
        generator: 'ReportGenerator v1.0'
      },
      timing: {
        startTime: new Date(session.startTime).toISOString(),
        endTime: session.endTime ? new Date(session.endTime).toISOString() : null,
        duration: session.endTime ? session.endTime - session.startTime : now - session.startTime,
        durationFormatted: this.formatDuration(session.endTime ? session.endTime - session.startTime : now - session.startTime)
      },
      summary: stats,
      analysis: {
        timing: timingAnalysis,
        confidence: confidenceAnalysis,
        types: typeAnalysis,
        abnormalities
      },
      questions: session.answers.map(a => this.formatQuestionAnswer(a)),
      errors: session.errorLog.map(e => this.formatError(e)),
      screenshots: session.screenshots || []
    };

    return report;
  }

  /**
   * 计算统计数据
   */
  calculateStatistics(session) {
    const answers = session.answers || [];
    const answered = answers.filter(a => !a.skipped);
    const skipped = answers.filter(a => a.skipped);

    const totalQuestions = answers.length;
    const answeredCount = answered.length;
    const skippedCount = skipped.length;

    // 平均置信度
    const avgConfidence = answered.length > 0
      ? answered.reduce((sum, a) => sum + (a.confidence || 0), 0) / answered.length
      : 0;

    // 最低置信度
    const minConfidence = answered.length > 0
      ? Math.min(...answered.map(a => a.confidence || 0))
      : 0;

    // 最高置信度
    const maxConfidence = answered.length > 0
      ? Math.max(...answered.map(a => a.confidence || 0))
      : 0;

    // 置信度分段统计
    const confidenceRanges = {
      high: answered.filter(a => a.confidence >= 0.9).length,
      medium: answered.filter(a => a.confidence >= 0.7 && a.confidence < 0.9).length,
      low: answered.filter(a => a.confidence < 0.7).length
    };

    return {
      totalQuestions,
      answered: answeredCount,
      skipped: skippedCount,
      completionRate: totalQuestions > 0 ? ((answeredCount / totalQuestions) * 100).toFixed(1) + '%' : '0%',
      confidence: {
        average: (avgConfidence * 100).toFixed(1) + '%',
        minimum: (minConfidence * 100).toFixed(1) + '%',
        maximum: (maxConfidence * 100).toFixed(1) + '%',
        ranges: confidenceRanges
      },
      errorCount: session.errorLog ? session.errorLog.length : 0
    };
  }

  /**
   * 分析答题时间
   */
  analyzeTiming(session) {
    const answers = session.answers || [];
    if (answers.length < 2) {
      return { message: 'Insufficient data for timing analysis' };
    }

    const timestamps = answers.map(a => a.timestamp).sort((a, b) => a - b);
    const intervals = [];

    for (let i = 1; i < timestamps.length; i++) {
      intervals.push(timestamps[i] - timestamps[i - 1]);
    }

    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const minInterval = Math.min(...intervals);
    const maxInterval = Math.max(...intervals);

    // 答题速度 (题/分钟)
    const totalDuration = timestamps[timestamps.length - 1] - timestamps[0];
    const speed = totalDuration > 0 ? (answers.length / totalDuration) * 60000 : 0;

    return {
      averageInterval: (avgInterval / 1000).toFixed(1) + 's',
      minimumInterval: (minInterval / 1000).toFixed(1) + 's',
      maximumInterval: (maxInterval / 1000).toFixed(1) + 's',
      speed: speed.toFixed(1) + ' 题/分钟',
      totalDuration: (totalDuration / 1000).toFixed(0) + 's',
      answerCount: answers.length
    };
  }

  /**
   * 分析置信度趋势
   */
  analyzeConfidence(session) {
    const answers = session.answers || [];
    const answered = answers.filter(a => !a.skipped && a.confidence !== undefined);

    if (answered.length < 3) {
      return { message: 'Insufficient data for confidence analysis' };
    }

    const confidences = answered.map(a => a.confidence);

    // 计算趋势
    const firstHalf = confidences.slice(0, Math.floor(confidences.length / 2));
    const secondHalf = confidences.slice(Math.floor(confidences.length / 2));

    const avgFirst = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const avgSecond = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

    let trend = 'stable';
    if (avgSecond - avgFirst > 0.1) trend = 'improving';
    else if (avgFirst - avgSecond > 0.1) trend = 'declining';

    // 置信度波动
    const variance = confidences.reduce((sum, val) => sum + Math.pow(val - confidences.reduce((a, b) => a + b, 0) / confidences.length, 2), 0) / confidences.length;
    const stdDev = Math.sqrt(variance);

    return {
      trend,
      variance: variance.toFixed(3),
      standardDeviation: stdDev.toFixed(3),
      dataPoints: confidences.map((c, i) => ({
        index: i + 1,
        confidence: (c * 100).toFixed(1) + '%'
      }))
    };
  }

  /**
   * 分析题型分布
   */
  analyzeQuestionTypes(session) {
    const questions = session.questions || [];
    const typeMap = {};

    questions.forEach((q, index) => {
      // 根据选项数量判断题型
      const optionCount = [q.option_a, q.option_b, q.option_c, q.option_d].filter(o => o && o.trim()).length;
      let type = 'unknown';

      if (optionCount === 4) type = 'single_choice';
      else if (optionCount === 2) type = 'judgment';
      else if (optionCount > 0) type = 'multiple_choice';
      else type = 'short_answer';

      if (!typeMap[type]) typeMap[type] = { count: 0, indices: [] };
      typeMap[type].count++;
      typeMap[type].indices.push(index + 1);
    });

    const total = questions.length;
    return Object.entries(typeMap).map(([type, data]) => ({
      type: this.translateType(type),
      count: data.count,
      percentage: total > 0 ? ((data.count / total) * 100).toFixed(1) + '%' : '0%',
      indices: data.indices
    }));
  }

  /**
   * 翻译题型名称
   */
  translateType(type) {
    const translations = {
      single_choice: '单选题',
      multiple_choice: '多选题',
      judgment: '判断题',
      short_answer: '简答题',
      unknown: '未知题型'
    };
    return translations[type] || type;
  }

  /**
   * 总结异常情况
   */
  summarizeAbnormalities(session) {
    const abnormalities = [];
    const answers = session.answers || [];

    // 低置信度题目过多
    const lowConfidenceAnswers = answers.filter(a => a.confidence < 0.7 && !a.skipped);
    if (lowConfidenceAnswers.length > answers.length * 0.3) {
      abnormalities.push({
        type: 'low_confidence_ratio',
        severity: 'warning',
        message: `低置信度题目占比: ${((lowConfidenceAnswers.length / answers.length) * 100).toFixed(1)}%`,
        affected: lowConfidenceAnswers.length
      });
    }

    // 跳过题目过多
    const skippedAnswers = answers.filter(a => a.skipped);
    if (skippedAnswers.length > answers.length * 0.2) {
      abnormalities.push({
        type: 'high_skip_ratio',
        severity: 'warning',
        message: `跳过题目占比: ${((skippedAnswers.length / answers.length) * 100).toFixed(1)}%`,
        affected: skippedAnswers.length
      });
    }

    // 错误次数
    if (session.errorLog && session.errorLog.length > 3) {
      abnormalities.push({
        type: 'high_error_count',
        severity: 'error',
        message: `错误次数: ${session.errorLog.length}`,
        errors: session.errorLog.map(e => e.error).slice(0, 3)
      });
    }

    return abnormalities;
  }

  /**
   * 格式化题目和答案
   */
  formatQuestionAnswer(answer) {
    return {
      index: answer.questionIndex + 1,
      question: answer.question ? answer.question.substring(0, 200) : '',
      answer: answer.answer,
      confidence: answer.confidence !== undefined ? (answer.confidence * 100).toFixed(1) + '%' : 'N/A',
      skipped: answer.skipped,
      skippedReason: answer.reason,
      timestamp: answer.timestamp ? new Date(answer.timestamp).toISOString() : null
    };
  }

  /**
   * 格式化错误信息
   */
  formatError(error) {
    return {
      timestamp: error.timestamp ? new Date(error.timestamp).toISOString() : null,
      error: error.error || 'Unknown error',
      context: error.context || {}
    };
  }

  /**
   * 保存JSON格式报告
   */
  async saveJsonReport(session) {
    await this.ensureDirectories();

    const report = await this.generateFullReport(session);
    const reportPath = path.join(this.reportsDir, `${session.sessionId}.json`);

    try {
      await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf-8');
      logger.info(`[ReportGenerator] JSON report saved: ${reportPath}`);
      return reportPath;
    } catch (error) {
      logger.error('[ReportGenerator] Failed to save JSON report:', error.message);
      throw error;
    }
  }

  /**
   * 保存CSV格式报告
   */
  async saveCsvReport(session) {
    await this.ensureDirectories();

    const report = await this.generateFullReport(session);
    const csvPath = path.join(this.reportsDir, `${session.sessionId}.csv`);

    try {
      // CSV头部
      const headers = ['Index', 'Question', 'Answer', 'Confidence', 'Skipped', 'Reason', 'Timestamp'];

      // 构建CSV内容
      const csvRows = [headers.join(',')];

      for (const qa of report.questions) {
        const row = [
          qa.index,
          this.escapeCsv(qa.question),
          this.escapeCsv(qa.answer || ''),
          qa.confidence,
          qa.skipped,
          this.escapeCsv(qa.skippedReason || ''),
          qa.timestamp
        ];
        csvRows.push(row.join(','));
      }

      const csvContent = csvRows.join('\n');
      await fs.writeFile(csvPath, csvContent, 'utf-8');

      logger.info(`[ReportGenerator] CSV report saved: ${csvPath}`);
      return csvPath;
    } catch (error) {
      logger.error('[ReportGenerator] Failed to save CSV report:', error.message);
      throw error;
    }
  }

  /**
   * 转义CSV字段
   */
  escapeCsv(field) {
    if (field === null || field === undefined) return '';
    const str = String(field);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  /**
   * 生成HTML格式报告
   */
  async saveHtmlReport(session) {
    await this.ensureDirectories();

    const report = await this.generateFullReport(session);
    const htmlPath = path.join(this.reportsDir, `${session.sessionId}.html`);

    try {
      const html = this.generateHtmlTemplate(report);
      await fs.writeFile(htmlPath, html, 'utf-8');

      logger.info(`[ReportGenerator] HTML report saved: ${htmlPath}`);
      return htmlPath;
    } catch (error) {
      logger.error('[ReportGenerator] Failed to save HTML report:', error.message);
      throw error;
    }
  }

  /**
   * 生成HTML报告模板
   */
  generateHtmlTemplate(report) {
    const summary = report.summary;
    const timing = report.timing;
    const analysis = report.analysis;

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>考试报告 - ${report.metadata.sessionId}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #f5f5f5; padding: 20px; }
    .container { max-width: 1200px; margin: 0 auto; background: white; border-radius: 8px; padding: 30px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    h1 { color: #333; margin-bottom: 10px; }
    h2 { color: #555; margin-top: 30px; margin-bottom: 15px; border-bottom: 2px solid #eee; padding-bottom: 10px; }
    .metadata { background: #f9f9f9; padding: 15px; border-radius: 4px; margin-bottom: 20px; }
    .metadata p { margin: 5px 0; color: #666; }
    .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin: 20px 0; }
    .summary-card { background: #f8f9fa; padding: 20px; border-radius: 6px; text-align: center; }
    .summary-card .label { color: #666; font-size: 14px; margin-bottom: 5px; }
    .summary-card .value { font-size: 24px; font-weight: bold; color: #333; }
    .summary-card.highlight .value { color: #4CAF50; }
    .summary-card.warning .value { color: #FF9800; }
    table { width: 100%; border-collapse: collapse; margin-top: 15px; }
    th, td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
    th { background: #f5f5f5; font-weight: 600; }
    .skipped { color: #999; }
    .confidence-bar { display: inline-block; height: 20px; background: #e0e0e0; border-radius: 10px; overflow: hidden; }
    .confidence-fill { height: 100%; background: #4CAF50; transition: width 0.3s; }
    .abnormality { padding: 10px; margin: 10px 0; border-left: 4px solid; background: #f9f9f9; }
    .abnormality.warning { border-color: #FF9800; }
    .abnormality.error { border-color: #f44336; }
  </style>
</head>
<body>
  <div class="container">
    <h1>考试报告</h1>

    <div class="metadata">
      <p><strong>会话ID:</strong> ${report.metadata.sessionId}</p>
      <p><strong>考试地址:</strong> ${report.metadata.examUrl}</p>
      <p><strong>模式:</strong> ${report.metadata.mode}</p>
      <p><strong>开始时间:</strong> ${timing.startTime}</p>
      <p><strong>结束时间:</strong> ${timing.endTime}</p>
      <p><strong>持续时间:</strong> ${timing.durationFormatted}</p>
    </div>

    <h2>概览统计</h2>
    <div class="summary-grid">
      <div class="summary-card">
        <div class="label">总题目数</div>
        <div class="value">${summary.totalQuestions}</div>
      </div>
      <div class="summary-card highlight">
        <div class="label">已答题数</div>
        <div class="value">${summary.answered}</div>
      </div>
      <div class="summary-card warning">
        <div class="label">跳过题数</div>
        <div class="value">${summary.skipped}</div>
      </div>
      <div class="summary-card highlight">
        <div class="label">完成率</div>
        <div class="value">${summary.completionRate}</div>
      </div>
      <div class="summary-card highlight">
        <div class="label">平均置信度</div>
        <div class="value">${summary.confidence.average}</div>
      </div>
    </div>

    <h2>置信度分布</h2>
    <div class="summary-grid">
      <div class="summary-card highlight">
        <div class="label">高置信度 (≥90%)</div>
        <div class="value">${summary.confidence.ranges.high}</div>
      </div>
      <div class="summary-card warning">
        <div class="label">中等置信度 (70-90%)</div>
        <div class="value">${summary.confidence.ranges.medium}</div>
      </div>
      <div class="summary-card">
        <div class="label">低置信度 (<70%)</div>
        <div class="value">${summary.confidence.ranges.low}</div>
      </div>
    </div>

    ${analysis.abnormalities.length > 0 ? `
    <h2>异常情况</h2>
    ${analysis.abnormalities.map(abn => `
      <div class="abnormality ${abn.severity}">
        <strong>${abn.type}:</strong> ${abn.message}
      </div>
    `).join('')}
    ` : ''}

    <h2>答题详情</h2>
    <table>
      <thead>
        <tr>
          <th>题号</th>
          <th>题目</th>
          <th>答案</th>
          <th>置信度</th>
          <th>状态</th>
        </tr>
      </thead>
      <tbody>
        ${report.questions.map(q => `
          <tr class="${q.skipped ? 'skipped' : ''}">
            <td>${q.index}</td>
            <td>${q.question}</td>
            <td>${q.answer || '-'}</td>
            <td>
              <div class="confidence-bar" style="width: 100px;">
                <div class="confidence-fill" style="width: ${q.confidence};"></div>
              </div>
              <span style="margin-left: 10px;">${q.confidence}</span>
            </td>
            <td>${q.skipped ? '跳过' : '已答'}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>

    ${report.errors.length > 0 ? `
    <h2>错误日志</h2>
    <table>
      <thead>
        <tr>
          <th>时间</th>
          <th>错误</th>
          <th>上下文</th>
        </tr>
      </thead>
      <tbody>
        ${report.errors.map(e => `
          <tr>
            <td>${e.timestamp}</td>
            <td>${e.error}</td>
            <td>${JSON.stringify(e.context)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    ` : ''}
  </div>
</body>
</html>`;
  }

  /**
   * 格式化时长
   */
  formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  /**
   * 生成所有格式的报告
   */
  async saveAllFormats(session) {
    const paths = {};

    try {
      paths.json = await this.saveJsonReport(session);
      paths.csv = await this.saveCsvReport(session);
      paths.html = await this.saveHtmlReport(session);

      return paths;
    } catch (error) {
      logger.error('[ReportGenerator] Failed to save reports:', error.message);
      throw error;
    }
  }

  /**
   * 获取已保存的报告列表
   */
  async getReportList() {
    try {
      await this.ensureDirectories();
      const files = await fs.readdir(this.reportsDir);
      const jsonFiles = files.filter(f => f.endsWith('.json'));

      const reports = [];
      for (const file of jsonFiles) {
        const filePath = path.join(this.reportsDir, file);
        const content = await fs.readFile(filePath, 'utf-8');
        const report = JSON.parse(content);

        reports.push({
          sessionId: report.metadata.sessionId,
          examUrl: report.metadata.examUrl,
          generatedAt: report.metadata.generatedAt,
          totalQuestions: report.summary.totalQuestions,
          completionRate: report.summary.completionRate,
          avgConfidence: report.summary.confidence.average,
          formats: ['json', 'csv', 'html'].map(fmt => {
            const fmtFile = file.replace('.json', `.${fmt}`);
            return { format: fmt, exists: files.includes(fmtFile) };
          })
        });
      }

      return reports;
    } catch (error) {
      logger.error('[ReportGenerator] Failed to get report list:', error.message);
      return [];
    }
  }

  /**
   * 删除报告
   */
  async deleteReport(sessionId) {
    try {
      const formats = ['json', 'csv', 'html'];
      const deleted = [];

      for (const fmt of formats) {
        const filePath = path.join(this.reportsDir, `${sessionId}.${fmt}`);
        try {
          await fs.unlink(filePath);
          deleted.push(fmt);
        } catch (error) {
          if (error.code !== 'ENOENT') {
            logger.warn(`[ReportGenerator] Failed to delete ${fmt} report:`, error.message);
          }
        }
      }

      logger.info(`[ReportGenerator] Deleted report ${sessionId}: ${deleted.join(', ')}`);
      return deleted;
    } catch (error) {
      logger.error('[ReportGenerator] Failed to delete report:', error.message);
      throw error;
    }
  }
}

module.exports = new ReportGenerator();