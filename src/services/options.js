// Options and variants service
import { requestWithRetry, pagedGetAll } from '../api/client.js';
import { normalize } from '../utils/string.js';

/**
 * Get all options for a product
 */
export async function getAllDstOptions(dstClient, productId) {
  return await pagedGetAll(dstClient, `/catalog/products/${productId}/options`);
}

/**
 * Create option payload
 */
function optionPayload(opt) {
  const type = opt.type || 'multiple_choice';
  const values = (opt.option_values || []).map(v => ({
    label: v.label,
    is_default: v.is_default ?? false,
    sort_order: v.sort_order ?? 0
  }));
  
  return { 
    display_name: opt.display_name || opt.name || 'Option', 
    type, 
    option_values: values 
  };
}

/**
 * Ensure options exist on destination product (idempotent)
 */
export async function ensureOptionsInDst(dstClient, productId, srcOptions = []) {
  const existing = await getAllDstOptions(dstClient, productId);
  const byName = new Map(existing.map(o => [normalize(o.display_name), o]));
  const ensured = [];
  
  for (const srcOpt of (srcOptions || [])) {
    const nameKey = normalize(srcOpt.display_name || srcOpt.name || '');
    if (!nameKey) continue;
    
    if (byName.has(nameKey)) {
      ensured.push(byName.get(nameKey));
      continue;
    }
    
    try {
      const res = await requestWithRetry(dstClient, {
        method: 'post',
        url: `/catalog/products/${productId}/options`,
        data: optionPayload(srcOpt)
      });
      
      const created = res.data?.data;
      if (created) {
        byName.set(nameKey, created);
        ensured.push(created);
      }
    } catch (e) {
      const msg = e?.message || '';
      if (msg.includes('has already been used on this product')) {
        // Option exists, refetch and use it
        const refreshed = await getAllDstOptions(dstClient, productId);
        const match = refreshed.find(o => normalize(o.display_name) === nameKey);
        
        if (match) {
          byName.set(nameKey, match);
          ensured.push(match);
        } else {
          console.log(`   ! Option "${srcOpt.display_name}" exists per API but wasn't found after refresh.`);
        }
      } else {
        throw e;
      }
    }
  }
  
  return ensured;
}

/**
 * Index destination options by name
 */
export function indexDstOptions(dstOptions = []) {
  const byName = new Map();
  for (const o of dstOptions) {
    byName.set(normalize(o.display_name || ''), o);
  }
  return { byName };
}

/**
 * Get option values for a specific option
 */
export async function getOptionValues(dstClient, productId, optionId) {
  return await pagedGetAll(dstClient, `/catalog/products/${productId}/options/${optionId}/values`);
}

/**
 * Ensure option value exists (create if missing)
 */
export async function ensureOptionValue(dstClient, productId, dstOption, label) {
  if (!dstOption.__valMap) {
    const vals = await getOptionValues(dstClient, productId, dstOption.id);
    dstOption.__valMap = new Map(vals.map(v => [normalize(v.label), v.id]));
  }
  
  const key = normalize(label);
  let id = dstOption.__valMap.get(key);
  if (id) return id;
  
  const res = await requestWithRetry(dstClient, {
    method: 'post',
    url: `/catalog/products/${productId}/options/${dstOption.id}/values`,
    data: { label }
  });
  
  const created = res.data?.data;
  if (created?.id) {
    dstOption.__valMap.set(normalize(created.label), created.id);
    return created.id;
  }
  
  return null;
}

/**
 * Map variant option values to destination IDs
 */
export async function mapVariantOptionValuesAsync({ productId, variant, dstIdx, dstClient }) {
  const ovs = Array.isArray(variant.option_values) ? variant.option_values : [];
  if (ovs.length === 0) return null;
  
  const mapped = [];
  
  for (const ov of ovs) {
    const optNameKey = normalize(ov.option_display_name || '');
    const dstOpt = dstIdx.byName.get(optNameKey);
    
    if (!dstOpt) {
      console.log(`    ! Missing destination option "${ov.option_display_name}"`);
      return null;
    }
    
    const valId = await ensureOptionValue(dstClient, productId, dstOpt, ov.label || '');
    
    if (!valId) {
      console.log(`    ! Missing destination value "${ov.label}" under option "${dstOpt.display_name}"`);
      return null;
    }
    
    mapped.push({ option_id: dstOpt.id, id: valId });
  }
  
  return mapped;
}
