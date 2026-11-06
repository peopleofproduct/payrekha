// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Kapil — People of Product™

interface Node<K, V> {
  readonly key: K;
  value: V;
  prev: Node<K, V> | null;
  next: Node<K, V> | null;
}

/**
 * Map with a hard entry cap and exact least-recently-used eviction, so
 * per-entity state cannot grow without bound. Copied from Krediwall: a
 * linked list tracks recency so reads never churn the underlying Map
 * (delete-then-set churn caused multi-ms tail latency there).
 */
export class LruMap<K, V> {
  private readonly map = new Map<K, Node<K, V>>();
  private head: Node<K, V> | null = null;
  private tail: Node<K, V> | null = null;
  private evicted = 0;

  constructor(readonly maxEntries: number) {}

  get size(): number {
    return this.map.size;
  }

  get evictedCount(): number {
    return this.evicted;
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  /** Read without touching recency. */
  peek(key: K): V | undefined {
    return this.map.get(key)?.value;
  }

  get(key: K): V | undefined {
    const node = this.map.get(key);
    if (node === undefined) return undefined;
    this.touch(node);
    return node.value;
  }

  set(key: K, value: V): void {
    const existing = this.map.get(key);
    if (existing !== undefined) {
      existing.value = value;
      this.touch(existing);
      return;
    }
    const node: Node<K, V> = { key, value, prev: null, next: this.head };
    if (this.head !== null) this.head.prev = node;
    this.head = node;
    this.tail ??= node;
    this.map.set(key, node);
    if (this.map.size > this.maxEntries && this.tail !== null) {
      const lru = this.tail;
      this.unlink(lru);
      this.map.delete(lru.key);
      this.evicted += 1;
    }
  }

  delete(key: K): boolean {
    const node = this.map.get(key);
    if (node === undefined) return false;
    this.unlink(node);
    this.map.delete(key);
    return true;
  }

  clear(): void {
    this.map.clear();
    this.head = null;
    this.tail = null;
  }

  /** Least-recently-used first: restoring with `set` keeps recency order. */
  *entriesLeastRecentFirst(): IterableIterator<[K, V]> {
    for (let node = this.tail; node !== null; node = node.prev) yield [node.key, node.value];
  }

  private touch(node: Node<K, V>): void {
    if (this.head === node) return;
    this.unlink(node);
    node.next = this.head;
    if (this.head !== null) this.head.prev = node;
    this.head = node;
    this.tail ??= node;
  }

  private unlink(node: Node<K, V>): void {
    if (node.prev !== null) node.prev.next = node.next;
    else this.head = node.next;
    if (node.next !== null) node.next.prev = node.prev;
    else this.tail = node.prev;
    node.prev = null;
    node.next = null;
  }
}
