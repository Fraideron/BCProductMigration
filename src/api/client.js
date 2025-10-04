// API client configuration
import axios from 'axios';

/**
 * Normalize base URL to proper BigCommerce API format
 */
function normalizeBaseUrl(base, hash) {
  const root = (base || 'https://api.bigcommerce.com').replace(/\/+$/, '');
  if (root.endsWith(`/stores/${hash}/v3`)) return root;
  if (root.endsWith(`/stores/${hash}`)) return `${root}/v3`;
  if (root.endsWith('/stores')) return `${root}/${hash}/v3`;
  return `${root}/stores/${hash}/v3`;
}

/**
 * Create axios client for BigCommerce API
 */
export function createApiClient(storeHash, accessToken, baseUrl) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl, storeHash);
  
  return axios.create({
    baseURL: normalizedBaseUrl,
    headers: {
      'X-Auth-Token': accessToken,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
  });
}

/**
 * Request with retry logic for rate limiting
 */
export async function requestWithRetry(client, config, attempt = 1) {
  try {
    return await client.request(config);
  } catch (err) {
    const status = err?.response?.status;
    
    if (status === 429 && attempt <= 6) {
      const wait = Math.min(1000 * Math.pow(2, attempt), 15000);
      console.log(`⚠️  429 rate limited. Backing off ${wait}ms (attempt ${attempt})`);
      await new Promise(r => setTimeout(r, wait));
      return requestWithRetry(client, config, attempt + 1);
    }
    
    const fullUrl = new URL(config.url, client.defaults.baseURL).toString();
    const detail = err?.response?.data || err.message;
    throw new Error(`Request failed: ${config.method?.toUpperCase()} ${fullUrl} :: ${JSON.stringify(detail)}`);
  }
}

/**
 * Fetch all pages from a paginated endpoint
 */
export async function pagedGetAll(client, url, params = {}, pageSize = 250) {
  const items = [];
  let page = 1;
  
  while (true) {
    const res = await requestWithRetry(client, {
      method: 'get',
      url,
      params: { ...params, limit: pageSize, page }
    });
    
    const data = res.data?.data || [];
    items.push(...data);
    
    const meta = res.data?.meta?.pagination;
    if (!meta || page >= meta.total_pages) break;
    page++;
  }
  
  return items;
}
