// Custom fields service
import { requestWithRetry } from '../api/client.js';
import { normalize } from '../utils/string.js';

/**
 * Get all custom fields for a product
 */
export async function getDstCustomFields(dstClient, productId) {
  const res = await requestWithRetry(dstClient, { 
    method: 'get', 
    url: `/catalog/products/${productId}/custom-fields` 
  });
  return res.data?.data || [];
}

/**
 * Ensure custom fields exist on destination product
 */
export async function ensureCustomFieldsInDst(
  dstClient, 
  productId, 
  srcCustomFields = [], 
  strategy = 'pair'
) {
  if (!Array.isArray(srcCustomFields) || srcCustomFields.length === 0) return;
  
  let existing = await getDstCustomFields(dstClient, productId);
  
  if (strategy === 'overwrite_by_name') {
    const byName = new Map(existing.map(cf => [normalize(cf.name), cf]));
    
    for (const cf of srcCustomFields) {
      const name = String(cf.name ?? '');
      const value = String(cf.value ?? '');
      const key = normalize(name);
      const match = byName.get(key);
      
      if (match) {
        if (String(match.value ?? '') !== value) {
          await requestWithRetry(dstClient, {
            method: 'put',
            url: `/catalog/products/${productId}/custom-fields/${match.id}`,
            data: { name, value }
          });
        }
      } else {
        const res = await requestWithRetry(dstClient, {
          method: 'post',
          url: `/catalog/products/${productId}/custom-fields`,
          data: { name, value }
        });
        const created = res.data?.data;
        if (created) byName.set(key, created);
      }
    }
    return;
  }
  
  // Pair strategy: skip if same (name, value) exists
  const have = new Set(existing.map(cf => 
    `${normalize(cf.name)}::${normalize(String(cf.value ?? ''))}`
  ));
  
  for (const cf of srcCustomFields) {
    const name = String(cf.name ?? '');
    const value = String(cf.value ?? '');
    const key = `${normalize(name)}::${normalize(value)}`;
    
    if (have.has(key)) continue;
    
    const res = await requestWithRetry(dstClient, {
      method: 'post',
      url: `/catalog/products/${productId}/custom-fields`,
      data: { name, value }
    });
    
    const created = res.data?.data;
    if (created) {
      have.add(`${normalize(created.name)}::${normalize(String(created.value ?? ''))}`);
    }
  }
}
