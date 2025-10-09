# Shopify Migration Guide

This guide explains how to migrate your BigCommerce catalog to Shopify using the BigCommerce Catalog Migrator.

## Prerequisites

Before starting the migration, you need:

1. **BigCommerce Source Store Credentials**:
   - Store Hash
   - API Access Token with read permissions for products, brands, categories, etc.

2. **Shopify Destination Store Credentials**:
   - Shop Domain (e.g., `your-store.myshopify.com`)
   - Admin API Access Token

## Getting Shopify Credentials

### Step 1: Create a Custom App in Shopify

1. Log in to your Shopify admin panel
2. Navigate to **Settings** → **Apps and sales channels**
3. Click **Develop apps** (or **Manage private apps** for older Shopify stores)
4. Click **Create an app** or **Allow custom app development**
5. Name your app (e.g., "BigCommerce Migrator")

### Step 2: Configure API Scopes

Your app needs the following scopes:

**Required:**
- `write_products` - Create and update products
- `read_products` - Read existing products
- `write_inventory` - Update inventory levels
- `read_inventory` - Read inventory information

**Optional but Recommended:**
- `write_product_listings` - Publish products to sales channels
- `read_product_listings` - Read product listings
- `write_publications` - Manage product publications
- `read_publications` - Read publications

### Step 3: Install the App and Get Access Token

1. Click **Install app**
2. Copy the **Admin API access token** - you'll need this for the `.env` file
3. Note your shop domain (visible in your Shopify URL)

## Configuration

Add these variables to your `.env` file:

```ini
# Source BigCommerce Store
SRC_STORE_HASH=your-bc-store-hash
SRC_ACCESS_TOKEN=your-bc-access-token

# Destination Shopify Store
SHOPIFY_SHOP_DOMAIN=your-store.myshopify.com
SHOPIFY_ACCESS_TOKEN=shpat_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx
SHOPIFY_API_VERSION=2024-01

# Optional settings
PAGE_SIZE=250
DRY_RUN=false
```

## Platform Mapping

The migrator automatically handles platform differences:

| BigCommerce | Shopify | Notes |
|-------------|---------|-------|
| Brands | Vendors | Brand name becomes product vendor |
| Categories | Custom Collections | Hierarchical structure preserved |
| Products | Products | Core product data mapped |
| Variants | Variants | Up to 3 options (Shopify limit) |
| Options | Options | Shopify supports max 3 options |
| Custom Fields | Metafields | Stored in `custom` namespace |
| Images | Images | Image URLs copied or uploaded |
| Weight | Variant Weight | Migrated in pounds (lb) |
| Dimensions | Variant Metafields | Width, height, depth stored in `custom` namespace (dimension_width, dimension_height, dimension_depth) |
| Inventory | Inventory Levels | Synced to default location |

### Important Differences

**Options Limitation:**
- BigCommerce supports unlimited product options
- Shopify supports maximum 3 options per product
- The migrator will use the first 3 options from BigCommerce
- Additional options will be skipped with a warning

**Brand/Vendor:**
- BigCommerce has a separate Brands entity
- Shopify uses a simple vendor string on products
- All products from the same BigCommerce brand will have the same vendor value

**Collections vs Categories:**
- BigCommerce categories become Shopify custom collections
- Products are automatically added to collections via the Collects API
- Parent-child relationships are preserved in collection names

## Usage Examples

### 1. Dry Run (Recommended First Step)

Test the migration without making changes:

```bash
npm start -- --dry-run --to-shopify
```

### 2. Migrate Specific Products

Migrate a single product by name:

```bash
npm start -- --write --to-shopify --only-name="Blue Widget"
```

Migrate specific products by ID:

```bash
npm start -- --write --to-shopify --only-id=123,456,789
```

Migrate products matching a pattern:

```bash
npm start -- --write --to-shopify --name-regex="^Premium.*"
```

### 3. Limited Migration

Migrate first 10 products:

```bash
npm start -- --write --to-shopify --limit=10
```

### 4. Full Migration

Migrate all products:

```bash
npm start -- --write --to-shopify
```

### 5. Skip Options

Skip images during migration:

```bash
npm start -- --write --to-shopify --skip-images
```

Skip custom fields (metafields):

```bash
npm start -- --write --to-shopify --skip-custom-fields
```

## Migration Process

The migration happens in these stages:

