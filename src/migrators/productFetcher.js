// Product fetcher - handles filtering and fetching products from source
import { pagedGetAll, requestWithRetry } from '../api/client.js';
import { chunk } from '../utils/array.js';

/**
 * Fetch source products with server-side filters
 */
export async function fetchSourceProducts(srcClient, cli, pageSize = 250) {
  // Fetch by specific IDs
  if (Array.isArray(cli.onlyIds) && cli.onlyIds.length) {
    const chunks = chunk(cli.onlyIds, 50);
    const out = [];
    
    for (const ids of chunks) {
      const res = await requestWithRetry(srcClient, {
        method: 'get',
        url: '/catalog/products',
        params: { 
          limit: pageSize, 
          'id:in': ids.join(',') 
        }
      });
      out.push(...(res.data?.data || []));
    }
    
    return out;
  }
  
  // Fetch by name
  if (cli.onlyName) {
    // Try exact match first
    const exact = await requestWithRetry(srcClient, {
      method: 'get',
      url: '/catalog/products',
      params: { name: cli.onlyName, limit: 50 }
    });
    
    let list = exact.data?.data || [];
    
    if (!list.length) {
      // Try LIKE search
      const like = await requestWithRetry(srcClient, {
        method: 'get',
        url: '/catalog/products',
        params: { 'name:like': cli.onlyName, limit: 50 }
      });
      
      list = like.data?.data || [];
      
      if (!list.length) {
        // Try keyword search
        const kw = await requestWithRetry(srcClient, {
          method: 'get',
          url: '/catalog/products',
          params: { keyword: cli.onlyName, limit: 50 }
        });
        
        list = kw.data?.data || [];
      }
    }
    
    return list;
  }
  
  // Fetch by regex (needs keyword search to get bulk)
  if (cli.nameRegex) {
    const kw = await requestWithRetry(srcClient, {
      method: 'get',
      url: '/catalog/products',
      params: { keyword: ' ', limit: pageSize }
    });
    
    return kw.data?.data || [];
  }
  
  // Fetch all products
  return await pagedGetAll(
    srcClient, 
    '/catalog/products', 
    { include: 'custom_fields,options,variants' },
    pageSize
  );
}

/**
 * Apply client-side filters to products
 */
export function filterProducts(products, cli) {
  let filtered = products;
  
  if (cli.startAfterId) {
    filtered = filtered.filter(p => p.id > cli.startAfterId);
  }
  
  if (cli.nameRegex) {
    filtered = filtered.filter(p => cli.nameRegex.test(String(p.name || '')));
  }
  
  if (cli.onlyName) {
    const needle = cli.onlyName.toLowerCase();
    filtered = filtered.filter(p => 
      String(p.name || '').toLowerCase().includes(needle)
    );
  }
  
  if (Array.isArray(cli.onlyIds) && cli.onlyIds.length) {
    const set = new Set(cli.onlyIds);
    filtered = filtered.filter(p => set.has(p.id));
  }
  
  if (cli.limit && cli.limit > 0) {
    filtered = filtered.slice(0, cli.limit);
  }
  
  return filtered;
}

/**
 * Get product assets (custom fields, images, options, variants)
 */
export async function getProductAssets(client, productId) {
  const [customFields, images, options, variants] = await Promise.all([
    pagedGetAll(client, `/catalog/products/${productId}/custom-fields`),
    pagedGetAll(client, `/catalog/products/${productId}/images`),
    pagedGetAll(client, `/catalog/products/${productId}/options`),
    pagedGetAll(client, `/catalog/products/${productId}/variants`)
  ]);
  
  return { customFields, images, options, variants };
}
