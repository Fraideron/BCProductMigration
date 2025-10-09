# Categories/Collections Mapping - Debug Guide

## Issue

BigCommerce product categories are not appearing as collections in Shopify products. The collection field is empty.

## How It Should Work

1. **Step 1**: Categories are migrated from BigCommerce → Shopify Custom Collections
2. **Step 2**: A mapping is created: BC Category ID → Shopify Collection ID
3. **Step 3**: When products are migrated, they're added to collections using the "Collects" API

## Changes Made for Debugging

### Added Comprehensive Logging

The migration now shows:

**At the Start of Product Migration:**
```
==== PRODUCTS (to Shopify) ====
Brand mappings available: 5
Collection mappings available: 12
Collection map (BC Cat ID -> Shopify Collection ID): 23->456789, 24->456790, ... (12 total)
```

**For Each Product:**
```
Processing: Product Name (#123)
  BC Product categories: [23, 24, 25]

  → Attempting to add product to 3 collection(s)...
    • BC Category #23 → Shopify Collection #456789
    ✓ Added to collection #456789
    • BC Category #24 → Shopify Collection #456790
    ✓ Added to collection #456790
  ✓ Product added to 2 collection(s)
```

## Debugging Steps

### Step 1: Check Collection Map Size

When you run the migration, look for this line at the start:

```
Collection mappings available: X
```

**If X = 0:**
- ❌ Categories haven't been migrated to Shopify yet
- The product migration will have nothing to map to
- **Solution**: Make sure categories are migrated before products (they should be automatic)

**If X > 0:**
- ✅ Categories have been migrated
- The mapping is available
- Continue to Step 2

### Step 2: Check Product Categories

For each product, look for:

```
BC Product categories: [23, 24, 25]
```

**If you see `none` or an empty array `[]`:**
- The BigCommerce product doesn't have categories assigned
- **Solution**: Go to BigCommerce Admin → Products → Edit Product → Categories tab and assign categories

**If you see category IDs:**
- ✅ Product has categories
- Continue to Step 3

### Step 3: Check Category Mapping

Look for lines like:

```
• BC Category #23 → Shopify Collection #456789
```

**If you see:**
```
⚠️ BC Category #23 not found in collection map
```

**This means:**
- The category exists in BigCommerce
- But it wasn't migrated to Shopify (or migration failed)
- Check the category migration section output earlier in the console

**Solution:**
1. Look for the category migration output:
   ```
   ==== CATEGORIES (to Shopify Collections) ====
   + Created collection: Category Name (#456789)
   ```
2. If you don't see your category there, it failed to migrate
3. Common reasons:
   - Category has no name (blank)
   - API error during creation
   - Category is invisible/disabled

### Step 4: Check Collects API Errors

Look for error messages when adding to collections:

```
❌ Failed to add to collection #456789: error message here
Full error: {...}
```

**Common Errors:**

**"already exists" or "taken":**
- This is OK! Product is already in the collection
- Migration handles this automatically

**"404 Not Found":**
- Collection doesn't exist in Shopify
- The mapping is outdated or collection was deleted
- **Solution**: Re-run category migration

**"403 Forbidden":**
- API permissions issue
- **Solution**: Add `write_products` scope to your Shopify app

**"422 Unprocessable Entity":**
- Invalid product_id or collection_id
- Usually means the product wasn't created successfully
- Check earlier in the output for product creation errors

## Testing

### Test with One Product

```bash
# Test with a specific product
npm start -- --write --to-shopify --only-name="Test Product"
```

Watch for:
1. ✅ "Collection mappings available: X" (X > 0)
2. ✅ "BC Product categories: [...]" (not empty)
3. ✅ "Added to collection #..."

### Check in Shopify Admin

After migration:

1. Go to **Products** in Shopify Admin
2. Click on the migrated product
3. Scroll down to **Product organization** section
4. Look for **Collections** - should show the collection names

### Check via API

```bash
# Get product with its collections
curl 'https://your-store.myshopify.com/admin/api/2024-01/products/PRODUCT_ID.json' \
  -H 'X-Shopify-Access-Token: YOUR_TOKEN'
```

Look for `collections` in the response (may be empty in product endpoint).

Check collects instead:
```bash
# Get all collects for a product
curl 'https://your-store.myshopify.com/admin/api/2024-01/products/PRODUCT_ID/collections.json' \
  -H 'X-Shopify-Access-Token: YOUR_TOKEN'
```

