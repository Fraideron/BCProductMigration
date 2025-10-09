// Shopify API client
import axios from 'axios';

/**
 * Create axios client for Shopify Admin API
 */
export function createShopifyClient(shopDomain, accessToken, apiVersion = '2024-01') {
  // Normalize shop domain
  const domain = shopDomain.replace(/^https?:\/\//, '').replace(/\.myshopify\.com.*$/, '');
  const baseURL = `https://${domain}.myshopify.com/admin/api/${apiVersion}`;
  
  return axios.create({
    baseURL,
    headers: {
      'X-Shopify-Access-Token': accessToken,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
  });
}

/**
 * Request with retry logic for rate limiting (Shopify uses 429 and also bucket limits)
 */
export async function shopifyRequestWithRetry(client, config, attempt = 1) {
  try {
    const response = await client.request(config);
    
    // Check for rate limit headers
    const remaining = parseInt(response.headers['x-shopify-shop-api-call-limit']?.split('/')[0] || '40', 10);
    
    // If we're close to limit, add a small delay
    if (remaining < 5) {
      await new Promise(r => setTimeout(r, 500));
    }
    
    return response;
  } catch (err) {
    const status = err?.response?.status;
    
    if (status === 429 && attempt <= 6) {
      const retryAfter = parseInt(err.response?.headers['retry-after'] || '2', 10);
      const wait = Math.min(retryAfter * 1000, 15000);
      console.log(`⚠️  Shopify rate limited. Backing off ${wait}ms (attempt ${attempt})`);
      await new Promise(r => setTimeout(r, wait));
      return shopifyRequestWithRetry(client, config, attempt + 1);
    }
    
    const fullUrl = new URL(config.url, client.defaults.baseURL).toString();
    const detail = err?.response?.data || err.message;
    throw new Error(`Shopify request failed: ${config.method?.toUpperCase()} ${fullUrl} :: ${JSON.stringify(detail)}`);
  }
}

/**
 * Fetch all pages from a Shopify paginated endpoint
 * Shopify uses cursor-based pagination with Link headers
 */
export async function shopifyPagedGetAll(client, url, params = {}) {
  const items = [];
  let nextUrl = url;
  let currentParams = { ...params, limit: 250 };
  
  while (nextUrl) {
    const res = await shopifyRequestWithRetry(client, {
      method: 'get',
      url: nextUrl,
      params: currentParams
    });
    
    // Extract items - Shopify wraps data in different keys depending on endpoint
    const data = res.data;
    let pageItems = [];
    
    // Determine the data key (products, collections, etc.)
    const dataKeys = Object.keys(data).filter(k => Array.isArray(data[k]));
    if (dataKeys.length > 0) {
      pageItems = data[dataKeys[0]];
    }
    
    items.push(...pageItems);
    
    // Check for pagination link in headers
    const linkHeader = res.headers['link'];
    nextUrl = null;
    currentParams = {};
    
    if (linkHeader) {
      const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
      if (nextMatch) {
        // Extract the full URL from the link header
        const fullNextUrl = nextMatch[1];
        // Parse URL to get path and params
        const urlObj = new URL(fullNextUrl);
        nextUrl = urlObj.pathname + urlObj.search;
      }
    }
  }
  
  return items;
}
