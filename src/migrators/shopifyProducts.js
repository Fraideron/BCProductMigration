// Migrate products from BigCommerce to Shopify
import { shopifyRequestWithRetry, shopifyPagedGetAll } from '../api/shopifyClient.js';
import { pagedGetAll, requestWithRetry } from '../api/client.js';
import { normalize } from '../utils/string.js';

/**
 * Get product assets from BigCommerce
 */
async function getProductAssets(srcClient, productId) {
  const [customFields, images, options, variants] = await Promise.all([
    pagedGetAll(srcClient, `/catalog/products/${productId}/custom-fields`),
    pagedGetAll(srcClient, `/catalog/products/${productId}/images`),
    pagedGetAll(srcClient, `/catalog/products/${productId}/options`),
    pagedGetAll(srcClient, `/catalog/products/${productId}/variants`)
  ]);
  return { customFields, images, options, variants };
}

/**
 * Fetch source products with filters
 */
async function fetchSourceProducts(srcClient, cli, pageSize) {
  if (Array.isArray(cli.onlyIds) && cli.onlyIds.length) {
    const chunk = (arr, n) => arr.reduce((a, _, i) => (i % n ? a : [...a, arr.slice(i, i + n)]), []);
    const chunks = chunk(cli.onlyIds, 50);
    const out = [];
    for (const ids of chunks) {
      const res = await requestWithRetry(srcClient, {
        method: 'get',
        url: '/catalog/products',
        params: { limit: pageSize, 'id:in': ids.join(',') }
      });
      out.push(...(res.data?.data || []));
    }
    return out;
  }
  
  if (cli.onlyName) {
    const exact = await requestWithRetry(srcClient, {
      method: 'get',
      url: '/catalog/products',
      params: { name: cli.onlyName, limit: 50 }
    });
    let list = exact.data?.data || [];
    
    if (!list.length) {
      const like = await requestWithRetry(srcClient, {
        method: 'get',
        url: '/catalog/products',
        params: { 'name:like': cli.onlyName, limit: 50 }
      });
      list = like.data?.data || [];
    }
    return list;
  }
  
  return await pagedGetAll(srcClient, '/catalog/products', {}, pageSize);
}

/**
 * Map BigCommerce product type to Shopify product type
 */
function mapProductType(bcType) {
  const typeMap = {
    'physical': 'physical',
    'digital': 'digital'
  };
  return typeMap[bcType] || 'physical';
}

/**
 * Check if BigCommerce product has real variants (not just base variant)
 */
function hasRealVariants(variants = []) {
  return variants.some(v => Array.isArray(v.option_values) && v.option_values.length > 0);
}

/**
 * Build Shopify product payload from BigCommerce product
 */
function buildShopifyProduct(bcProduct, brandMap, collectionMap) {
  const vendor = bcProduct.brand_id && brandMap.get(bcProduct.brand_id)
    ? brandMap.get(bcProduct.brand_id)
    : '';
  
  // Build product tags from categories
  const tags = [];
  if (Array.isArray(bcProduct.categories)) {
    for (const catId of bcProduct.categories) {
      const collectionId = collectionMap.get(catId);
      if (collectionId) {
        tags.push(`category_${collectionId}`);
      }
    }
  }
  
  return {
    title: bcProduct.name || 'Untitled Product',
    body_html: bcProduct.description || '',
    vendor: vendor,
    product_type: mapProductType(bcProduct.type),
    tags: tags.join(', '),
    published: bcProduct.is_visible ?? true,
  };
}

/**
 * Build Shopify variants from BigCommerce variants and options
 */
function buildShopifyVariants(bcProduct, bcVariants, bcOptions) {
  const shopifyVariants = [];
  
  if (!bcVariants || bcVariants.length === 0) {
    // Single variant product
    shopifyVariants.push({
      price: String(bcProduct.price || 0),
      compare_at_price: bcProduct.sale_price ? String(bcProduct.price) : null,
      sku: bcProduct.sku || null,
      inventory_quantity: bcProduct.inventory_level || 0,
      inventory_management: 'shopify',
      weight: bcProduct.weight || 0,
      weight_unit: 'lb',
      // Store BC dimensions for later metafield creation
      _bc_width: bcProduct.width,
      _bc_height: bcProduct.height,
      _bc_depth: bcProduct.depth,
    });
  } else {
    // Multiple variants
    for (const variant of bcVariants) {
      const hasOptions = Array.isArray(variant.option_values) && variant.option_values.length > 0;
      
      const shopifyVariant = {
        price: String(variant.price ?? bcProduct.price ?? 0),
        compare_at_price: variant.sale_price ? String(variant.price ?? bcProduct.price) : null,
        sku: variant.sku || null,
        inventory_quantity: variant.inventory_level ?? 0,
        inventory_management: 'shopify',
        weight: variant.weight ?? bcProduct.weight ?? 0,
        weight_unit: 'lb',
        // Store BC dimensions for later metafield creation
        _bc_width: variant.width ?? bcProduct.width,
        _bc_height: variant.height ?? bcProduct.height,
        _bc_depth: variant.depth ?? bcProduct.depth,
      };
      
      // Map option values to Shopify variant options
      if (hasOptions) {
        variant.option_values.forEach((ov, idx) => {
          if (idx < 3) { // Shopify supports max 3 options
            shopifyVariant[`option${idx + 1}`] = ov.label || ov.option_display_name;
          }
        });
      }
      
      shopifyVariants.push(shopifyVariant);
    }
  }
  
  return shopifyVariants;
}

