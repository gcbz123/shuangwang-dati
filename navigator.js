/**
 * 智能导航模块
 * 识别页面元素、处理弹窗、检测加载完成等
 */

const logger = require('./logger');

class Navigator {
  constructor(driver, domConfig = {}) {
    this.driver = driver;
    this.domConfig = domConfig;
    this.retryCount = 3;
    this.retryDelay = 2000;
  }

  /**
   * 智能识别"下一题"按钮
   * @param {Array<string>} customSelectors - 自定义选择器列表
   * @returns {Promise<string|null>} 找到的选择器或null
   */
  async findNextButton(customSelectors = []) {
    const defaultSelectors = this.domConfig.nextButton || [
      '.ant-btn-primary',
      'button:contains("下一题")',
      'button:contains("Next")',
      '[data-action="next"]',
      '.next-button',
      '.btn-next',
      'button[type="submit"]',
      '.ant-btn:not(.ant-btn-disabled)',
      'button.ant-btn'
    ];

    const allSelectors = [...customSelectors, ...defaultSelectors];

    logger.debug(`[Navigator] Searching for next button with ${allSelectors.length} selectors`);

    for (const selector of allSelectors) {
      try {
        // 处理jQuery风格的contains选择器
        const actualSelector = this.convertJQuerySelector(selector);

        if (!actualSelector) {
          continue;
        }

        const found = await this.driver.waitForElement(actualSelector, 1000);
        if (found) {
          // 检查按钮是否可见且可点击
          const isVisible = await this.isElementVisible(actualSelector);
          const isEnabled = await this.isElementEnabled(actualSelector);

          if (isVisible && isEnabled) {
            logger.info(`[Navigator] Next button found: ${selector}`);
            return selector;
          }
        }
      } catch (e) {
        // 继续尝试下一个选择器
        continue;
      }
    }

    logger.warn('[Navigator] Next button not found');
    return null;
  }

  /**
   * 转换jQuery风格的contains选择器
   * 将 :contains("text") 转换为 driver 可处理的形式（保留原选择器，由 driver 层处理）
   */
  convertJQuerySelector(selector) {
    // :contains() 选择器保留原样，由各 driver 实现负责处理
    // PuppeteerDriver 已支持通过 JS evaluate 查找含文本的元素
    return selector;
  }

  /**
   * 检查元素是否可见
   */
  async isElementVisible(selector) {
    try {
      const result = await this.driver.evaluateScript(`
        (function() {
          const el = document.querySelector('${selector}');
          if (!el) return false;
          const style = window.getComputedStyle(el);
          return style.display !== 'none' &&
                 style.visibility !== 'hidden' &&
                 style.opacity !== '0' &&
                 el.offsetWidth > 0 &&
                 el.offsetHeight > 0;
        })()
      `);
      return result === true;
    } catch (error) {
      return false;
    }
  }

  /**
   * 检查元素是否可用
   */
  async isElementEnabled(selector) {
    try {
      const result = await this.driver.evaluateScript(`
        (function() {
          const el = document.querySelector('${selector}');
          if (!el) return false;
          return !el.disabled && !el.classList.contains('disabled') &&
                 !el.classList.contains('ant-btn-disabled');
        })()
      `);
      return result === true;
    } catch (error) {
      return false;
    }
  }

  /**
   * 等待题目加载完成
   * @param {number} timeout - 超时时间(毫秒)
   * @returns {Promise<boolean>}
   */
  async waitForQuestionLoad(timeout = 10000) {
    const questionSelectors = this.domConfig.questionContainer || [
      '.ti',
      '.question-container',
      '.question-item',
      '[class*="question"]',
      '.ant-form-item'
    ];

    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      for (const selector of questionSelectors) {
        try {
          const found = await this.driver.waitForElement(selector, 1000);
          if (found) {
            logger.debug(`[Navigator] Question loaded with selector: ${selector}`);
            return true;
          }
        } catch (e) {
          continue;
        }
      }

      // 短暂等待后重试
      await this.sleep(500);
    }

