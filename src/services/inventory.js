// Inventory service - handles inventory operations
import { requestWithRetry } from '../api/client.js';

/**
 * Get default location ID from destination store
 */
export async function getDefaultLocationId(dstClient, fallbackId = 1) {
  try {
    const res = await requestWithRetry(dstClient, { 
      method: 'get', 
      url: '/inventory/locations' 
    });
    
    const locs = res.data?.data || [];
    const def = locs.find(l => l.is_default) || locs.find(l => l.id === 1) || locs[0];
    const id = def?.id || fallbackId;
    
    console.log(`ℹ️  Using inventory location_id=${id}${def ? (def.is_default ? ' (default)' : '') : ' (fallback)'}`);
    return id;
  } catch (e) {
    console.log(`ℹ️  Could not fetch locations; falling back to location_id=${fallbackId}`);
    return fallbackId;
  }
}

/**
 * Perform absolute inventory adjustments
 */
export async function inventoryAbsoluteAdjust(dstClient, items, reason = 'catalog migration set') {
  if (!Array.isArray(items) || items.length === 0) return;
  
  const payload = { reason, items };
  await requestWithRetry(dstClient, {
    method: 'put',
    url: '/inventory/adjustments/absolute',
    data: payload,
  });
}

/**
 * Set product-level inventory
 */
export async function setProductInventoryAbsolute(dstClient, productId, qty, locationId) {
  await inventoryAbsoluteAdjust(dstClient, [{
    location_id: locationId,
    product_id: productId,
    quantity: Number(qty) || 0
  }]);
}

/**
 * Set variant-level inventory
 */
export async function setVariantInventoryAbsolute(dstClient, variantId, qty, locationId) {
  await inventoryAbsoluteAdjust(dstClient, [{
    location_id: locationId,
    variant_id: variantId,
    quantity: Number(qty) || 0
  }]);
}

/**
 * Read inventory at a specific location
 */
export async function readInventoryAtLocation(dstClient, { sku, productId, locationId }) {
  // Try by SKU first (most reliable)
  try {
    if (sku) {
      const res = await requestWithRetry(dstClient, {
        method: 'get',
        url: '/inventory/items',
        params: { 'sku:in': String(sku) }
      });
      
      const rows = res.data?.data || [];
      const row = rows.find(r => 
        (r.location_id === locationId) || 
        (r.location && r.location.id === locationId)
      );
      
      if (row) return row;
    }
  } catch {}
  
  // Fallback to product ID
  try {
    if (productId) {
      const res = await requestWithRetry(dstClient, {
        method: 'get',
        url: '/inventory/items',
        params: { 'product_id:in': String(productId) }
      });
      
      const rows = res.data?.data || [];
      const row = rows.find(r => 
        (r.location_id === locationId) || 
        (r.location && r.location.id === locationId)
      );
      
      if (row) return row;
    }
  } catch {}
  
  return null;
}
