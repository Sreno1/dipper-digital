// ============================================================
// ANNEX — utils.js
// Shared utility functions
// ============================================================

/**
 * Fisher-Yates shuffle. Returns a new array.
 * @param {Array} arr
 * @returns {Array}
 */
export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Euclidean distance between two {x, y} points.
 * @param {{ x: number, y: number }} a
 * @param {{ x: number, y: number }} b
 * @returns {number}
 */
export function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Clamp a number between min and max (inclusive).
 * @param {number} val
 * @param {number} lo
 * @param {number} hi
 * @returns {number}
 */
export function clamp(val, lo, hi) {
  return Math.max(lo, Math.min(hi, val));
}

/**
 * Random integer in [min, max] inclusive.
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Pick a random element from an array.
 * @param {Array} arr
 * @returns {*}
 */
export function randPick(arr) {
  if (arr.length === 0) return undefined;
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Shortcut for document.querySelector.
 * @param {string} selector
 * @returns {Element|null}
 */
export function $(selector) {
  return document.querySelector(selector);
}

/**
 * Shortcut for document.querySelectorAll.
 * @param {string} selector
 * @returns {NodeListOf<Element>}
 */
export function $$(selector) {
  return document.querySelectorAll(selector);
}

/**
 * Create a canonical edge key string from two node IDs.
 * Always puts the smaller ID first for consistent deduplication.
 * @param {number} a
 * @param {number} b
 * @returns {string}
 */
export function edgeKey(a, b) {
  return Math.min(a, b) + "," + Math.max(a, b);
}

/**
 * Compute connected components of a graph represented as an
 * array of objects with a `connections` array of neighbor indices.
 * @param {{ connections: number[] }[]} nodes
 * @returns {number[][]} Array of components, each an array of node indices.
 */
export function getComponents(nodes) {
  const visited = new Set();
  const components = [];
  for (let i = 0; i < nodes.length; i++) {
    if (visited.has(i)) continue;
    const comp = [];
    const queue = [i];
    visited.add(i);
    while (queue.length) {
      const cur = queue.shift();
      comp.push(cur);
      for (const nb of nodes[cur].connections) {
        if (!visited.has(nb)) {
          visited.add(nb);
          queue.push(nb);
        }
      }
    }
    components.push(comp);
  }
  return components;
}

/**
 * Check if removing an edge between a and b would disconnect the graph.
 * Assumes the edge currently exists.
 * @param {{ connections: number[] }[]} nodes
 * @param {number} a
 * @param {number} b
 * @returns {boolean} true if removing the edge would disconnect the graph
 */
export function wouldDisconnect(nodes, a, b) {
  // BFS from a to b without using the direct a-b edge
  const visited = new Set();
  const queue = [a];
  visited.add(a);
  while (queue.length) {
    const cur = queue.shift();
    for (const nb of nodes[cur].connections) {
      if (visited.has(nb)) continue;
      // Skip the direct edge we're "removing"
      if ((cur === a && nb === b) || (cur === b && nb === a)) {
        // Only skip once — if there are parallel paths through a-b we still
        // need to allow them. But since our graph has no multi-edges, skipping
        // this specific traversal is correct.
        continue;
      }
      if (nb === b) return false; // still reachable
      visited.add(nb);
      queue.push(nb);
    }
  }
  return !visited.has(b);
}

/**
 * Deep clone a plain object / array / primitive (no functions, no circular refs).
 * @param {*} obj
 * @returns {*}
 */
export function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Format a number with commas for display (e.g. 1234 → "1,234").
 * @param {number} n
 * @returns {string}
 */
export function formatNumber(n) {
  return n.toLocaleString("en-US");
}

/**
 * Wait for a given number of milliseconds (for async flows).
 * @param {number} ms
 * @returns {Promise<void>}
 */
export function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
