// BrowserDriver 抽象接口
class BrowserDriver {
  constructor(mode, sessionId = null) {
    this.mode = mode; // 'oilmonkey' | 'puppeteer'
    this.sessionId = sessionId;
    this.isConnected = false;
  }

  async navigate(url) {
    throw new Error('Method not implemented');
  }

  async getPageSource() {
    throw new Error('Method not implemented');
  }

  async click(selector) {
    throw new Error('Method not implemented');
  }

  async fillInput(selector, value) {
    throw new Error('Method not implemented');
  }

  async waitForElement(selector, timeout = 5000) {
    throw new Error('Method not implemented');
  }

  async screenshot() {
    throw new Error('Method not implemented');
  }

  async injectScript(scriptPath) {
    throw new Error('Method not implemented');
  }

  async evaluateScript(script) {
    throw new Error('Method not implemented');
  }

  async detectNextButton(selectors = []) {
    throw new Error('Method not implemented');
  }

  async close() {
    throw new Error('Method not implemented');
  }

  isConnected() {
    return this.isConnected;
  }
}

module.exports = BrowserDriver;