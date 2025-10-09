# Troubleshooting: Dimensions Not Appearing in Shopify

## Changes Made to Fix the Issue

### 1. Improved Error Logging
The dimension migration now provides **detailed console output** showing:
- BigCommerce product dimensions before migration
- Each attempt to create dimension metafields
- Success/failure status for each dimension
- Full error details if something goes wrong

### 2. Fixed Metafield Configuration
Changed from:
- ❌ Namespace: `dimensions` → ✅ Namespace: `custom`
- ❌ Keys: `width`, `height`, `depth` → ✅ Keys: `dimension_width`, `dimension_height`, `dimension_depth`

The `custom` namespace is more reliable and commonly used in Shopify.

### 3. What to Look For in Console Output

When running the migration, you should now see:

```
Processing: Your Product Name (#123)
  BC Product dimensions: width=10, height=8, depth=6, weight=5.5

  → Attempting to add dimensions to variant #456789...
    BC Dimensions: W=10, H=8, D=6
    ✓ Created metafield custom.dimension_width = 10
    ✓ Created metafield custom.dimension_height = 8
    ✓ Created metafield custom.dimension_depth = 6
  ✓ Added dimensions to variant #456789 (W:10, H:8, D:6)
```

## Common Issues and Solutions

### Issue 1: "No dimensions to migrate for variant"

**Symptom:**
```
  ⊘ No dimensions to migrate for variant #456789
```

**Cause:** The BigCommerce product doesn't have width, height, or depth values set.

**Solution:** 
1. Check your BigCommerce products to verify they have dimensions
2. Look at the line that shows: `BC Product dimensions: width=..., height=..., depth=...`
3. If all values are `undefined` or `null`, the product doesn't have dimensions in BigCommerce

**How to verify in BigCommerce:**
- Go to Products → Edit Product → Details tab
- Look for "Dimensions" section (Width, Height, Depth)
- If these fields are empty, dimensions won't be migrated

### Issue 2: Metafield API Errors

**Symptom:**
```
  ! Dimension metafield (width): Shopify request failed...
  ! Full error details: {...}
```

**Possible Causes:**
1. **Missing API Permissions**: Your Shopify app doesn't have `write_products` scope
2. **Invalid Variant ID**: The variant ID doesn't exist in Shopify
3. **API Rate Limiting**: Too many requests (should auto-retry)
4. **Invalid Metafield Type**: The type `number_decimal` isn't supported in your Shopify version

**Solutions:**

**For Missing Permissions:**
1. Go to Shopify Admin → Settings → Apps and sales channels → Develop apps
2. Click your app → Configuration
3. Ensure these scopes are enabled:
   - ✅ `write_products`
   - ✅ `read_products`
   - ✅ `write_metaobjects` (optional but recommended)
4. Reinstall the app if you added new scopes

**For Invalid Metafield Type:**
If `number_decimal` doesn't work, we can try these alternatives:
- `single_line_text_field` (stores as text)
- `number_integer` (if dimensions are always whole numbers)

### Issue 3: Dimensions Created But Not Visible in Shopify

**Symptom:** Console shows success, but you can't see dimensions in Shopify Admin.

**Where to Check:**

**1. Via Shopify Admin UI:**
- Products → Select Product → Variants → Select Variant
- Scroll to "Metafields" section (may be collapsed)
- Look for namespace `custom` with keys `dimension_width`, `dimension_height`, `dimension_depth`

**2. Via Shopify API:**
```bash
curl -X GET \
  'https://your-store.myshopify.com/admin/api/2024-01/variants/VARIANT_ID/metafields.json' \
  -H 'X-Shopify-Access-Token: YOUR_TOKEN'
```

**3. Via Browser (JSON):**
Visit:
```
https://your-store.myshopify.com/admin/api/2024-01/variants/VARIANT_ID/metafields.json
```

### Issue 4: Testing with Dry Run

To test without making changes:

```bash
# Dry run - see what would be migrated
npm start -- --dry-run --to-shopify --limit=1

# Test with one specific product
npm start -- --write --to-shopify --only-name="Test Product"
```

## Debugging Steps

### Step 1: Verify BigCommerce Has Dimensions

Run a test migration with verbose output:
```bash
npm start -- --write --to-shopify --only-id=YOUR_PRODUCT_ID
```

Look for this line:
```
BC Product dimensions: width=X, height=Y, depth=Z, weight=W
```

If these are `undefined`, your BigCommerce products don't have dimensions set.

### Step 2: Check for Error Messages

Look for any of these in the console:
- `! Dimension metafield` (API errors)
- `⚠️ Some dimensions failed` (partial failure)
- `❌ Failed to add dimensions` (complete failure)

If you see errors, read the full error message. Common ones:
- `401 Unauthorized` → Check your Shopify access token
- `403 Forbidden` → Check API scopes/permissions
- `404 Not Found` → Variant doesn't exist (shouldn't happen)
- `422 Unprocessable Entity` → Invalid data format or metafield definition

### Step 3: Manually Test Shopify API

Create a test metafield manually to verify your API access:

```bash
curl -X POST \
  'https://your-store.myshopify.com/admin/api/2024-01/variants/VARIANT_ID/metafields.json' \
  -H 'X-Shopify-Access-Token: YOUR_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{
    "metafield": {
      "namespace": "custom",
      "key": "test_dimension",
      "value": "10.5",
      "type": "number_decimal"
    }
  }'
```

If this fails, the issue is with your API credentials or permissions, not the migration script.

### Step 4: Check Shopify API Version

The migration uses API version from your `.env` file:
```
SHOPIFY_API_VERSION=2024-01
```

If you're using an older API version, try updating to `2024-01` or later.

## Alternative: Use Single Line Text Field

If `number_decimal` type doesn't work, you can modify the metafield type:

Edit `src/migrators/shopifyProducts.js` line ~230:
```javascript
// Change from:
type: 'number_decimal'

// To:
type: 'single_line_text_field'
```

This stores dimensions as text instead of numbers, which is more compatible but less structured.

## Getting Help

If none of these solutions work, please provide:

1. **Console output** from running:
   ```bash
   npm start -- --write --to-shopify --only-id=PRODUCT_ID
   ```

2. **BigCommerce product data** (especially the dimensions values)

3. **Any error messages** you see in the console

4. **Shopify API version** from your `.env` file

5. **Test the Shopify API** manually with the curl command above and share the result

