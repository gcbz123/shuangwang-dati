'use strict';

const { cacheMaxSize } = require('./config');

/**
 * 简易 LRU 缓存。
 * 利用 Map 的插入顺序特性：每次 get/set 把 key 移到末尾，
 * 淘汰时从头部删除最久未使用的条目，不会出现全空窗口。
 */
class LRUCache {
  constructor(maxSize) {
    this._maxSize = maxSize || cacheMaxSize;
    this._map = new Map();
  }

  // 获取当前缓存条目数
  get size() {
    return this._map.size;
  }

  // 检查 key 是否存在（不会影响顺序）
  has(key) {
    return this._map.has(key);
  }

  // 获取值，同时将其移到末尾标记为最近使用
  get(key) {
    if (!this._map.has(key)) return undefined;
    const value = this._map.get(key);
    // 删除再插入，利用 Map 插入顺序特性移到末尾
    this._map.delete(key);
    this._map.set(key, value);
    return value;
  }

  // 设置值，缓存满时淘汰最久未使用的条目
  set(key, value) {
    if (this._map.has(key)) {
      this._map.delete(key);
    } else if (this._map.size >= this._maxSize) {
      // 淘汰最旧条目（Map 迭代器第一个 key）
      const oldestKey = this._map.keys().next().value;
      this._map.delete(oldestKey);
    }
    this._map.set(key, value);
  }

  // 清空所有缓存
  clear() {
    this._map.clear();
  }
}

module.exports = LRUCache;
