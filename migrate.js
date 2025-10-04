// BigCommerce Catalog Migrator — migrate.js
// ESM script to copy Brands, Categories, Products, Options, Variants, Custom Fields, and Images
// with idempotency, SKU conflict handling, resilient images, Inventory API absolute adjustments,
// default-location auto-detection, and post-adjust verification.
//
// Change log (latest):
// - Fix: only switch to `inventory_tracking: 'variant'` when there are *real* variants (option_values.length > 0),
//        otherwise keep product-level inventory (prevents \"variant\" flip from the base variant).
// - Verification: read back inventory by SKU using /inventory/items?sku:in=..., which is more reliable.
// - Debug: clearer logs showing which path was used (product vs variant).
//
// Usage examples:
//   node migrate.js --dry-run --only-name="Greek Key Porcelain Garden Stool"
//   node migrate.js --write --only-name="Blue and White Greek Key Porcelain Garden Stool" --debug-inventory
//   node migrate.js --write --only-id=2806 --location-id=1
//   node migrate.js --write --name-regex="^Blue.*Stool$" --limit=1

import 'dotenv/config';
import axios from 'axios';
import FormData from 'form-data';
import mime from 'mime-types';

// ---------------- ENV ----------------
const {
  SRC_STORE_HASH,
  SRC_ACCESS_TOKEN,
  SRC_BASE_URL, // optional
  DST_STORE_HASH,
  DST_ACCESS_TOKEN,
  DST_BASE_URL, // optional
  PAGE_SIZE = '250',
  DRY_RUN = 'false',

  // strategies and tuning
  NAME_DEDUP_STRATEGY,
  NAME_DEDUP_SUFFIX,
  VARIANT_SKU_STRATEGY,
  VARIANT_SKU_SUFFIX,
  CF_DEDUP_STRATEGY,
  INV_LOCATION_ID = '1', // default guess; will auto-detect
} = process.env;

// ---------------- CLI ----------------
function parseCli(argv = process.argv.slice(2)) {
  const args = {};
  for (const tok of argv) {
    if (tok === '--dry-run') args.dryRun = true;
    else if (tok === '--write') args.dryRun = false;
    else if (tok.startsWith('--only-id=')) args.onlyIds =
      tok.split('=')[1].split(',').map(s => parseInt(s.trim(), 10)).filter(Boolean);
    else if (tok.startsWith('--only-name=')) args.onlyName = tok.split('=')[1];
    else if (tok.startsWith('--name-regex=')) args.nameRegex =
      new RegExp(tok.split('=')[1], 'i');
    else if (tok.startsWith('--limit=')) args.limit = parseInt(tok.split('=')[1], 10) || 0;
    else if (tok.startsWith('--start-after-id=')) args.startAfterId = parseInt(tok.split('=')[1], 10) || 0;
    else if (tok === '--skip-images') args.skipImages = true;
    else if (tok === '--skip-custom-fields') args.skipCustomFields = true;
    else if (tok.startsWith('--location-id=')) args.locationId = parseInt(tok.split('=')[1], 10) || 1;
    else if (tok === '--debug-inventory') args.debugInventory = true;
  }
  return args;
}
const CLI = parseCli();

// Let CLI override .env DRY_RUN
let dryRun = (DRY_RUN || 'false').toLowerCase() === 'true';
if (CLI.dryRun !== undefined) dryRun = CLI.dryRun;

// ---------------- Guards ----------------
if (!SRC_STORE_HASH || !SRC_ACCESS_TOKEN || !DST_STORE_HASH || !DST_ACCESS_TOKEN) {
  console.error('❌ Missing env vars. Set SRC_STORE_HASH, SRC_ACCESS_TOKEN, DST_STORE_HASH, DST_ACCESS_TOKEN.');
  process.exit(1);
}

// ---------------- URL & Clients ----------------
function normalizeBaseUrl(base, hash) {
  const root = (base || 'https://api.bigcommerce.com').replace(/\/+$/, '');
  if (root.endsWith(`/stores/${hash}/v3`)) return root;
  if (root.endsWith(`/stores/${hash}`)) return `${root}/v3`
  if (root.endsWith('/stores')) return `${root}/${hash}/v3`;
  return `${root}/stores/${hash}/v3`;
}
const SRC_API_BASE = normalizeBaseUrl(SRC_BASE_URL, SRC_STORE_HASH);
const DST_API_BASE = normalizeBaseUrl(DST_BASE_URL, DST_STORE_HASH);
console.log('SRC base:', SRC_API_BASE);
console.log('DST base:', DST_API_BASE);