    logger.warn('[Navigator] Question load timeout');
    return false;
  }

  /**
   * 检测并处理弹窗
   * @returns {Promise<void>}
   */
  async handleDialogs() {
    try {
      // 检测常见的弹窗类型
      const dialogSelectors = [
        '.ant-modal',
        '.modal',
        '.dialog',
        '[role="dialog"]',
        '.popup'
      ];

      for (const selector of dialogSelectors) {
        const exists = await this.driver.waitForElement(selector, 500);
        if (exists) {
          logger.info(`[Navigator] Dialog detected: ${selector}`);

          // 尝试点击确认按钮
          const confirmButton = await this.findDialogButton(['确认', '确定', 'OK', 'Confirm']);
          if (confirmButton) {
            await this.driver.click(confirmButton);
            logger.info('[Navigator] Dialog confirmed');
          } else {
            // 如果没有确认按钮，尝试按ESC关闭
            await this.pressEscape();
          }

          break;
        }
      }
    } catch (error) {
      logger.error('[Navigator] Failed to handle dialogs:', error.message);
    }
  }

  /**
   * 查找弹窗按钮
   */
  async findDialogButton(buttonTexts = []) {
    for (const text of buttonTexts) {
      try {
        // 尝试通过文本查找按钮
        const result = await this.driver.evaluateScript(`
          (function() {
            const buttons = Array.from(document.querySelectorAll('button'));
            const target = buttons.find(btn => btn.textContent.includes('${text}'));
            if (target) {
              // 返回CSS路径
              return getCssPath(target);
            }
            return null;
          })()

          function getCssPath(element) {
            const path = [];
            while (element && element.nodeType === Node.ELEMENT_NODE) {
              let selector = element.nodeName.toLowerCase();
              if (element.id) {
                selector += '#' + element.id;
                path.unshift(selector);
                break;
              } else {
                let sibling = element;
                let index = 1;
                while (sibling = sibling.previousElementSibling) {
                  if (sibling.nodeName === element.nodeName) index++;
                }
                if (index > 1) selector += ':nth-of-type(' + index + ')';
              }
              path.unshift(selector);
              element = element.parentElement;
            }
            return path.join(' > ');
          }
        `);

        if (result) {
          return result;
        }
      } catch (e) {
        continue;
      }
    }
    return null;
  }

  /**
   * 按下ESC键
   */
  async pressEscape() {
    try {
      await this.driver.evaluateScript(`
        document.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Escape',
          code: 'Escape',
          keyCode: 27,
          bubbles: true
        }));
      `);
      logger.debug('[Navigator] ESC pressed');
    } catch (error) {
      logger.error('[Navigator] Failed to press ESC:', error.message);
    }
  }

  /**
   * 检测页面是否发生跳转
   * @param {string} currentUrl - 当前URL
   * @param {number} timeout - 检测超时时间
   * @returns {Promise<boolean>}
   */
  async detectPageNavigation(currentUrl, timeout = 5000) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      try {
        const newUrl = await this.driver.evaluateScript('window.location.href');
        if (newUrl !== currentUrl) {
          logger.info(`[Navigator] Page navigation detected: ${currentUrl} -> ${newUrl}`);
          return true;
        }
      } catch (error) {
        // 页面可能在加载中
      }

      await this.sleep(200);
    }

    return false;
  }

  /**
   * 等待DOM变化(用于检测新题目加载)
   * @param {number} timeout - 超时时间
   * @returns {Promise<boolean>}
   */
  async waitForDomChange(timeout = 10000) {
    try {
      const result = await this.driver.evaluateScript(`
        new Promise((resolve) => {
          const observer = new MutationObserver((mutations) => {
            observer.disconnect();
            resolve(true);
          });

          observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true
          });

          setTimeout(() => {
            observer.disconnect();
            resolve(false);
          }, ${timeout});
        })
      `);

      return result === true;
    } catch (error) {
      logger.error('[Navigator] waitForDomChange failed:', error.message);
      return false;
    }
  }

  /**
   * 滚动到指定元素
   * @param {string} selector - CSS选择器
   */
  async scrollToElement(selector) {
    try {
      await this.driver.evaluateScript(`
        (function() {
          const el = document.querySelector('${selector}');
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        })()
      `);
      logger.debug(`[Navigator] Scrolled to: ${selector}`);
    } catch (error) {
      logger.error('[Navigator] Scroll failed:', error.message);
    }
  }

  /**
   * 滚动到底部
   */
  async scrollToBottom() {
    try {
      await this.driver.evaluateScript(`
        window.scrollTo({
          top: document.body.scrollHeight,
          behavior: 'smooth'
        });
      `);
      logger.debug('[Navigator] Scrolled to bottom');
    } catch (error) {
      logger.error('[Navigator] Scroll failed:', error.message);
    }
  }

  /**
   * 刷新页面并重试
   * @param {Function} operation - 要执行的操作
   * @returns {Promise<any>}
   */
  async retryWithRefresh(operation) {
    for (let i = 0; i < this.retryCount; i++) {
      try {
        return await operation();
      } catch (error) {
        logger.warn(`[Navigator] Attempt ${i + 1} failed:`, error.message);

        if (i < this.retryCount - 1) {
          logger.info(`[Navigator] Refreshing page and retry...`);
          await this.driver.evaluateScript('window.location.reload()');
          await this.sleep(this.retryDelay);
          await this.waitForQuestionLoad();
        } else {
          throw error;
        }
      }
    }
  }

  /**
   * 工具函数: 睡眠
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = Navigator;