/**
 * Build Shopify options from BigCommerce options
 */
function buildShopifyOptions(bcOptions) {
  const shopifyOptions = [];
  
  if (!bcOptions || bcOptions.length === 0) {
    return shopifyOptions;
  }
  
  for (let i = 0; i < Math.min(bcOptions.length, 3); i++) {
    const option = bcOptions[i];
    const values = (option.option_values || []).map(v => v.label || v.value || 'Value');
    
    shopifyOptions.push({
      name: option.display_name || option.name || `Option ${i + 1}`,
      values: values.length > 0 ? values : ['Default']
    });
  }
  
  return shopifyOptions;
}

/**
 * Build Shopify images from BigCommerce images
 */
function buildShopifyImages(bcImages) {
  if (!bcImages || bcImages.length === 0) {
    return [];
  }
  
  return bcImages.map(img => {
    const src = img.url_zoom || img.url_standard || img.image_url || img.url_thumbnail;
    return {
      src: src,
      alt: img.description || ''
    };
  }).filter(img => img.src);
}

/**
 * Create dimension metafields for a variant
 */
async function createVariantDimensionMetafields(shopifyClient, variantId, width, height, depth) {
  const dimensions = [
    { key: 'width', value: width, label: 'Width' },
    { key: 'height', value: height, label: 'Height' },
    { key: 'depth', value: depth, label: 'Depth/Length' }
  ];
  
  const results = { success: [], failed: [] };
  
  for (const dim of dimensions) {
    // Skip null, undefined, empty string, but allow 0 if it's explicitly set
    if (dim.value == null || dim.value === '') {
      continue;
    }
    
    try {
      const response = await shopifyRequestWithRetry(shopifyClient, {
        method: 'post',
        url: `/variants/${variantId}/metafields.json`,
        data: {
          metafield: {
            namespace: 'custom',
            key: `dimension_${dim.key}`,
            value: String(dim.value),
            type: 'number_decimal'
          }
        }
      });
      results.success.push(dim.key);
      console.log(`    ✓ Created metafield custom.dimension_${dim.key} = ${dim.value}`);
    } catch (e) {
      // Log all errors for debugging
      console.log(`    ! Dimension metafield (${dim.key}): ${e.message}`);
      results.failed.push({ key: dim.key, error: e.message });
      
      // If it's not a "already exists" error, we should know about it
      if (!e.message.includes('already exists') && !e.message.includes('taken')) {
        console.log(`    ! Full error details:`, JSON.stringify(e.response?.data || e.message, null, 2));
      }
    }
  }
  
  return results;
}

/**
 * Find existing Shopify product by title or SKU
 */
async function findShopifyProduct(shopifyClient, title, sku) {
  try {
    // Try finding by title first
    const byTitle = await shopifyRequestWithRetry(shopifyClient, {
      method: 'get',
      url: '/products.json',
      params: { title: title, limit: 1 }
    });
    
    if (byTitle.data.products && byTitle.data.products.length > 0) {
      return byTitle.data.products[0];
    }
    
    // Try finding by SKU if available
    if (sku) {
      const res = await shopifyRequestWithRetry(shopifyClient, {
        method: 'get',
        url: '/products.json',
        params: { limit: 250 }
      });
      
      const products = res.data.products || [];
      for (const product of products) {
        const variants = product.variants || [];
        if (variants.some(v => v.sku === sku)) {
          return product;
        }
      }
    }
  } catch (e) {
    console.log(`  ! Error finding product: ${e.message}`);
  }
  
  return null;
}

/**
 * Migrate products to Shopify
 */
