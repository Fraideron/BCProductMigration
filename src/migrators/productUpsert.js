// Product upsert logic
import { requestWithRetry } from '../api/client.js';
import { namesEqual } from '../utils/string.js';

/**
 * Find destination product by name
 */
export async function findDstProductByName(dstClient, name) {
  const res = await requestWithRetry(dstClient, {
    method: 'get',
    url: '/catalog/products',
    params: { name, limit: 50 }
  });
  
  const list = res.data?.data || [];
  const exact = list.find(p => namesEqual(p.name, name));
  if (exact) return exact;
  
  // Fallback to keyword search
  const res2 = await requestWithRetry(dstClient, {
    method: 'get',
    url: '/catalog/products',
    params: { keyword: name, limit: 50 }
  });
  
  const list2 = res2.data?.data || [];
  return list2.find(p => namesEqual(p.name, name)) || null;
}

/**
 * Upsert product by name with different strategies
 */
export async function upsertProductByName({
  dstClient,
  payload,
  sourceProduct,
  strategy = 'update',
  suffix = ' [sandbox]'
}) {
  const existing = await findDstProductByName(dstClient, sourceProduct.name);
  
  // Skip if exists
  if (existing && strategy === 'skip') {
    console.log(`~ Skipping (duplicate name): ${sourceProduct.name} => existing #${existing.id}`);
    return { product: existing, created: false, skipped: true };
  }
  
  // Create with suffix
  if (existing && strategy === 'suffix') {
    const uniquePayload = { ...payload, name: `${payload.name}${suffix}` };
    const res = await requestWithRetry(dstClient, {
      method: 'post',
      url: '/catalog/products',
      data: uniquePayload
    });
    return { product: res.data?.data, created: true, skipped: false };
  }
  
  // Update existing
  if (existing) {
    const res = await requestWithRetry(dstClient, {
      method: 'put',
      url: `/catalog/products/${existing.id}`,
      data: payload
    });
    return { product: res.data?.data, created: false, skipped: false };
  }
  
  // Create new
  const res = await requestWithRetry(dstClient, {
    method: 'post',
    url: '/catalog/products',
    data: payload
  });
  return { product: res.data?.data, created: true, skipped: false };
}
