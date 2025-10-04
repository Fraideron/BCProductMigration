// Product model and utilities

/**
 * Check if product has real variants (not just base variant)
 */
export function hasRealVariants(variants = []) {
  return (variants || []).some(v => 
    Array.isArray(v.option_values) && v.option_values.length > 0
  );
}

/**
 * Build base product payload for API
 */
export function baseProductPayload(p, brandMap, catMap, hasVariants) {
  const mappedBrandId = p.brand_id && brandMap.get(p.brand_id) 
    ? brandMap.get(p.brand_id) 
    : undefined;
    
  const mappedCats = Array.isArray(p.categories) && p.categories.length
    ? p.categories.map(id => catMap.get(id)).filter(Boolean)
    : undefined;
    
  const tracking = hasVariants ? 'variant' : (p.inventory_tracking || 'none');
  
  return {
    name: p.name,
    type: p.type || 'physical',
    sku: p.sku || undefined,
    description: p.description || '',
    weight: p.weight ?? 0,
    price: p.price ?? 0,
    cost_price: p.cost_price ?? undefined,
    sale_price: p.sale_price ?? undefined,
    
    // Inventory
    inventory_tracking: tracking,
    inventory_level: p.inventory_level ?? undefined,
    inventory_warning_level: p.inventory_warning_level ?? undefined,
    
    brand_id: mappedBrandId,
    categories: mappedCats,
    is_visible: p.is_visible ?? true,
    availability: p.availability || 'available',
    condition: p.condition || 'New'
  };
}
