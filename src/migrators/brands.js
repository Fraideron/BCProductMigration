// Brand migrator
import { pagedGetAll, requestWithRetry } from '../api/client.js';
import { normalize } from '../utils/string.js';

/**
 * Migrate brands from source to destination
 */
export async function migrateBrands(srcClient, dstClient, dryRun = false) {
  console.log('\n==== BRANDS ====');
  
  const srcBrands = await pagedGetAll(srcClient, '/catalog/brands');
  const dstBrands = await pagedGetAll(dstClient, '/catalog/brands');
  
  const dstByName = new Map(dstBrands.map(b => [normalize(b.name), b]));
  const brandMap = new Map(); // srcBrandId -> dstBrandId
  
  for (const b of srcBrands) {
    const key = normalize(b.name);
    if (!key) continue;
    
    let target = dstByName.get(key);
    
    if (!target && !dryRun) {
      const res = await requestWithRetry(dstClient, {
        method: 'post',
        url: '/catalog/brands',
        data: { 
          name: b.name, 
          meta_keywords: b.meta_keywords || [], 
          meta_description: b.meta_description || '' 
        }
      });
      
      target = res.data?.data;
      console.log(`+ Created brand: ${b.name} (#${target?.id})`);
    } else if (!target && dryRun) {
      console.log(`[DRY] Would create brand: ${b.name}`);
    }
    
    if (target) {
      brandMap.set(b.id, target.id);
    }
  }
  
  console.log(`Brand mappings: ${brandMap.size}`);
  return brandMap;
}
