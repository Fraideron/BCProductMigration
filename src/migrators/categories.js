// Category migrator
import { pagedGetAll, requestWithRetry } from '../api/client.js';
import { normalize } from '../utils/string.js';
import { buildCategoryPathMap, sortCatsParentFirst } from '../models/category.js';

/**
 * Migrate categories from source to destination
 */
export async function migrateCategories(srcClient, dstClient, dryRun = false) {
  console.log('\n==== CATEGORIES ====');
  
  const srcCats = await pagedGetAll(srcClient, '/catalog/categories');
  const dstCats = await pagedGetAll(dstClient, '/catalog/categories');
  
  const { idToPath: srcIdToPath } = buildCategoryPathMap(srcCats);
  const { idToPath: dstIdToPath } = buildCategoryPathMap(dstCats);
  
  const dstPathToId = new Map(
    [...dstIdToPath.entries()].map(([id, path]) => [normalize(path), id])
  );
  
  const catMap = new Map(); // srcCatId -> dstCatId
  const ordered = sortCatsParentFirst(srcCats);
  const createdByPath = new Map();
  
  for (const c of ordered) {
    const path = srcIdToPath.get(c.id);
    const key = normalize(path);
    let dstId = dstPathToId.get(key);
    
    if (!dstId && !dryRun) {
      let parent_id = 0;
      
      if (c.parent_id && c.parent_id !== 0) {
        const parentPath = normalize(srcIdToPath.get(c.parent_id));
        parent_id = createdByPath.get(parentPath) || dstPathToId.get(parentPath) || 0;
      }
      
      const payload = {
        name: c.name,
        parent_id,
        description: c.description || '',
        is_visible: c.is_visible ?? true,
        sort_order: c.sort_order ?? 0
      };
      
      const res = await requestWithRetry(dstClient, {
        method: 'post',
        url: '/catalog/categories',
        data: payload
      });
      
      dstId = res.data?.data?.id;
      console.log(`+ Created category: ${path} (#${dstId})`);
      createdByPath.set(key, dstId);
    } else if (!dstId && dryRun) {
      console.log(`[DRY] Would create category: ${path}`);
    }
    
    if (!dstId) dstId = createdByPath.get(key);
    if (dstId) catMap.set(c.id, dstId);
  }
  
  console.log(`Category mappings: ${catMap.size}`);
  return catMap;
}
