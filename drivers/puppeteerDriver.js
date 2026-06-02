/**
 * Puppeteer驱动实现
 * 完全自动化的Chrome浏览器控制
 */

const BrowserDriver = require('../browserDriver');
const puppeteer = require('puppeteer');
const logger = require('../logger');
const path = require('path');

class PuppeteerDriver extends BrowserDriver {
  constructor(options = {}) {
    super('puppeteer');
    this.browser = null;
    this.page = null;
    this.options = {
      headless: false, // 默认非无头模式，降低检测风险
      slowMo: options.slowMo || 0,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1920,1080'
      ],
      ...options
    };
  }

  /**
   * 启动浏览器并导航到URL
   * @param {string} url - 目标URL
   * @returns {Promise<void>}
   */
  async navigate(url) {
    try {
      if (!this.browser) {
        await this.launchBrowser();
      }

      logger.info(`[PuppeteerDriver] Navigating to: ${url}`);
      await this.page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: 30000
      });

      // 注入反检测脚本
      await this.injectAntiDetectionScript();

      this.isConnected = true;
    } catch (error) {
      logger.error('[PuppeteerDriver] Navigation failed:', error.message);
      throw error;
    }
  }

  /**
   * 启动浏览器实例
   */
  async launchBrowser() {
    this.browser = await puppeteer.launch(this.options);
    this.page = await this.browser.newPage();

    // 设置视口
    await this.page.setViewport({ width: 1920, height: 1080 });

    // 设置User-Agent
    await this.page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    // 监听控制台消息
    this.page.on('console', msg => {
      logger.debug(`[Browser Console] ${msg.type()}: ${msg.text()}`);
    });

    // 监听页面错误
    this.page.on('pageerror', error => {
      logger.error(`[Page Error] ${error.message}`);
    });

    logger.info('[PuppeteerDriver] Browser launched');
  }

  /**
   * 注入反检测脚本
   */
  async injectAntiDetectionScript() {
    await this.page.evaluateOnNewDocument(() => {
      // 隐藏automation特征
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined
      });

      // 模拟真实插件列表
      Object.defineProperty(navigator, 'plugins', {
        get: () => [
          { name: 'Chrome PDF Plugin' },
          { name: 'Chrome PDF Viewer' },
          { name: 'Native Client' }
        ]
      });

      // 模拟语言
      Object.defineProperty(navigator, 'languages', {
        get: () => ['zh-CN', 'zh', 'en']
      });

      // 修复chrome对象
      window.chrome = {
        runtime: {},
        loadTimes: function() {},
        csi: function() {},
        app: {}
      };

      // 修复permissions
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters) => {
        return parameters.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission })
          : originalQuery(parameters);
      };
    });
  }

  /**
   * 获取页面源码
   * @returns {Promise<string>}
   */
  async getPageSource() {
    try {
      const html = await this.page.content();
      return html;
    } catch (error) {
      logger.error('[PuppeteerDriver] Failed to get page source:', error.message);
      throw error;
    }
  }

  /**
   * 点击元素（支持 :contains() 伪选择器）
   * @param {string} selector - CSS选择器（可含 :contains()）
   * @returns {Promise<void>}
   */
  async click(selector) {
    try {
      // 处理 :contains() 伪选择器
      const containsMatch = selector.match(/^(.+?):contains\(["'](.+?)["']\)$/);
      if (containsMatch) {
        const [, baseSelector, searchText] = containsMatch;
        await this.page.evaluate(
          (sel, text) => {
            const els = document.querySelectorAll(sel);
            for (const el of els) {
              if (el.textContent && el.textContent.includes(text)) {
                el.click();
                return;
              }
            }
            throw new Error('Element with text not found: ' + text);
          },
          baseSelector,
          searchText
        );
        logger.debug(`[PuppeteerDriver] Clicked (contains): ${selector}`);
        return;
      }

      await this.page.waitForSelector(selector, { timeout: 5000 });
      await this.page.click(selector);
      logger.debug(`[PuppeteerDriver] Clicked: ${selector}`);
    } catch (error) {
      logger.error(`[PuppeteerDriver] Failed to click ${selector}:`, error.message);
      throw error;
    }
  }

  /**
   * 填写表单输入框
   * @param {string} selector - CSS选择器
   * @param {string} value - 要填写的值
   * @returns {Promise<void>}
   */
  async fillInput(selector, value) {
    try {
      await this.page.waitForSelector(selector, { timeout: 5000 });
      await this.page.focus(selector);
      await this.page.type(selector, value, { delay: 50 }); // 模拟人类打字速度

      // 触发input和change事件
      await this.page.evaluate((sel) => {
        const element = document.querySelector(sel);
        if (element) {
          element.dispatchEvent(new Event('input', { bubbles: true }));
          element.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, selector);

      logger.debug(`[PuppeteerDriver] Filled ${selector} with value`);
    } catch (error) {
      logger.error(`[PuppeteerDriver] Failed to fill ${selector}:`, error.message);
      throw error;
    }
  }

  /**
   * 等待元素出现（支持 :contains() 伪选择器）
   * @param {string} selector - CSS选择器（可含 :contains()）
   * @param {number} timeout - 超时时间(毫秒)
   * @returns {Promise<boolean>}
   */
  async waitForElement(selector, timeout = 5000) {
    try {
      // 处理 :contains() 伪选择器 → 使用 JS evaluate 查找
      const containsMatch = selector.match(/^(.+?):contains\(["'](.+?)["']\)$/);
      if (containsMatch) {
        const [, baseSelector, searchText] = containsMatch;
        const startTime = Date.now();
        while (Date.now() - startTime < timeout) {
          const found = await this.page.evaluate(
            (sel, text) => {
              const els = document.querySelectorAll(sel);
              for (const el of els) {
                if (el.textContent && el.textContent.includes(text)) {
                  return true;
                }
              }
              return false;
            },
            baseSelector,
            searchText
          );
          if (found) return true;
          await new Promise(r => setTimeout(r, 200));
        }
        return false;
      }
      await this.page.waitForSelector(selector, { timeout });
      return true;
    } catch (error) {
      logger.debug(`[PuppeteerDriver] Element not found: ${selector}`);
      return false;
    }
  }

  /**
   * 截图
   * @returns {Promise<Buffer>}
   */
  async screenshot() {
    try {
      const buffer = await this.page.screenshot({
        fullPage: true,
        type: 'png'
      });
      logger.info('[PuppeteerDriver] Screenshot captured');
      return buffer;
    } catch (error) {
      logger.error('[PuppeteerDriver] Screenshot failed:', error.message);
      throw error;
    }
  }

  /**
   * 注入JavaScript脚本
   * @param {string} scriptPath - 脚本文件路径或脚本内容
   * @returns {Promise<void>}
   */
  async injectScript(scriptPath) {
    try {
      // 判断是文件路径还是脚本内容
      if (scriptPath.endsWith('.js')) {
        const fs = require('fs').promises;
        const scriptContent = await fs.readFile(scriptPath, 'utf-8');
        await this.page.evaluate(scriptContent);
      } else {
        await this.page.evaluate(scriptPath);
      }
      logger.debug('[PuppeteerDriver] Script injected');
    } catch (error) {
      logger.error('[PuppeteerDriver] Script injection failed:', error.message);
      throw error;
    }
  }

  /**
   * 执行JavaScript代码
   * @param {string} script - JavaScript代码
   * @returns {Promise<any>}
   */
  async evaluateScript(script) {
    try {
      const result = await this.page.evaluate(script);
      return result;
    } catch (error) {
      logger.error('[PuppeteerDriver] Script evaluation failed:', error.message);
      throw error;
    }
  }

  /**
   * 检测并识别"下一题"按钮
   * @param {Array<string>} selectors - 候选选择器列表
   * @returns {Promise<string|null>}
   */
  async detectNextButton(selectors = []) {
    const defaultSelectors = [
      '.ant-btn-primary',
      'button:contains("下一题")',
      'button:contains("Next")',
      '[data-action="next"]',
      '.next-button',
      '.btn-next',
      'button[type="submit"]'
    ];

    const allSelectors = [...selectors, ...defaultSelectors];

    for (const selector of allSelectors) {
      try {
        const found = await this.waitForElement(selector, 1000);
        if (found) {
          logger.debug(`[PuppeteerDriver] Next button found: ${selector}`);
          return selector;
        }
      } catch (e) {
        continue;
      }
    }

    logger.warn('[PuppeteerDriver] Next button not found');
    return null;
  }

  /**
   * 关闭浏览器
   * @returns {Promise<void>}
   */
  async close() {
    try {
      if (this.browser) {
        await this.browser.close();
        this.browser = null;
        this.page = null;
        this.isConnected = false;
        logger.info('[PuppeteerDriver] Browser closed');
      }
    } catch (error) {
      logger.error('[PuppeteerDriver] Close failed:', error.message);
    }
  }

  /**
   * 处理弹窗
   * @param {string} action - 'accept' | 'dismiss'
   * @returns {Promise<void>}
   */
  async handleDialog(action = 'accept') {
    this.page.on('dialog', async dialog => {
      if (action === 'accept') {
        await dialog.accept();
      } else {
        await dialog.dismiss();
      }
    });
  }

  /**
   * 等待页面加载完成
   * @param {number} timeout - 超时时间(毫秒)
   * @returns {Promise<void>}
   */
  async waitForLoad(timeout = 10000) {
    try {
      await this.page.waitForNavigation({
        waitUntil: 'networkidle2',
        timeout
      });
    } catch (error) {
      logger.warn('[PuppeteerDriver] Wait for load timeout');
    }
  }
}

module.exports = PuppeteerDriver;
