// Environment configuration
import 'dotenv/config';

export const config = {
  source: {
    storeHash: process.env.SRC_STORE_HASH,
    accessToken: process.env.SRC_ACCESS_TOKEN,
    baseUrl: process.env.SRC_BASE_URL,
  },
  destination: {
    storeHash: process.env.DST_STORE_HASH,
    accessToken: process.env.DST_ACCESS_TOKEN,
    baseUrl: process.env.DST_BASE_URL,
  },
  settings: {
    pageSize: parseInt(process.env.PAGE_SIZE || '250', 10),
    dryRun: (process.env.DRY_RUN || 'false').toLowerCase() === 'true',
  },
  strategies: {
    nameDedup: process.env.NAME_DEDUP_STRATEGY,
    nameDedupSuffix: process.env.NAME_DEDUP_SUFFIX,
    variantSku: process.env.VARIANT_SKU_STRATEGY,
    variantSkuSuffix: process.env.VARIANT_SKU_SUFFIX,
    customFieldDedup: process.env.CF_DEDUP_STRATEGY,
  },
  inventory: {
    locationId: parseInt(process.env.INV_LOCATION_ID || '1', 10),
  },
};

// Validate required environment variables
export function validateConfig() {
  const { source, destination } = config;
  
  if (!source.storeHash || !source.accessToken || !destination.storeHash || !destination.accessToken) {
    throw new Error('❌ Missing env vars. Set SRC_STORE_HASH, SRC_ACCESS_TOKEN, DST_STORE_HASH, DST_ACCESS_TOKEN.');
  }
}