export async function migrateShopifyProducts({
  srcClient,
  shopifyClient,
  brandMap,
  collectionMap,
  cli,
  config,
  dryRun
}) {
  console.log('\n==== PRODUCTS (to Shopify) ====');
  console.log(`Brand mappings available: ${brandMap.size}`);
  console.log(`Collection mappings available: ${collectionMap.size}`);
  if (collectionMap.size > 0) {
    console.log(`Collection map (BC Cat ID -> Shopify Collection ID):`, 
      Array.from(collectionMap.entries()).slice(0, 5).map(([k, v]) => `${k}->${v}`).join(', '),
      collectionMap.size > 5 ? `... (${collectionMap.size} total)` : ''
    );
  } else {
    console.log(`⚠️  No collection mappings found. Categories may not have been migrated yet.`);
  }
  
  // Fetch source products
  let products = await fetchSourceProducts(srcClient, cli, config.settings.pageSize);
  
  // Apply filters
  if (cli.startAfterId) {
    products = products.filter(p => p.id > cli.startAfterId);
  }
  if (cli.nameRegex) {
    products = products.filter(p => cli.nameRegex.test(String(p.name || '')));
  }
  if (cli.onlyName) {
    const needle = cli.onlyName.toLowerCase();
    products = products.filter(p => String(p.name || '').toLowerCase().includes(needle));
  }
  if (cli.limit && cli.limit > 0) {
    products = products.slice(0, cli.limit);
  }
  
  console.log(`Total source products (after filters): ${products.length}`);
  
  let processed = 0, skipped = 0, failed = 0;
  
  for (const bcProduct of products) {
    try {
      console.log(`\nProcessing: ${bcProduct.name} (#${bcProduct.id})`);
      console.log(`  BC Product dimensions: width=${bcProduct.width}, height=${bcProduct.height}, depth=${bcProduct.depth}, weight=${bcProduct.weight}`);
      console.log(`  BC Product categories:`, bcProduct.categories || 'none');
      
      // Get product assets
      const { customFields, images, options, variants } = await getProductAssets(srcClient, bcProduct.id);
      
      if (dryRun) {
        console.log(`[DRY] Would migrate product: ${bcProduct.name}`);
        console.log(`  - Variants: ${variants.length}`);
        console.log(`  - Images: ${images.length}`);
        console.log(`  - Options: ${options.length}`);
        processed++;
        continue;
      }
      
      // Build Shopify product payload
      const productPayload = buildShopifyProduct(bcProduct, brandMap, collectionMap);
      
      // Add options
      const shopifyOptions = buildShopifyOptions(options);
      if (shopifyOptions.length > 0) {
        productPayload.options = shopifyOptions;
      }
      
      // Add variants
      const shopifyVariants = buildShopifyVariants(bcProduct, variants, options);
      if (shopifyVariants.length > 0) {
        productPayload.variants = shopifyVariants;
      }
      
      // Add images
      const shopifyImages = buildShopifyImages(images);
      if (shopifyImages.length > 0 && !cli.skipImages) {
        productPayload.images = shopifyImages;
      }
      
      // Check if product exists
      const existing = await findShopifyProduct(shopifyClient, bcProduct.name, bcProduct.sku);
      
      let shopifyProduct = null;
      
      if (existing) {
        // Update existing product
        console.log(`  ~ Updating existing product #${existing.id}`);
        try {
          const res = await shopifyRequestWithRetry(shopifyClient, {
            method: 'put',
            url: `/products/${existing.id}.json`,
            data: { product: productPayload }
          });
          shopifyProduct = res.data.product;
          console.log(`  ✓ Updated product: ${shopifyProduct.title}`);
        } catch (e) {
          console.log(`  ❌ Failed to update: ${e.message}`);
          failed++;
          continue;
        }
      } else {
        // Create new product
        try {
          const res = await shopifyRequestWithRetry(shopifyClient, {
            method: 'post',
            url: '/products.json',
            data: { product: productPayload }
          });
          shopifyProduct = res.data.product;
          console.log(`  + Created product: ${shopifyProduct.title} (#${shopifyProduct.id})`);
        } catch (e) {
          console.log(`  ❌ Failed to create: ${e.message}`);
          failed++;
          continue;
        }
      }
      
      // Add dimension metafields to variants
      if (shopifyProduct && shopifyProduct.variants) {
        for (let i = 0; i < shopifyProduct.variants.length; i++) {
          const shopifyVariant = shopifyProduct.variants[i];
          const bcVariantData = shopifyVariants[i]; // Get corresponding BC data
          
          if (bcVariantData && (bcVariantData._bc_width || bcVariantData._bc_height || bcVariantData._bc_depth)) {
            console.log(`  → Attempting to add dimensions to variant #${shopifyVariant.id}...`);
            console.log(`    BC Dimensions: W=${bcVariantData._bc_width}, H=${bcVariantData._bc_height}, D=${bcVariantData._bc_depth}`);
            
            try {
              const results = await createVariantDimensionMetafields(
                shopifyClient,
                shopifyVariant.id,
                bcVariantData._bc_width,
                bcVariantData._bc_height,
                bcVariantData._bc_depth
              );
              
              if (results.success.length > 0) {
                const dims = [];
                if (bcVariantData._bc_width && results.success.includes('width')) dims.push(`W:${bcVariantData._bc_width}`);
                if (bcVariantData._bc_height && results.success.includes('height')) dims.push(`H:${bcVariantData._bc_height}`);
                if (bcVariantData._bc_depth && results.success.includes('depth')) dims.push(`D:${bcVariantData._bc_depth}`);
                console.log(`  ✓ Added dimensions to variant #${shopifyVariant.id} (${dims.join(', ')})`);
              }
              
              if (results.failed.length > 0) {
                console.log(`  ⚠️  Some dimensions failed for variant #${shopifyVariant.id}:`, results.failed.map(f => f.key).join(', '));
              }
            } catch (e) {
              console.log(`  ❌ Failed to add dimensions to variant #${shopifyVariant.id}: ${e.message}`);
            }
          } else {
            console.log(`  ⊘ No dimensions to migrate for variant #${shopifyVariant.id}`);
          }
        }
      }
      
      // Add product to collections (categories)
      if (shopifyProduct && Array.isArray(bcProduct.categories) && bcProduct.categories.length > 0) {
        console.log(`  → Attempting to add product to ${bcProduct.categories.length} collection(s)...`);
        
        let addedCount = 0;
        let failedCount = 0;
        
        for (const catId of bcProduct.categories) {
          const collectionId = collectionMap.get(catId);
          
          if (collectionId) {
            console.log(`    • BC Category #${catId} → Shopify Collection #${collectionId}`);
            try {
              await shopifyRequestWithRetry(shopifyClient, {
                method: 'post',
                url: `/collects.json`,
                data: {
                  collect: {
                    product_id: shopifyProduct.id,
                    collection_id: collectionId
                  }
                }
              });
              console.log(`    ✓ Added to collection #${collectionId}`);
              addedCount++;
            } catch (e) {
              // Might already exist, that's ok
              if (e.message.includes('already exists') || e.message.includes('taken')) {
                console.log(`    ~ Already in collection #${collectionId}`);
                addedCount++;
              } else {
                console.log(`    ❌ Failed to add to collection #${collectionId}: ${e.message}`);
                console.log(`    Full error:`, JSON.stringify(e.response?.data || e.message, null, 2));
                failedCount++;
              }
            }
          } else {
            console.log(`    ⚠️  BC Category #${catId} not found in collection map (may not be migrated)`);
            failedCount++;
          }
        }
        
        if (addedCount > 0) {
          console.log(`  ✓ Product added to ${addedCount} collection(s)`);
        }
        if (failedCount > 0) {
          console.log(`  ⚠️  ${failedCount} collection(s) failed or not mapped`);
        }
      } else if (shopifyProduct && (!bcProduct.categories || bcProduct.categories.length === 0)) {
        console.log(`  ⊘ No categories assigned to this product in BigCommerce`);
      }
      
      // Add metafields for custom fields
      if (shopifyProduct && !cli.skipCustomFields && customFields.length > 0) {
        for (const cf of customFields) {
          try {
            await shopifyRequestWithRetry(shopifyClient, {
              method: 'post',
              url: `/products/${shopifyProduct.id}/metafields.json`,
              data: {
                metafield: {
                  namespace: 'custom',
                  key: String(cf.name || 'field').toLowerCase().replace(/[^a-z0-9]/g, '_'),
                  value: String(cf.value || ''),
                  type: 'single_line_text_field'
                }
              }
            });
            console.log(`  ✓ Added metafield: ${cf.name}`);
          } catch (e) {
            // Metafield might exist, that's ok
            console.log(`  ! Metafield note: ${cf.name}`);
          }
        }
      }
      
      processed++;
    } catch (e) {
      failed++;
      console.log(`❌ Product failed: ${bcProduct.name} (#${bcProduct.id}) :: ${e.message}`);
    }
  }
  
  console.log(`\nProducts processed: ${processed}, failed: ${failed}, skipped: ${skipped}`);
}

