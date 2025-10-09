# Dimensions Migration Feature

## Overview
Added support for migrating product dimensions (width, height, depth) from BigCommerce to Shopify as part of the product migration process.

## What Was Added

### 1. Code Changes in `src/migrators/shopifyProducts.js`

#### Modified `buildShopifyVariants()` function
- Added temporary fields to store BigCommerce dimensions: `_bc_width`, `_bc_height`, `_bc_depth`
- Supports both product-level and variant-level dimensions
- Falls back to product dimensions if variant dimensions are not available

```javascript
// For single variant products
_bc_width: bcProduct.width,
_bc_height: bcProduct.height,
_bc_depth: bcProduct.depth,

// For multiple variants
_bc_width: variant.width ?? bcProduct.width,
_bc_height: variant.height ?? bcProduct.height,
_bc_depth: variant.depth ?? bcProduct.depth,
```

#### New Function: `createVariantDimensionMetafields()`
- Creates Shopify metafields for each dimension (width, height, depth)
- Stores dimensions in the `dimensions` namespace
- Uses `number_decimal` type for proper numeric handling
- Skips zero, empty, or null values
- Handles existing metafield errors gracefully

#### Updated Migration Flow
- After product creation/update, dimensions are added to each variant
- Iterates through all variants and creates metafields for non-empty dimensions
- Provides detailed console logging showing which dimensions were added

### 2. Documentation Updates

#### README.md
- Added dimensions to the features list
- Feature line: "✅ Weight & Dimensions → migrates product dimensions (width, height, depth) to Shopify metafields"

#### CHANGES.txt
- Updated platform mappings section
- Added version 2.1.1 with dimension migration features
- Documented the implementation details

#### SHOPIFY_MIGRATION.md
- Updated platform mapping table
- Added two new rows:
  - Weight → Variant Weight (in pounds)
  - Dimensions → Variant Metafields (in `dimensions` namespace)

#### QUICK_START_SHOPIFY.md
- Updated "What Gets Migrated" section
- Added: "✅ Weight & Dimensions (width, height, depth)"

## How It Works

### During Migration

1. **Dimension Extraction**: When building variants, the script extracts dimensions from:
   - Variant-level dimensions (if available)
   - Product-level dimensions (as fallback)

2. **Metafield Creation**: After product/variant creation in Shopify:
   - Each variant with non-zero dimensions gets three metafields:
     - `dimensions.width`
     - `dimensions.height`
     - `dimensions.depth`

3. **Logging**: Console output shows:
   ```
   ✓ Added dimensions to variant #12345 (W:10, H:5, D:3)
   ```

### Data Storage in Shopify

Dimensions are stored as **variant metafields** in the `custom` namespace:

```json
{
  "metafield": {
    "namespace": "custom",
    "key": "dimension_width",
    "value": "10.5",
    "type": "number_decimal"
  }
}
```

**Metafield Keys:**
- `custom.dimension_width` - Product width
- `custom.dimension_height` - Product height
- `custom.dimension_depth` - Product depth/length

## Benefits

1. ✅ **Complete Data Migration**: No product dimension data is lost during migration
2. ✅ **Flexible Fallback**: Uses variant dimensions when available, falls back to product dimensions
3. ✅ **Proper Data Types**: Uses `number_decimal` type for accurate numeric values
4. ✅ **Clean Data**: Skips zero/empty values to avoid cluttering Shopify with meaningless data
5. ✅ **Error Handling**: Gracefully handles duplicate metafields and API errors
6. ✅ **Detailed Logging**: Clear console output shows what dimensions were migrated

## Accessing Dimensions in Shopify

After migration, you can access dimensions via:

### Shopify Admin API
```bash
GET /admin/api/2024-01/variants/{variant_id}/metafields.json?namespace=custom
```

Filter for dimension metafields:
```bash
GET /admin/api/2024-01/variants/{variant_id}/metafields.json?namespace=custom&key=dimension_width
```

### Shopify Liquid (in themes)
```liquid
{{ variant.metafields.custom.dimension_width }}
{{ variant.metafields.custom.dimension_height }}
{{ variant.metafields.custom.dimension_depth }}
```

Example usage in theme:
```liquid
{% if variant.metafields.custom.dimension_width %}
  <div class="product-dimensions">
    <p>Dimensions: 
      {{ variant.metafields.custom.dimension_width }}" W × 
      {{ variant.metafields.custom.dimension_height }}" H × 
      {{ variant.metafields.custom.dimension_depth }}" D
    </p>
  </div>
{% endif %}
```

### Shopify GraphQL
```graphql
query {
  productVariant(id: "gid://shopify/ProductVariant/123") {
    metafield(namespace: "custom", key: "dimension_width") {
      value
    }
    metafield(namespace: "custom", key: "dimension_height") {
      value
    }
    metafield(namespace: "custom", key: "dimension_depth") {
      value
    }
  }
}
```

## Migration Example

### BigCommerce Product
```json
{
  "id": 123,
  "name": "Test Product",
  "weight": 5.5,
  "width": 10,
  "height": 8,
  "depth": 6
}
```

### After Migration to Shopify
- **Weight**: Stored in `variant.weight` (5.5 lb)
- **Width**: Stored in metafield `dimensions.width` (10)
- **Height**: Stored in metafield `dimensions.height` (8)
- **Depth**: Stored in metafield `dimensions.depth` (6)

## Notes

- Dimensions are assumed to be in inches (BigCommerce default)
- Weight is migrated in pounds (lb)
- Zero values are not migrated (to keep data clean)
- Existing metafields are not overwritten
- Each variant can have its own dimensions

## Version

Feature added in version **2.1.1** (October 2025)