1. **Brands Migration**
   - Fetches all BigCommerce brands
   - Creates a mapping: Brand ID → Vendor name
   - Used when creating products

2. **Categories Migration**
   - Fetches all BigCommerce categories
   - Creates Shopify custom collections
   - Preserves hierarchical structure in names
   - Creates mapping: Category ID → Collection ID

3. **Products Migration**
   For each product:
   - Creates/updates product in Shopify
   - Sets vendor from brand mapping
   - Adds product options (max 3)
   - Creates variants with inventory
   - Uploads images
   - Adds to collections (categories)
   - Creates metafields (custom fields)

## Rate Limiting

The migrator handles rate limits automatically:

- **BigCommerce**: 429 errors trigger exponential backoff
- **Shopify**: Monitors API call limit headers
- Adds small delays when approaching limits
- Automatically retries failed requests

## Verification

After migration, verify:

1. **Products**: Check product count and details
2. **Collections**: Verify all collections were created
3. **Images**: Ensure images loaded correctly
4. **Variants**: Check variant options and inventory
5. **Metafields**: Verify custom fields are present

Use Shopify's bulk editor for quick verification:
- Products → Select products → Edit products

## Troubleshooting

### "Shopify request failed: 401 Unauthorized"
- Check your `SHOPIFY_ACCESS_TOKEN` is correct
- Verify the app is installed on your Shopify store
- Ensure API scopes are configured correctly

### "Shopify request failed: 403 Forbidden"
- Your app doesn't have required API scopes
- Add missing scopes and reinstall the app

### "Shopify request failed: 429 Too Many Requests"
- The migrator will automatically retry
- If it persists, reduce `PAGE_SIZE` in `.env`

### "Product options limited to 3"
- This is a Shopify platform limitation
- Consider restructuring products with 4+ options
- Or create separate products for different option combinations

### Images not uploading
- Check if BigCommerce image URLs are publicly accessible
- The migrator will try direct URL first, then download/upload
- Verify network connectivity and firewall rules

### Metafields not visible in admin
- Metafields may require a metafield definition in Shopify
- Go to Settings → Custom data → Products
- Add definitions for your custom fields

## Best Practices

1. **Start Small**: Test with a few products first using `--limit=5`
2. **Dry Run First**: Always do a dry run before actual migration
3. **Backup**: Export your Shopify store before migration
4. **Verify**: Check a sample of migrated products manually
5. **Inventory**: Double-check inventory levels after migration
6. **Images**: Verify image quality and order
7. **Collections**: Ensure products are in correct collections
8. **SEO**: Update SEO settings after migration (not migrated)

## Post-Migration Tasks

After successful migration:

1. **Review Products**: Check for any errors or warnings
2. **Update SEO**: Add meta descriptions, titles, URLs
3. **Configure Sales Channels**: Publish to appropriate channels
4. **Set Up Redirects**: Create redirects from old URLs if applicable
5. **Test Checkout**: Ensure products can be purchased
6. **Update Theme**: Adjust theme if needed for new products

## Support

If you encounter issues:

1. Check the error messages carefully
2. Review the troubleshooting section
3. Verify your API credentials and permissions
4. Check network connectivity
5. Review Shopify API documentation for specific errors

## Limitations

- **URL Preservation**: Product URLs are not preserved
- **SEO Data**: Meta descriptions/titles require manual setup
- **Themes**: Shopify themes may render products differently
- **Apps**: BigCommerce apps/integrations need Shopify equivalents
- **Options**: Maximum 3 options per product in Shopify
- **Custom Fields**: Become metafields, may need definitions
- **Price Lists**: Not migrated (Shopify uses different pricing model)

## Example Complete Migration

Here's a complete example workflow:

```bash
# 1. Test with one product
npm start -- --dry-run --to-shopify --only-name="Test Product"

# 2. Migrate that product
npm start -- --write --to-shopify --only-name="Test Product"

# 3. Verify in Shopify admin, then migrate first 10
npm start -- --write --to-shopify --limit=10

# 4. Verify again, then do full migration
npm start -- --write --to-shopify

# 5. Check for any errors in the output
# 6. Verify inventory levels
# 7. Check images loaded correctly
# 8. Publish products to sales channels
```

## Need Help?

Refer to:
- [Main README](README.md) for general usage
- [Shopify Admin API Documentation](https://shopify.dev/docs/api/admin-rest)
- [BigCommerce API Documentation](https://developer.bigcommerce.com/api-docs)