const src = axios.create({
  baseURL: SRC_API_BASE,
  headers: {
    'X-Auth-Token': SRC_ACCESS_TOKEN,
    'Accept': 'application/json',
    'Content-Type': 'application/json',
  },
});
const dst = axios.create({
  baseURL: DST_API_BASE,
  headers: {
    'X-Auth-Token': DST_ACCESS_TOKEN,
    'Accept': 'application/json',
  },
});

// ---------------- Utils ----------------
const norm = (s) =>
  String(s ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

function namesEqual(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

async function requestWithRetry(client, config, attempt = 1) {
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

async function pagedGetAll(client, url, params = {}) {
  const items = [];
  let page = 1;
  while (true) {
    const res = await requestWithRetry(client, {
      method: 'get',
      url,
      params: { ...params, limit: Number(PAGE_SIZE), page }
    });
    const data = res.data?.data || [];
    items.push(...data);
    const meta = res.data?.meta?.pagination;
    if (!meta || page >= meta.total_pages) break;
    page++;
  }
  return items;
}

// ---------------- Locations & Inventory helpers ----------------
async function getDefaultLocationId(dstClient) {
  try {
    const res = await requestWithRetry(dstClient, { method: 'get', url: '/inventory/locations' });
    const locs = res.data?.data || [];
    const def = locs.find(l => l.is_default) || locs.find(l => l.id === 1) || locs[0];
    const id = def?.id || parseInt(CLI.locationId || INV_LOCATION_ID, 10) || 1;
    console.log(`ℹ️  Using inventory location_id=${id}${def ? (def.is_default ? ' (default)' : '') : ' (fallback)'}`);
    return id;
  } catch (e) {
    const id = parseInt(CLI.locationId || INV_LOCATION_ID, 10) || 1;
    console.log(`ℹ️  Could not fetch locations; falling back to location_id=${id}`);
    return id;
  }
}

// Absolute Adjustments
async function inventoryAbsoluteAdjust(dstClient, items, reason = 'catalog migration set') {
  if (!Array.isArray(items) || items.length === 0) return;
  const payload = { reason, items };
  await requestWithRetry(dstClient, {
    method: 'put',
    url: '/inventory/adjustments/absolute',
    data: payload,
  });
}
async function setProductInventoryAbsolute(dstClient, productId, qty, locationId) {
  await inventoryAbsoluteAdjust(dstClient, [{ location_id: locationId, product_id: productId, quantity: Number(qty) || 0 }]);
}
async function setVariantInventoryAbsolute(dstClient, variantId, qty, locationId) {
  await inventoryAbsoluteAdjust(dstClient, [{ location_id: locationId, variant_id: variantId, quantity: Number(qty) || 0 }]);
}

// Readback (by SKU first; most reliable), then by product
async function readInventoryAtLocation(dstClient, { sku, productId, locationId }) {
  try {
    if (sku) {
      const res = await requestWithRetry(dstClient, {
        method: 'get',
        url: '/inventory/items',
        params: { 'sku:in': String(sku) }
      });
      const rows = res.data?.data || [];
      const row = rows.find(r => (r.location_id === locationId) || (r.location && r.location.id === locationId));
      if (row) return row;
    }
  } catch {}
  try {
    if (productId) {
      const res = await requestWithRetry(dstClient, {
        method: 'get',
        url: '/inventory/items',
        params: { 'product_id:in': String(productId) }
      });
      const rows = res.data?.data || [];
      const row = rows.find(r => (r.location_id === locationId) || (r.location && r.location.id === locationId));
      if (row) return row;
    }
  } catch {}
  return null;
}

// ---------------- Brands ----------------
async function migrateBrands() {
  console.log('\n==== BRANDS ====');
  const srcBrands = await pagedGetAll(src, '/catalog/brands');
  const dstBrands = await pagedGetAll(dst, '/catalog/brands');

  const dstByName = new Map(dstBrands.map(b => [norm(b.name), b]));
  const brandMap = new Map(); // srcBrandId -> dstBrandId

  for (const b of srcBrands) {
    const key = norm(b.name);
    if (!key) continue;
    let target = dstByName.get(key);
    if (!target && !dryRun) {
      const res = await requestWithRetry(dst, {
        method: 'post',
        url: '/catalog/brands',
        data: { name: b.name, meta_keywords: b.meta_keywords || [], meta_description: b.meta_description || '' }
      });
      target = res.data?.data;
      console.log(`+ Created brand: ${b.name} (#${target?.id})`);
    } else if (!target && dryRun) {
      console.log(`[DRY] Would create brand: ${b.name}`);
    }
    if (target) brandMap.set(b.id, target.id);
  }
  console.log(`Brand mappings: ${brandMap.size}`);
  return brandMap;
}

// ---------------- Categories ----------------
function buildCategoryPathMap(categories) {
  const byId = new Map(categories.map(c => [c.id, c]));
  const cache = new Map();
  function pathFor(cat) {
    if (cache.has(cat.id)) return cache.get(cat.id);
    const name = (cat.name || '').trim();
    if (!cat.parent_id || cat.parent_id === 0) {
      const p = `/${name}`;
      cache.set(cat.id, p);
      return p;
    }
    const parent = byId.get(cat.parent_id);
    const parentPath = parent ? pathFor(parent) : '';
    const p = `${parentPath}/${name}`;
    cache.set(cat.id, p);
    return p;
  }
  const idToPath = new Map(categories.map(c => [c.id, pathFor(c)]));
  return { byId, idToPath };
}
function sortCatsParentFirst(categories) {
  const visited = new Set();
  const order = [];
  const children = new Map();
  for (const c of categories) {
    const arr = children.get(c.parent_id || 0) || [];
    arr.push(c);
    children.set(c.parent_id || 0, arr);
  }
  function dfs(parentId) {
    const kids = children.get(parentId) || [];
    for (const k of kids) {
      if (!visited.has(k.id)) {
        visited.add(k.id);
        order.push(k);
        dfs(k.id);
      }
    }
  }
  dfs(0);
  return order.filter(Boolean);
}
async function migrateCategories() {
  console.log('\n==== CATEGORIES ====');
  const srcCats = await pagedGetAll(src, '/catalog/categories');
  const dstCats = await pagedGetAll(dst, '/catalog/categories');

  const { idToPath: srcIdToPath } = buildCategoryPathMap(srcCats);
  const { idToPath: dstIdToPath } = buildCategoryPathMap(dstCats);

  const dstPathToId = new Map([...dstIdToPath.entries()].map(([id, path]) => [norm(path), id]));
  const catMap = new Map(); // srcCatId -> dstCatId

  const ordered = sortCatsParentFirst(srcCats);
  const createdByPath = new Map();

  for (const c of ordered) {
    const path = srcIdToPath.get(c.id);
    const key = norm(path);
    let dstId = dstPathToId.get(key);
    if (!dstId && !dryRun) {
      let parent_id = 0;
      if (c.parent_id && c.parent_id !== 0) {
        const parentPath = norm(srcIdToPath.get(c.parent_id));
        parent_id = createdByPath.get(parentPath) || dstPathToId.get(parentPath) || 0;
      }
      const payload = {
        name: c.name,
        parent_id,
        description: c.description || '',
        is_visible: c.is_visible ?? true,
        sort_order: c.sort_order ?? 0
      };
      const res = await requestWithRetry(dst, { method: 'post', url: '/catalog/categories', data: payload });
      dstId = res.data?.data?.id;
      console.log(`+ Created category: ${path} (#${dstId})`);
      createdByPath.set(key, dstId);
    } else if (!dstId && dryRun) {
      console.log(`[DRY] Would create category: ${path}`);
    }
    if (!dstId) dstId = createdByPath.get(key);
    if (dstId) catMap.set(c.id, dstId);
  }

  console.log(`Category mappings: ${catMap.size}`);
  return catMap;
}

// ---------------- Products helpers ----------------
async function getProductAssets(client, productId) {
  const [customFields, images, options, variants] = await Promise.all([
    pagedGetAll(client, `/catalog/products/${productId}/custom-fields`),
    pagedGetAll(client, `/catalog/products/${productId}/images`),
    pagedGetAll(client, `/catalog/products/${productId}/options`),
    pagedGetAll(client, `/catalog/products/${productId}/variants`)
  ]);
  return { customFields, images, options, variants };
}

function hasRealVariants(variants = []) {
  return (variants || []).some(v => Array.isArray(v.option_values) && v.option_values.length > 0);
}

function baseProductPayload(p, brandMap, catMap, hasVariants) {
  const mappedBrandId = p.brand_id && brandMap.get(p.brand_id) ? brandMap.get(p.brand_id) : undefined;
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

    // INVENTORY
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

// Options: ensure/reuse
async function getAllDstOptions(dstClient, productId) {
  return await pagedGetAll(dstClient, `/catalog/products/${productId}/options`);
}
function optionPayload(opt) {
  const type = opt.type || 'multiple_choice';
  const values = (opt.option_values || []).map(v => ({
    label: v.label,
    is_default: v.is_default ?? false,
    sort_order: v.sort_order ?? 0
  }));
  return { display_name: opt.display_name || opt.name || 'Option', type, option_values: values };
}
async function ensureOptionsInDst(dstClient, productId, srcOptions = []) {
  const existing = await getAllDstOptions(dstClient, productId);
  const byName = new Map(existing.map(o => [norm(o.display_name), o]));
  const ensured = [];
  for (const srcOpt of (srcOptions || [])) {
    const nameKey = norm(srcOpt.display_name || srcOpt.name || '');
    if (!nameKey) continue;
    if (byName.has(nameKey)) {
      ensured.push(byName.get(nameKey));
      continue;
    }
    try {
      const res = await requestWithRetry(dstClient, {
        method: 'post',
        url: `/catalog/products/${productId}/options`, data: optionPayload(srcOpt)
      });
      const created = res.data?.data;
      if (created) {
        byName.set(nameKey, created);
        ensured.push(created);
      }
    } catch (e) {
      const msg = e?.message || '';
      if (msg.includes('has already been used on this product')) {
        const refreshed = await getAllDstOptions(dstClient, productId);
        const match = refreshed.find(o => norm(o.display_name) === nameKey);
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
function indexDstOptions(dstOptions = []) {
  const byName = new Map();
  for (const o of dstOptions) byName.set(norm(o.display_name || ''), o);
  return { byName };
}

// Option values
async function getOptionValues(dstClient, productId, optionId) {
  return await pagedGetAll(dstClient, `/catalog/products/${productId}/options/${optionId}/values`);
}
async function ensureOptionValue(dstClient, productId, dstOption, label) {
  if (!dstOption.__valMap) {
    const vals = await getOptionValues(dstClient, productId, dstOption.id);
    dstOption.__valMap = new Map(vals.map(v => [norm(v.label), v.id]));
  }
  const key = norm(label);
  let id = dstOption.__valMap.get(key);
  if (id) return id;
  const res = await requestWithRetry(dstClient, {
    method: 'post',
    url: `/catalog/products/${productId}/options/${dstOption.id}/values`,
    data: { label }
  });
  const created = res.data?.data;
  if (created?.id) {
    dstOption.__valMap.set(norm(created.label), created.id);
    return created.id;
  }
  return null;
}

// Variant mapping
async function mapVariantOptionValuesAsync({ productId, variant, dstIdx, dstClient }) {
  const ovs = Array.isArray(variant.option_values) ? variant.option_values : [];
  if (ovs.length === 0) return null;
  const mapped = [];
  for (const ov of ovs) {
    const optNameKey = norm(ov.option_display_name || '');
    const dstOpt = dstIdx.byName.get(optNameKey);
    if (!dstOpt) { console.log(`    ! Missing destination option "${ov.option_display_name}"`); return null; }
    const valId = await ensureOptionValue(dstClient, productId, dstOpt, ov.label || '');
    if (!valId) { console.log(`    ! Missing destination value "${ov.label}" under option "${dstOpt.display_name}"`); return null; }
    mapped.push({ option_id: dstOpt.id, id: valId });
  }
  return mapped;
}

// Images
async function uploadImageWithFallback(dstClient, productId, srcUrl, { is_thumbnail = false, sort_order = 0, description = '' } = {}) {
  try {
    const res = await requestWithRetry(dstClient, {
      method: 'post',
      url: `/catalog/products/${productId}/images`,
      data: { image_url: srcUrl, is_thumbnail, sort_order, description }
    });
    return { method: 'url', data: res.data?.data };
  } catch (err) {
    const status = err?.message?.match(/"status":(\d{3})/)?.[1] || '';
    console.log(`   ↪️ image_url failed (${status || 'err'}). Falling back to binary upload…`);
  }
  const filename = (() => {
    const urlPart = srcUrl.split('?')[0].split('/').pop() || 'image';
    const extByMime = (ct) => (mime.extension(ct) ? `.${mime.extension(ct)}` : '');
    return urlPart.includes('.') ? urlPart : urlPart + extByMime('image/jpeg');
  })();
  const imgResp = await requestWithRetry(axios, { method: 'get', url: srcUrl, responseType: 'arraybuffer' });
  const buf = Buffer.from(imgResp.data);
  const contentType = imgResp.headers?.['content-type'] || 'application/octet-stream';
  const form = new FormData();
  form.append('image_file', buf, { filename, contentType });
  form.append('is_thumbnail', String(is_thumbnail));
  form.append('sort_order', String(sort_order));
  if (description) form.append('description', description);
  const res2 = await requestWithRetry(dstClient, {
    method: 'post', url: `/catalog/products/${productId}/images`, headers: form.getHeaders(), data: form
  });
  return { method: 'file', data: res2.data?.data };
}

// Custom fields
async function getDstCustomFields(dstClient, productId) {
  const res = await requestWithRetry(dstClient, { method: 'get', url: `/catalog/products/${productId}/custom-fields` });
  return res.data?.data || [];
}
async function ensureCustomFieldsInDst(dstClient, productId, srcCustomFields = [], strategy = 'pair') {
  if (!Array.isArray(srcCustomFields) || srcCustomFields.length === 0) return;
  let existing = await getDstCustomFields(dstClient, productId);
  if (strategy === 'overwrite_by_name') {
    const byName = new Map(existing.map(cf => [norm(cf.name), cf]));
    for (const cf of srcCustomFields) {
      const name = String(cf.name ?? '');
      const value = String(cf.value ?? '');
      const key = norm(name);
      const match = byName.get(key);
      if (match) {
        if (String(match.value ?? '') !== value) {
          await requestWithRetry(dstClient, { method: 'put', url: `/catalog/products/${productId}/custom-fields/${match.id}`, data: { name, value } });
        }
      } else {
        const res = await requestWithRetry(dstClient, { method: 'post', url: `/catalog/products/${productId}/custom-fields`, data: { name, value } });
        const created = res.data?.data;
        if (created) byName.set(key, created);
      }
    }
    return;
  }
  // pair strategy
  const have = new Set(existing.map(cf => `${norm(cf.name)}::${norm(String(cf.value ?? ''))}`));
  for (const cf of srcCustomFields) {
    const name = String(cf.name ?? '');
    const value = String(cf.value ?? '');
    const key = `${norm(name)}::${norm(value)}`;
    if (have.has(key)) continue;
    const res = await requestWithRetry(dstClient, { method: 'post', url: `/catalog/products/${productId}/custom-fields`, data: { name, value } });
    const created = res.data?.data;
    if (created) have.add(`${norm(created.name)}::${norm(String(created.value ?? ''))}`);
  }
}

// ---------------- Source fetch with server-side filters ----------------
async function fetchSourceProducts(cli) {
  if (Array.isArray(cli.onlyIds) && cli.onlyIds.length) {
    const chunk = (arr, n) => arr.reduce((a, _, i) => (i % n ? a : [...a, arr.slice(i, i + n)]), []);
    const chunks = chunk(cli.onlyIds, 50);
    const out = [];
    for (const ids of chunks) {
      const res = await requestWithRetry(src, { method: 'get', url: '/catalog/products', params: { limit: Number(PAGE_SIZE), 'id:in': ids.join(',') } });
      out.push(...(res.data?.data || []));
    }
    return out;
  }
  if (cli.onlyName) {
    const exact = await requestWithRetry(src, { method: 'get', url: '/catalog/products', params: { name: cli.onlyName, limit: 50 } });
    let list = exact.data?.data || [];
    if (!list.length) {
      const like = await requestWithRetry(src, { method: 'get', url: '/catalog/products', params: { 'name:like': cli.onlyName, limit: 50 } });
      list = like.data?.data || [];
      if (!list.length) {
        const kw = await requestWithRetry(src, { method: 'get', url: '/catalog/products', params: { keyword: cli.onlyName, limit: 50 } });
        list = kw.data?.data || [];
      }
    }
    return list;
  }
  if (cli.nameRegex) {
    const kw = await requestWithRetry(src, { method: 'get', url: '/catalog/products', params: { keyword: ' ', limit: Number(PAGE_SIZE) } });
    return kw.data?.data || [];
  }
  return await pagedGetAll(src, '/catalog/products', { include: 'custom_fields,options,variants' });
}

// ---------------- Migrate Products ----------------
async function migrateProducts(brandMap, catMap, defaultLocationId) {
  console.log('\n==== PRODUCTS ====');
  const serverSide = await fetchSourceProducts(CLI);
  let products = serverSide;

  if (CLI.startAfterId) products = products.filter(p => p.id > CLI.startAfterId);
  if (CLI.nameRegex) products = products.filter(p => CLI.nameRegex.test(String(p.name || '')));
  if (CLI.onlyName) {
    const needle = CLI.onlyName.toLowerCase();
    products = products.filter(p => String(p.name || '').toLowerCase().includes(needle));
  }
  if (Array.isArray(CLI.onlyIds) && CLI.onlyIds.length) {
    const set = new Set(CLI.onlyIds);
    products = products.filter(p => set.has(p.id));
  }
  if (CLI.limit && CLI.limit > 0) products = products.slice(0, CLI.limit);

  console.log(`Total source products (after filters): ${products.length}`);

  let processed = 0, skippedCount = 0, failed = 0;

  for (const p of products) {
    try {
      const { customFields, images, options, variants } = await getProductAssets(src, p.id);
      const realVariantFlag = hasRealVariants(variants);
      const payload = baseProductPayload(p, brandMap, catMap, realVariantFlag);

      if (dryRun) {
        console.log(`[DRY] Would create/update product: ${p.name} (tracking=${payload.inventory_tracking})`);
        processed++;
        continue;
      }

      const strategy = (NAME_DEDUP_STRATEGY || 'update').toLowerCase();
      const suffix = NAME_DEDUP_SUFFIX || ' [sandbox]';

      const { product: dstProduct, created, skipped: isSkipped } = await upsertProductByName({
        dstClient: dst, payload, sourceProduct: p, strategy, suffix
      });

      if (isSkipped) {
        console.log(`~ Duplicate name skipped: ${p.name}`);
        skippedCount++;
        continue;
      }

      console.log(`${created ? '+ Created' : '~ Updated'} product: ${p.name} (#${p.id} -> #${dstProduct.id})`);
      const newId = dstProduct.id;

      // Debug: show current catalog inventory fields
      if (CLI.debugInventory) {
        const dbg = await requestWithRetry(dst, { method: 'get', url: `/catalog/products/${newId}` });
        const dbgP = dbg.data?.data;
        console.log(`  ℹ️  Catalog says: inventory_tracking=${dbgP?.inventory_tracking}, inventory_level=${dbgP?.inventory_level}`);
      }

      // OPTIONS (idempotent)
      if ((options || []).length > 0) await ensureOptionsInDst(dst, newId, options);
      const allDstOptions = await getAllDstOptions(dst, newId);
      const dstIdx = indexDstOptions(allDstOptions);

      // VARIANTS
      const skuStrategy = (VARIANT_SKU_STRATEGY || 'suffix').toLowerCase();
      const skuSuffix = VARIANT_SKU_SUFFIX || '-SBX';
      const existingVariants = await pagedGetAll(dst, `/catalog/products/${newId}/variants`);
      const bySkuOnProduct = new Map((existingVariants || []).filter(ev => ev.sku).map(ev => [String(ev.sku), ev]));

      let createdVariants = 0;

      for (const v of (variants || [])) {
        const mappedOVs = await mapVariantOptionValuesAsync({ productId: newId, variant: v, dstIdx, dstClient: dst });
        if (!mappedOVs || mappedOVs.length === 0) {
          // base variant (no options): skip creating
          continue;
        }

        const basePayload = {
          price: v.price ?? undefined,
          inventory_level: v.inventory_level ?? undefined,
          option_values: mappedOVs
        };
        let sku = v.sku || undefined;

        if (sku && bySkuOnProduct.has(sku)) {
          const existing = bySkuOnProduct.get(sku);
          await requestWithRetry(dst, { method: 'put', url: `/catalog/products/${newId}/variants/${existing.id}`, data: { ...basePayload, sku } });
          createdVariants++;
          continue;
        }

        let payloadV = { ...basePayload, sku };
        const tryCreate = async () => requestWithRetry(dst, { method: 'post', url: `/catalog/products/${newId}/variants`, data: payloadV });

        try {
          await tryCreate();
          createdVariants++;
        } catch (e) {
          const msg = e?.message || '';
          const isSkuConflict = msg.includes('"status":409') && /Sku .* is not unique/i.test(msg);
          if (!isSkuConflict) throw e;

          if (skuStrategy === 'skip') { console.log(`  ~ Skipping variant (SKU conflict): ${sku}`); continue; }
          if (skuStrategy === 'blank') { delete payloadV.sku; await tryCreate(); createdVariants++; continue; }

          const original = String(sku);
          let attempt = 0;
          while (attempt < 10) {
            attempt += 1;
            const candidate = `${original}${skuSuffix}${attempt > 1 ? `-${attempt}` : ''}`;
            payloadV.sku = candidate;
            try {
              await tryCreate();
              console.log(`  ~ SKU conflict resolved: ${original} → ${candidate}`);
              createdVariants++; break;
            } catch (err2) {
              const msg2 = err2?.message || '';
              if (!(msg2.includes('"status":409') && /Sku .* is not unique/i.test(msg2))) throw err2;
              if (attempt === 10) console.log(`  ! Gave up suffixing SKU for ${original}`);
            }
          }
        }
      }

      // CUSTOM FIELDS
      if (!CLI.skipCustomFields) {
        await ensureCustomFieldsInDst(dst, newId, customFields || [], (CF_DEDUP_STRATEGY || 'pair').toLowerCase());
      } else {
        console.log('  ~ Skipped custom fields by CLI flag');
      }

      // IMAGES
      if (!CLI.skipImages) {
        const srcImages = images || [];
        console.log(`  • Found ${srcImages.length} image(s) on source`);
        for (const img of srcImages) {
          const srcUrl = img.url_zoom || img.url_standard || img.image_url || img.url_thumbnail || img.url_tiny;
          if (!srcUrl) { console.log('   ! Skipping image (no usable URL on source)'); continue; }
          try {
            const result = await uploadImageWithFallback(dst, newId, srcUrl, {
              is_thumbnail: img.is_thumbnail ?? false, sort_order: img.sort_order ?? 0, description: img.description || ''
            });
            console.log(`   + Image via ${result.method}: ${result.data?.id || ''}`);
          } catch (e) {
            console.log(`   ❌ Image failed for ${p.name}: ${e.message}`);
          }
        }
        try {
          const check = await requestWithRetry(dst, { method: 'get', url: `/catalog/products/${newId}/images` });
          const count = (check.data?.data || []).length;
          console.log(`  ✔ Images now on destination: ${count}`);
        } catch (e) {
          console.log(`  ! Couldn’t verify images: ${e.message}`);
        }
      } else {
        console.log('  ~ Skipped images by CLI flag');
      }

      // ----- INVENTORY via Inventory API -----
      try {
        const locationId = defaultLocationId;

        if (!realVariantFlag) {
          // product-level
          const qty = p.inventory_level ?? 0;
          await setProductInventoryAbsolute(dst, newId, qty, locationId);
          console.log(`  ~ Set PRODUCT-level stock to ${qty} at location ${locationId}`);
          if (CLI.debugInventory) {
            const row = await readInventoryAtLocation(dst, { sku: p.sku, productId: newId, locationId });
            console.log(`  ${row ? '✅' : '⚠️'} Readback at location ${locationId}: ${row ? (row.inventory?.available ?? row.quantity ?? '(?)') : 'not found'}`);
          }
        } else {
          // variant-level
          const dstVariantsLatest = await pagedGetAll(dst, `/catalog/products/${newId}/variants`);
          const srcBySku = new Map((variants || []).filter(v => v.sku).map(v => [String(v.sku), v]));
          const items = [];
          for (const dv of (dstVariantsLatest || [])) {
            if (!dv.sku) continue;
            const sv = srcBySku.get(String(dv.sku));
            if (sv && sv.inventory_level != null) {
              items.push({ location_id: locationId, variant_id: dv.id, quantity: Number(sv.inventory_level) || 0 });
            }
          }
          if (items.length) {
            await inventoryAbsoluteAdjust(dst, items, `set variant stock for product #${newId}`);
            console.log(`  ~ Set stock for ${items.length} VARIANT(s) via Inventory API at location ${locationId}`);
            if (CLI.debugInventory && items.length === 1) {
              const onlySku = (variants || []).find(v => v.sku)?.sku;
              const row = await readInventoryAtLocation(dst, { sku: onlySku, productId: newId, locationId });
              console.log(`  ${row ? '✅' : '⚠️'} Readback at location ${locationId}: ${row ? (row.inventory?.available ?? row.quantity ?? '(?)') : 'not found'}`);
            }
          } else {
            // no variant mapping -> fall back to product-level
            const fallback = p.inventory_level ?? 0;
            await setProductInventoryAbsolute(dst, newId, fallback, locationId);
            console.log(`  ~ Fallback: set PRODUCT-level stock to ${fallback} at location ${locationId}`);
            if (CLI.debugInventory) {
              const row = await readInventoryAtLocation(dst, { sku: p.sku, productId: newId, locationId });
              console.log(`  ${row ? '✅' : '⚠️'} Readback at location ${locationId}: ${row ? (row.inventory?.available ?? row.quantity ?? '(?)') : 'not found'}`);
            }
          }
        }

      } catch (e) {
        console.log(`  ! Inventory set failed: ${e.message}`);
        // Last resort fallback: legacy catalog field
        try {
          const qty = p.inventory_level ?? 0;
          await requestWithRetry(dst, { method: 'put', url: `/catalog/products/${newId}`, data: { inventory_tracking: 'product', inventory_level: qty } });
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

// ---------------- Product upsert ----------------
async function findDstProductByName(dstClient, name) {
  const res = await requestWithRetry(dstClient, { method: 'get', url: '/catalog/products', params: { name, limit: 50 } });
  const list = res.data?.data || [];
  const exact = list.find(p => namesEqual(p.name, name));
  if (exact) return exact;
  const res2 = await requestWithRetry(dstClient, { method: 'get', url: '/catalog/products', params: { keyword: name, limit: 50 } });
  const list2 = res2.data?.data || [];
  return list2.find(p => namesEqual(p.name, name)) || null;
}
async function upsertProductByName({ dstClient, payload, sourceProduct, strategy = 'update', suffix = ' [sandbox]' }) {
  const existing = await findDstProductByName(dstClient, sourceProduct.name);
  if (existing && strategy === 'skip') {
    console.log(`~ Skipping (duplicate name): ${sourceProduct.name} => existing #${existing.id}`);
    return { product: existing, created: false, skipped: true };
  }
  if (existing && strategy === 'suffix') {
    const uniquePayload = { ...payload, name: `${payload.name}${suffix}` };
    const res = await requestWithRetry(dstClient, { method: 'post', url: '/catalog/products', data: uniquePayload });
    return { product: res.data?.data, created: true, skipped: false };
  }
  if (existing) {
    const res = await requestWithRetry(dstClient, { method: 'put', url: `/catalog/products/${existing.id}`, data: payload });
    return { product: res.data?.data, created: false, skipped: false };
  }
  const res = await requestWithRetry(dstClient, { method: 'post', url: '/catalog/products', data: payload });
  return { product: res.data?.data, created: true, skipped: false };
}

// ---------------- Main ----------------
(async function main() {
  console.log('🚚 BigCommerce Catalog Migrator\n');
  try {
    const brandMap = await migrateBrands();
    const catMap = await migrateCategories();
    const defaultLocationId = CLI.locationId || await getDefaultLocationId(dst);
    await migrateProducts(brandMap, catMap, defaultLocationId);
    console.log('\n✅ Done.');
  } catch (e) {
    console.error('\n❌ Fatal:', e.message);
    process.exit(1);
  }
})();
