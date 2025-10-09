#!/usr/bin/env node
// BigCommerce Catalog Migrator - Main Entry Point
// Migrate Brands, Categories, Products, Options, Variants, Custom Fields, and Images
// with idempotency, SKU conflict handling, resilient images, and Inventory API support.
// Supports migration to both BigCommerce and Shopify stores.

import { config, validateConfig } from './config/env.js';
import { parseCli } from './config/cli.js';
import { createApiClient } from './api/client.js';
import { createShopifyClient } from './api/shopifyClient.js';
import { migrateBrands } from './migrators/brands.js';
import { migrateCategories } from './migrators/categories.js';
import { migrateProducts } from './migrators/products.js';
import { migrateShopifyBrands } from './migrators/shopifyBrands.js';
import { migrateShopifyCategories } from './migrators/shopifyCategories.js';
import { migrateShopifyProducts } from './migrators/shopifyProducts.js';
import { getDefaultLocationId } from './services/inventory.js';

/**
 * Main migration orchestrator
 */
async function main() {
  console.log('🚚 BigCommerce Catalog Migrator\n');
  
  try {
    // Parse CLI arguments
    const cli = parseCli();
    
    // Determine if migrating to Shopify
    const toShopify = cli.toShopify || false;
    
    // Validate configuration
    validateConfig(toShopify);
    
    // Determine dry run mode (CLI overrides env)
    let dryRun = config.settings.dryRun;
    if (cli.dryRun !== undefined) {
      dryRun = cli.dryRun;
    }
    
    // Create source API client (always BigCommerce)
    const srcClient = createApiClient(
      config.source.storeHash,
      config.source.accessToken,
      config.source.baseUrl
    );
    
    console.log('SRC base:', srcClient.defaults.baseURL);
    console.log('Mode:', dryRun ? 'DRY RUN (read-only)' : 'WRITE');
    
    if (toShopify) {
      // Migration to Shopify
      console.log('Target: Shopify Store');
      console.log('Shop:', config.shopify.shopDomain);
      console.log('');
      
      const shopifyClient = createShopifyClient(
        config.shopify.shopDomain,
        config.shopify.accessToken,
        config.shopify.apiVersion
      );
      
      // Migrate brands (to Shopify vendors)
      const brandMap = await migrateShopifyBrands(srcClient, shopifyClient, dryRun);
      
      // Migrate categories (to Shopify collections)
      const collectionMap = await migrateShopifyCategories(srcClient, shopifyClient, dryRun);
      
      // Migrate products
      await migrateShopifyProducts({
        srcClient,
        shopifyClient,
        brandMap,
        collectionMap,
        cli,
        config,
        dryRun
      });
      
    } else {
      // Migration to BigCommerce (original functionality)
      console.log('Target: BigCommerce Store');
      console.log('');
      
      const dstClient = createApiClient(
        config.destination.storeHash,
        config.destination.accessToken,
        config.destination.baseUrl
      );
      
      console.log('DST base:', dstClient.defaults.baseURL);
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
    }
    
    console.log('\n✅ Done.');
  } catch (e) {
    console.error('\n❌ Fatal:', e.message);
    process.exit(1);
  }
}

// Run the migration
main();