Or check from collection side:
```bash
# Get all products in a collection
curl 'https://your-store.myshopify.com/admin/api/2024-01/collections/COLLECTION_ID/products.json' \
  -H 'X-Shopify-Access-Token: YOUR_TOKEN'
```

## Common Solutions

### Problem 1: No Collection Mappings Available

**Symptom:**
```
Collection mappings available: 0
⚠️ No collection mappings found. Categories may not have been migrated yet.
```

**Solution:**
The migration runs categories automatically, but if it failed:

1. Check earlier in console output for category migration section
2. Look for errors like:
   ```
   ❌ Failed to create collection: error message
   ```
3. Fix the errors and re-run the migration

**Manual category check:**
```bash
# Check BigCommerce categories
curl 'https://api.bigcommerce.com/stores/YOUR_STORE/v3/catalog/categories' \
  -H 'X-Auth-Token: YOUR_TOKEN'

# Check Shopify collections
curl 'https://your-store.myshopify.com/admin/api/2024-01/custom_collections.json' \
  -H 'X-Shopify-Access-Token: YOUR_TOKEN'
```

### Problem 2: Products Have No Categories

**Symptom:**
```
BC Product categories: none
⊘ No categories assigned to this product in BigCommerce
```

**Solution:**
In BigCommerce Admin:
1. Go to Products → Edit Product
2. Click **Categories** tab
3. Select one or more categories
4. Save
5. Re-run migration for that product

### Problem 3: Categories Not Mapping

**Symptom:**
```
BC Product categories: [23, 24]
  ⚠️ BC Category #23 not found in collection map
```

**Solution:**
Check if category #23 was migrated:

1. Look for category migration output:
   ```
   + Created collection: YourCategory (#456789)
   ```
2. If missing, the category may have failed to migrate
3. Check category migration section for errors
4. Categories might be invisible or have other issues

### Problem 4: Collects API Failing

**Symptom:**
```
❌ Failed to add to collection #456789: Shopify request failed...
```

**Solution:**
1. **Check API permissions**: Need `write_products` scope
2. **Check collection exists**: May have been deleted after migration
3. **Check product ID**: Product must exist in Shopify
4. **Try manual test**:
   ```bash
   curl -X POST \
     'https://your-store.myshopify.com/admin/api/2024-01/collects.json' \
     -H 'X-Shopify-Access-Token: YOUR_TOKEN' \
     -H 'Content-Type: application/json' \
     -d '{
       "collect": {
         "product_id": 123456,
         "collection_id": 789012
       }
     }'
   ```

## Migration Order

The migration runs in this order automatically:

1. **Brands** → Shopify Vendors
2. **Categories** → Shopify Collections (creates mapping)
3. **Products** → Shopify Products (uses mapping to add to collections)

You cannot skip step 2! Categories must be migrated for products to be added to collections.

## Expected Console Output

A successful category mapping looks like:

```
==== CATEGORIES (to Shopify Collections) ====
+ Created collection: Electronics (#456789)
+ Created collection: Accessories (#456790)
~ Collection exists: Clothing (#456791)
Category mappings: 3

==== PRODUCTS (to Shopify) ====
Collection mappings available: 3
Collection map (BC Cat ID -> Shopify Collection ID): 10->456789, 11->456790, 12->456791

Processing: Test Product (#123)
  BC Product categories: [10, 11]

  → Attempting to add product to 2 collection(s)...
    • BC Category #10 → Shopify Collection #456789
    ✓ Added to collection #456789
    • BC Category #11 → Shopify Collection #456790
    ✓ Added to collection #456790
  ✓ Product added to 2 collection(s)
```

## Files Modified

1. `src/migrators/shopifyProducts.js` - Added extensive category mapping logging
2. `CATEGORIES_FIX_SUMMARY.md` - This troubleshooting guide

## Still Not Working?

If categories still aren't mapping after checking all the above:

1. Share console output from:
   ```bash
   npm start -- --write --to-shopify --only-id=PRODUCT_ID
   ```

2. Check BigCommerce product data:
   ```bash
   curl 'https://api.bigcommerce.com/stores/YOUR_STORE/v3/catalog/products/PRODUCT_ID' \
     -H 'X-Auth-Token: YOUR_TOKEN'
   ```
   Look for `categories` field

3. Check Shopify collections manually in Admin

4. Try manual collects API call to verify it works

