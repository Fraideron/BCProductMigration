// Category model utilities
import { normalize } from '../utils/string.js';

/**
 * Build category path map (id -> full path)
 */
export function buildCategoryPathMap(categories) {
  const byId = new Map(categories.map(c => [c.id, c]));
  const cache = new Map();
  
  function pathFor(cat) {
    if (cache.has(cat.id)) return cache.get(cat.id);
    
    const name = (cat.name || '').trim();
    
    if (!cat.parent_id || cat.parent_id === 0) {
      const p = `/${name}`;
      cache.set(cat.id, p);
      return p;
    }
    
    const parent = byId.get(cat.parent_id);
    const parentPath = parent ? pathFor(parent) : '';
    const p = `${parentPath}/${name}`;
    cache.set(cat.id, p);
    return p;
  }
  
  const idToPath = new Map(categories.map(c => [c.id, pathFor(c)]));
  
  return { byId, idToPath };
}

/**
 * Sort categories with parents before children
 */
export function sortCatsParentFirst(categories) {
  const visited = new Set();
  const order = [];
  const children = new Map();
  
  for (const c of categories) {
    const arr = children.get(c.parent_id || 0) || [];
    arr.push(c);
    children.set(c.parent_id || 0, arr);
  }
  
  function dfs(parentId) {
    const kids = children.get(parentId) || [];
    for (const k of kids) {
      if (!visited.has(k.id)) {
        visited.add(k.id);
        order.push(k);
        dfs(k.id);
      }
    }
  }
  
  dfs(0);
  return order.filter(Boolean);
}
