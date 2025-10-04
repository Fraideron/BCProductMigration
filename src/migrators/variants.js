// Variant migrator
import { pagedGetAll, requestWithRetry } from '../api/client.js';
import { mapVariantOptionValuesAsync } from '../services/options.js';

/**
 * Migrate variants for a product
 */
export async function migrateVariants({
  dstClient,
  productId,
  variants,
  dstIdx,
  skuStrategy = 'suffix',
  skuSuffix = '-SBX'
}) {
  const existingVariants = await pagedGetAll(dstClient, `/catalog/products/${productId}/variants`);
  const bySkuOnProduct = new Map(
    (existingVariants || [])
      .filter(ev => ev.sku)
      .map(ev => [String(ev.sku), ev])
  );
  
  let createdVariants = 0;
  
  for (const v of (variants || [])) {
    const mappedOVs = await mapVariantOptionValuesAsync({
      productId,
      variant: v,
      dstIdx,
      dstClient
    });
    
    // Skip base variant (no options)
    if (!mappedOVs || mappedOVs.length === 0) {
      continue;
    }
    
    const basePayload = {
      price: v.price ?? undefined,
      inventory_level: v.inventory_level ?? undefined,
      option_values: mappedOVs
    };
    
    let sku = v.sku || undefined;
    
    // Update if SKU exists on this product
    if (sku && bySkuOnProduct.has(sku)) {
      const existing = bySkuOnProduct.get(sku);
      await requestWithRetry(dstClient, {
        method: 'put',
        url: `/catalog/products/${productId}/variants/${existing.id}`,
        data: { ...basePayload, sku }
      });
      createdVariants++;
      continue;
    }
    
    let payloadV = { ...basePayload, sku };
    const tryCreate = async () => requestWithRetry(dstClient, {
      method: 'post',
      url: `/catalog/products/${productId}/variants`,
      data: payloadV
    });
    
    try {
      await tryCreate();
      createdVariants++;
    } catch (e) {
      const msg = e?.message || '';
      const isSkuConflict = msg.includes('"status":409') && /Sku .* is not unique/i.test(msg);
      
      if (!isSkuConflict) throw e;
      
      // Handle SKU conflict based on strategy
      if (skuStrategy === 'skip') {
        console.log(`  ~ Skipping variant (SKU conflict): ${sku}`);
        continue;
      }
      
      if (skuStrategy === 'blank') {
        delete payloadV.sku;
        await tryCreate();
        createdVariants++;
        continue;
      }
      
      // Suffix strategy
      const original = String(sku);
      let attempt = 0;
      
      while (attempt < 10) {
        attempt += 1;
        const candidate = `${original}${skuSuffix}${attempt > 1 ? `-${attempt}` : ''}`;
        payloadV.sku = candidate;
        
        try {
          await tryCreate();
          console.log(`  ~ SKU conflict resolved: ${original} → ${candidate}`);
          createdVariants++;
          break;
        } catch (err2) {
          const msg2 = err2?.message || '';
          if (!(msg2.includes('"status":409') && /Sku .* is not unique/i.test(msg2))) {
            throw err2;
          }
          if (attempt === 10) {
            console.log(`  ! Gave up suffixing SKU for ${original}`);
          }
        }
      }
    }
  }
  
  return createdVariants;
}
