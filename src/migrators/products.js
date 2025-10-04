// Products migrator - main orchestration
import { pagedGetAll, requestWithRetry } from '../api/client.js';
import { baseProductPayload, hasRealVariants } from '../models/product.js';
import { fetchSourceProducts, filterProducts, getProductAssets } from './productFetcher.js';
import { upsertProductByName } from './productUpsert.js';
import { ensureOptionsInDst, getAllDstOptions, indexDstOptions } from '../services/options.js';
import { migrateVariants } from './variants.js';
import { ensureCustomFieldsInDst } from '../services/customFields.js';
import { uploadImageWithFallback } from '../services/image.js';
import {
  setProductInventoryAbsolute,
  inventoryAbsoluteAdjust,
  readInventoryAtLocation
} from '../services/inventory.js';

/**
 * Migrate products from source to destination
 */
export async function migrateProducts({
  srcClient,
  dstClient,
  brandMap,
  catMap,
  defaultLocationId,
  cli,
  config,
  dryRun = false
}) {
  console.log('\n==== PRODUCTS ====');
  
  const serverSide = await fetchSourceProducts(srcClient, cli, config.settings.pageSize);
  let products = filterProducts(serverSide, cli);
  
  console.log(`Total source products (after filters): ${products.length}`);
  
  let processed = 0, skippedCount = 0, failed = 0;
  
  for (const p of products) {
    try {
      const { customFields, images, options, variants } = await getProductAssets(srcClient, p.id);
      const realVariantFlag = hasRealVariants(variants);
      const payload = baseProductPayload(p, brandMap, catMap, realVariantFlag);
      
      if (dryRun) {
        console.log(`[DRY] Would create/update product: ${p.name} (tracking=${payload.inventory_tracking})`);
        processed++;
        continue;
      }
      
      const strategy = (config.strategies.nameDedup || 'update').toLowerCase();
      const suffix = config.strategies.nameDedupSuffix || ' [sandbox]';
      
      const { product: dstProduct, created, skipped: isSkipped } = await upsertProductByName({
        dstClient,
        payload,
        sourceProduct: p,
        strategy,
        suffix
      });
      
      if (isSkipped) {
        console.log(`~ Duplicate name skipped: ${p.name}`);
        skippedCount++;
        continue;
      }
      
      console.log(`${created ? '+ Created' : '~ Updated'} product: ${p.name} (#${p.id} -> #${dstProduct.id})`);
      const newId = dstProduct.id;
      
      // Debug inventory
      if (cli.debugInventory) {
        const dbg = await requestWithRetry(dstClient, { method: 'get', url: `/catalog/products/${newId}` });
        const dbgP = dbg.data?.data;
        console.log(`  ℹ️  Catalog says: inventory_tracking=${dbgP?.inventory_tracking}, inventory_level=${dbgP?.inventory_level}`);
      }
      
      // Migrate OPTIONS (idempotent)
      if ((options || []).length > 0) {
        await ensureOptionsInDst(dstClient, newId, options);
      }
      
      const allDstOptions = await getAllDstOptions(dstClient, newId);
      const dstIdx = indexDstOptions(allDstOptions);
      
      // Migrate VARIANTS
      const skuStrategy = (config.strategies.variantSku || 'suffix').toLowerCase();
      const skuSuffix = config.strategies.variantSkuSuffix || '-SBX';
      
      const createdVariants = await migrateVariants({
        dstClient,
        productId: newId,
        variants,
        dstIdx,
        skuStrategy,
        skuSuffix
      });
      
      // Migrate CUSTOM FIELDS
      if (!cli.skipCustomFields) {
        await ensureCustomFieldsInDst(
          dstClient,
          newId,
          customFields || [],
          (config.strategies.customFieldDedup || 'pair').toLowerCase()
        );
      } else {
        console.log('  ~ Skipped custom fields by CLI flag');
      }
      
      // Migrate IMAGES
      if (!cli.skipImages) {
        const srcImages = images || [];
        console.log(`  • Found ${srcImages.length} image(s) on source`);
        
        for (const img of srcImages) {
          const srcUrl = img.url_zoom || img.url_standard || img.image_url || img.url_thumbnail || img.url_tiny;
          
          if (!srcUrl) {
            console.log('   ! Skipping image (no usable URL on source)');
            continue;
          }
          
          try {
            const result = await uploadImageWithFallback(dstClient, newId, srcUrl, {
              is_thumbnail: img.is_thumbnail ?? false,
              sort_order: img.sort_order ?? 0,
              description: img.description || ''
            });
            console.log(`   + Image via ${result.method}: ${result.data?.id || ''}`);
          } catch (e) {
            console.log(`   ❌ Image failed for ${p.name}: ${e.message}`);
          }
        }
        
        // Verify images
        try {
          const check = await requestWithRetry(dstClient, {
            method: 'get',
            url: `/catalog/products/${newId}/images`
          });
          const count = (check.data?.data || []).length;
          console.log(`  ✔ Images now on destination: ${count}`);
        } catch (e) {
          console.log(`  ! Couldn't verify images: ${e.message}`);
        }
      } else {
        console.log('  ~ Skipped images by CLI flag');
      }
      
      // Migrate INVENTORY
      try {
        const locationId = defaultLocationId;
        
        if (!realVariantFlag) {
          // Product-level inventory
          const qty = p.inventory_level ?? 0;
          await setProductInventoryAbsolute(dstClient, newId, qty, locationId);
          console.log(`  ~ Set PRODUCT-level stock to ${qty} at location ${locationId}`);
          
          if (cli.debugInventory) {
            const row = await readInventoryAtLocation(dstClient, {
              sku: p.sku,
              productId: newId,
              locationId
            });
            console.log(`  ${row ? '✅' : '⚠️'} Readback at location ${locationId}: ${row ? (row.inventory?.available ?? row.quantity ?? '(?)') : 'not found'}`);
          }
        } else {
          // Variant-level inventory
          const dstVariantsLatest = await pagedGetAll(dstClient, `/catalog/products/${newId}/variants`);
          const srcBySku = new Map(
            (variants || [])
              .filter(v => v.sku)
              .map(v => [String(v.sku), v])
          );
          
          const items = [];
          for (const dv of (dstVariantsLatest || [])) {
            if (!dv.sku) continue;
            const sv = srcBySku.get(String(dv.sku));
            if (sv && sv.inventory_level != null) {
              items.push({
                location_id: locationId,
                variant_id: dv.id,
                quantity: Number(sv.inventory_level) || 0
              });
            }
          }
          
          if (items.length) {
            await inventoryAbsoluteAdjust(dstClient, items, `set variant stock for product #${newId}`);
            console.log(`  ~ Set stock for ${items.length} VARIANT(s) via Inventory API at location ${locationId}`);
            
            if (cli.debugInventory && items.length === 1) {
              const onlySku = (variants || []).find(v => v.sku)?.sku;
              const row = await readInventoryAtLocation(dstClient, {
                sku: onlySku,
                productId: newId,
                locationId
              });
              console.log(`  ${row ? '✅' : '⚠️'} Readback at location ${locationId}: ${row ? (row.inventory?.available ?? row.quantity ?? '(?)') : 'not found'}`);
            }
          } else {
            // Fallback to product-level
            const fallback = p.inventory_level ?? 0;
            await setProductInventoryAbsolute(dstClient, newId, fallback, locationId);
            console.log(`  ~ Fallback: set PRODUCT-level stock to ${fallback} at location ${locationId}`);
            
            if (cli.debugInventory) {
              const row = await readInventoryAtLocation(dstClient, {
                sku: p.sku,
                productId: newId,
                locationId
              });
              console.log(`  ${row ? '✅' : '⚠️'} Readback at location ${locationId}: ${row ? (row.inventory?.available ?? row.quantity ?? '(?)') : 'not found'}`);
            }
          }
        }
      } catch (e) {
        console.log(`  ! Inventory set failed: ${e.message}`);
        
        // Last resort fallback: legacy catalog field
        try {
          const qty = p.inventory_level ?? 0;
          await requestWithRetry(dstClient, {
            method: 'put',
            url: `/catalog/products/${newId}`,
            data: { inventory_tracking: 'product', inventory_level: qty }
          });
          console.log(`  ~ Fallback: set catalog.inventory_level=${qty}`);
        } catch (e2) {
          console.log(`  ! Fallback failed: ${e2.message}`);
        }
      }
      
      processed++;
    } catch (e) {
      failed++;
      console.log(`❌ Product failed: ${p.name} (#${p.id}) :: ${e.message}`);
    }
  }
  
  console.log(`\nProducts processed: ${processed}, failed: ${failed}, skipped by strategy: ${skippedCount}`);
}
