/**
 * 油猴脚本驱动实现
 * 通过WebSocket与前端油猴脚本通信，执行浏览器操作
 */

const BrowserDriver = require('../browserDriver');
const WebSocket = require('ws');
const logger = require('../logger');

class OilMonkeyDriver extends BrowserDriver {
  constructor(sessionId) {
    super('oilmonkey', sessionId);
    this.ws = null;
    this.commandQueue = [];
    this.pendingResponses = new Map();
    this.commandId = 0;
    this.connectionTimeout = null;
  }

  /**
   * 建立WebSocket连接
   * @param {number} port - WebSocket端口
   * @returns {Promise<void>}
   */
  async connect(port = 3001) {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(`ws://localhost:${port}`);

        this.ws.on('open', () => {
          this.isConnected = true;
          logger.info(`[OilMonkeyDriver] Connected to session ${this.sessionId}`);
          clearTimeout(this.connectionTimeout);
          resolve();
        });

        this.ws.on('message', (data) => {
          this.handleMessage(JSON.parse(data.toString()));
        });

        this.ws.on('error', (error) => {
          logger.error('[OilMonkeyDriver] WebSocket error:', error.message);
          reject(error);
        });

        this.ws.on('close', () => {
          this.isConnected = false;
          logger.warn(`[OilMonkeyDriver] Connection closed for session ${this.sessionId}`);
        });

        // 连接超时保护
        this.connectionTimeout = setTimeout(() => {
          reject(new Error('WebSocket connection timeout'));
        }, 10000);

      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * 处理来自油猴脚本的消息
   * @param {Object} message - 消息对象
   */
  handleMessage(message) {
    const { type, commandId, data, error } = message;

    if (type === 'response' && this.pendingResponses.has(commandId)) {
      const { resolve, reject, timeout } = this.pendingResponses.get(commandId);
      clearTimeout(timeout);
      this.pendingResponses.delete(commandId);

      if (error) {
        reject(new Error(error));
      } else {
        resolve(data);
      }
    } else if (type === 'event') {
      // 处理事件通知（如页面加载完成、异常等）
      logger.info(`[OilMonkeyDriver] Event received: ${data.event}`, data.payload);
    }
  }

  /**
   * 发送命令到油猴脚本
   * @param {string} command - 命令名称
   * @param {Object} params - 命令参数
   * @param {number} timeout - 超时时间(毫秒)
   * @returns {Promise<any>}
   */
  sendCommand(command, params = {}, timeout = 10000) {
    return new Promise((resolve, reject) => {
      if (!this.isConnected || !this.ws) {
        return reject(new Error('Not connected'));
      }

      const id = ++this.commandId;
      const message = {
        type: 'command',
        commandId: id,
        command,
        params
      };

      // 设置超时
      const timer = setTimeout(() => {
        this.pendingResponses.delete(id);
        reject(new Error(`Command timeout: ${command}`));
      }, timeout);

      this.pendingResponses.set(id, { resolve, reject, timeout: timer });

      try {
        this.ws.send(JSON.stringify(message));
      } catch (error) {
        clearTimeout(timer);
        this.pendingResponses.delete(id);
        reject(error);
      }
    });
  }

  async navigate(url) {
    await this.sendCommand('navigate', { url });
  }

  async getPageSource() {
    const html = await this.sendCommand('getPageSource');
    return html;
  }

  async click(selector) {
    await this.sendCommand('click', { selector });
  }

  async fillInput(selector, value) {
    await this.sendCommand('fillInput', { selector, value });
  }

  async waitForElement(selector, timeout = 5000) {
    const found = await this.sendCommand('waitForElement', { selector, timeout });
    return found;
  }

  async screenshot() {
    const base64 = await this.sendCommand('screenshot');
    return Buffer.from(base64, 'base64');
  }

  async injectScript(scriptContent) {
    await this.sendCommand('injectScript', { script: scriptContent });
  }

  async evaluateScript(script) {
    const result = await this.sendCommand('evaluateScript', { script });
    return result;
  }

  async detectNextButton(selectors = []) {
    const foundSelector = await this.sendCommand('detectNextButton', { selectors });
    return foundSelector;
  }

  async close() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.isConnected = false;
    }
  }
}

module.exports = OilMonkeyDriver;
