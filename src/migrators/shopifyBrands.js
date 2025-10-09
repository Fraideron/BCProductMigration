// Migrate brands from BigCommerce to Shopify
// In Shopify, brands are typically stored as vendors or custom collections
import { shopifyRequestWithRetry, shopifyPagedGetAll } from '../api/shopifyClient.js';
import { pagedGetAll } from '../api/client.js';
import { normalize } from '../utils/string.js';

/**
 * Migrate brands to Shopify as vendors
 * BigCommerce brands -> Shopify product vendors
 * @returns Map of BigCommerce brand ID to Shopify vendor name
 */
export async function migrateShopifyBrands(srcClient, shopifyClient, dryRun) {
  console.log('\n==== BRANDS (to Shopify Vendors) ====');
  
  // Fetch all brands from BigCommerce
  const srcBrands = await pagedGetAll(srcClient, '/catalog/brands');
  
  // In Shopify, brands are just vendor strings, not separate entities
  // We'll collect unique vendor names and use them when creating products
  const brandMap = new Map(); // srcBrandId -> vendor name
  
  for (const brand of srcBrands) {
    const vendorName = brand.name || 'Unknown';
    brandMap.set(brand.id, vendorName);
    
    if (dryRun) {
      console.log(`[DRY] Brand: ${vendorName} (will be used as vendor)`);
    } else {
      console.log(`✓ Brand mapped: ${vendorName} -> vendor`);
    }
  }
  
  console.log(`Brand mappings prepared: ${brandMap.size}`);
  return brandMap;
}
