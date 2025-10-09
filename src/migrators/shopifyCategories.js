// Migrate categories from BigCommerce to Shopify
// BigCommerce categories -> Shopify collections (custom collections)
import { shopifyRequestWithRetry, shopifyPagedGetAll } from '../api/shopifyClient.js';
import { pagedGetAll } from '../api/client.js';
import { normalize } from '../utils/string.js';

/**
 * Build category path map for hierarchical categories
 */
function buildCategoryPathMap(categories) {
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
 * Sort categories parent-first for creation order
 */
function sortCatsParentFirst(categories) {
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

/**
 * Migrate categories to Shopify custom collections
 * @returns Map of BigCommerce category ID to Shopify collection ID
 */
export async function migrateShopifyCategories(srcClient, shopifyClient, dryRun) {
  console.log('\n==== CATEGORIES (to Shopify Collections) ====');
  
  // Fetch all categories from BigCommerce
  const srcCats = await pagedGetAll(srcClient, '/catalog/categories');
  
  // Fetch existing Shopify collections
  const existingCollections = await shopifyPagedGetAll(shopifyClient, '/custom_collections.json');
  
  const { idToPath: srcIdToPath } = buildCategoryPathMap(srcCats);
  
  // Build map of existing collections by title
  const dstByTitle = new Map();
  for (const coll of existingCollections) {
    dstByTitle.set(normalize(coll.title), coll);
  }
  
  const catMap = new Map(); // srcCatId -> shopifyCollectionId
  const ordered = sortCatsParentFirst(srcCats);
  
  for (const cat of ordered) {
    const title = cat.name || 'Untitled';
    const key = normalize(title);
    
    let shopifyCollection = dstByTitle.get(key);
    
    if (!shopifyCollection && !dryRun) {
      // Create custom collection in Shopify
      const payload = {
        custom_collection: {
          title: title,
          body_html: cat.description || '',
          published: cat.is_visible ?? true,
          sort_order: 'manual',
        }
      };
      
      try {
        const res = await shopifyRequestWithRetry(shopifyClient, {
          method: 'post',
          url: '/custom_collections.json',
          data: payload
        });
        
        shopifyCollection = res.data.custom_collection;
        dstByTitle.set(key, shopifyCollection);
        console.log(`+ Created collection: ${title} (#${shopifyCollection.id})`);
      } catch (e) {
        console.log(`  ❌ Failed to create collection ${title}: ${e.message}`);
      }
    } else if (!shopifyCollection && dryRun) {
      console.log(`[DRY] Would create collection: ${title}`);
    } else {
      console.log(`~ Collection exists: ${title} (#${shopifyCollection.id})`);
    }
    
    if (shopifyCollection) {
      catMap.set(cat.id, shopifyCollection.id);
    }
  }
  
  console.log(`Category mappings: ${catMap.size}`);
  return catMap;
}
