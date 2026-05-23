/**
 * cache.js 单元测试
 * 测试 LRU 缓存实现
 */

const LRUCache = require('../../cache');

describe('LRUCache', () => {
  let cache;

  beforeEach(() => {
    cache = new LRUCache(3); // 容量为3
  });

  test('set 和 get 基本功能', () => {
    cache.set('a', 1);
    expect(cache.get('a')).toBe(1);
  });

  test('不存在的 key 返回 undefined', () => {
    expect(cache.get('nonexistent')).toBeUndefined();
  });

  test('LRU 淘汰策略', () => {
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    // 缓存已满，再添加会淘汰最久未使用的
    cache.set('d', 4);

    expect(cache.get('a')).toBeUndefined(); // 'a' 被淘汰
    expect(cache.get('b')).toBe(2);
    expect(cache.get('c')).toBe(3);
    expect(cache.get('d')).toBe(4);
  });

  test('访问更新使用顺序', () => {
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);

    // 访问 'a'，使其变为最近使用
    cache.get('a');

    // 添加新元素，应该淘汰 'b'（最久未使用）
    cache.set('d', 4);

    expect(cache.get('a')).toBe(1);
    expect(cache.get('b')).toBeUndefined(); // 'b' 被淘汰
    expect(cache.get('c')).toBe(3);
    expect(cache.get('d')).toBe(4);
  });

  test('更新已存在的 key', () => {
    cache.set('a', 1);
    cache.set('a', 10);

    expect(cache.get('a')).toBe(10);
    expect(cache.size).toBe(1);
  });

  test('clear 清空缓存', () => {
    cache.set('a', 1);
    cache.set('b', 2);
    cache.clear();

    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  test('size 属性', () => {
    expect(cache.size).toBe(0);

    cache.set('a', 1);
    expect(cache.size).toBe(1);

    cache.set('b', 2);
    expect(cache.size).toBe(2);
  });

  test('容量为1时正常工作', () => {
    const oneCache = new LRUCache(1);
    oneCache.set('a', 1);
    expect(oneCache.get('a')).toBe(1);
    oneCache.set('b', 2);
    expect(oneCache.get('a')).toBeUndefined();
    expect(oneCache.get('b')).toBe(2);
  });
});
