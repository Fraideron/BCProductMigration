#!/usr/bin/env node
// BigCommerce Catalog Migrator - Main Entry Point
// Migrate Brands, Categories, Products, Options, Variants, Custom Fields, and Images
// with idempotency, SKU conflict handling, resilient images, and Inventory API support.

import { config, validateConfig } from './config/env.js';
import { parseCli } from './config/cli.js';
import { createApiClient } from './api/client.js';
import { migrateBrands } from './migrators/brands.js';
import { migrateCategories } from './migrators/categories.js';
import { migrateProducts } from './migrators/products.js';
import { getDefaultLocationId } from './services/inventory.js';

/**
 * Main migration orchestrator
 */
async function main() {
  console.log('🚚 BigCommerce Catalog Migrator\n');
  
  try {
    // Validate configuration
    validateConfig();
    
    // Parse CLI arguments
    const cli = parseCli();
    
    // Determine dry run mode (CLI overrides env)
    let dryRun = config.settings.dryRun;
    if (cli.dryRun !== undefined) {
      dryRun = cli.dryRun;
    }
    
    // Create API clients
    const srcClient = createApiClient(
      config.source.storeHash,
      config.source.accessToken,
      config.source.baseUrl
    );
    
    const dstClient = createApiClient(
      config.destination.storeHash,
      config.destination.accessToken,
      config.destination.baseUrl
    );
    
    console.log('SRC base:', srcClient.defaults.baseURL);
    console.log('DST base:', dstClient.defaults.baseURL);
    console.log('Mode:', dryRun ? 'DRY RUN (read-only)' : 'WRITE');
    console.log('');
    
    // Migrate brands
    const brandMap = await migrateBrands(srcClient, dstClient, dryRun);
    
    // Migrate categories
    const catMap = await migrateCategories(srcClient, dstClient, dryRun);
    
    // Get default location ID for inventory
    const defaultLocationId = cli.locationId || await getDefaultLocationId(
      dstClient,
      config.inventory.locationId
    );
    
    // Migrate products (and their options, variants, custom fields, images, inventory)
    await migrateProducts({
      srcClient,
      dstClient,
      brandMap,
      catMap,
      defaultLocationId,
      cli,
      config,
      dryRun
    });
    
    console.log('\n✅ Done.');
  } catch (e) {
    console.error('\n❌ Fatal:', e.message);
    process.exit(1);
  }
}

// Run the migration
main();
