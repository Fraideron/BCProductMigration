# Quick Start: Migrate to Shopify

## Step 1: Get Shopify Credentials

1. Log into Shopify Admin
2. Go to **Settings** → **Apps and sales channels** → **Develop apps**
3. Create a new app
4. Add API scopes: `write_products`, `read_products`, `write_inventory`, `read_inventory`
5. Install the app and copy the **Admin API access token**

## Step 2: Configure

Edit `.env` file:

```ini
# Source BigCommerce
SRC_STORE_HASH=your-bigcommerce-hash
SRC_ACCESS_TOKEN=your-bigcommerce-token

# Destination Shopify
SHOPIFY_SHOP_DOMAIN=your-store.myshopify.com
SHOPIFY_ACCESS_TOKEN=shpat_xxxxxxxxxxxxxxxxxxxxxxxx
SHOPIFY_API_VERSION=2024-01
```

## Step 3: Test Migration

```bash
# Dry run (no changes made)
npm start -- --dry-run --to-shopify

# Test with one product
npm start -- --write --to-shopify --only-name="Test Product"
```

## Step 4: Full Migration

```bash
# Migrate all products
npm start -- --write --to-shopify
```

## Common Options

```bash
# Migrate first 10 products
npm start -- --write --to-shopify --limit=10

# Migrate specific products by ID
npm start -- --write --to-shopify --only-id=123,456

# Skip images
npm start -- --write --to-shopify --skip-images

# Skip custom fields (metafields)
npm start -- --write --to-shopify --skip-custom-fields
```

## What Gets Migrated

✅ Products (name, description, price, etc.)
✅ Brands → Vendors
✅ Categories → Collections
✅ Variants (up to 3 options)
✅ Images
✅ Weight & Dimensions (width, height, depth)
✅ Inventory levels
✅ Custom fields → Metafields

❌ SEO URLs (not migrated)
❌ Custom modifiers
❌ Product reviews

## Troubleshooting

**401 Unauthorized**: Check your Shopify access token
**403 Forbidden**: Add required API scopes to your Shopify app
**429 Rate Limit**: The tool handles this automatically, just wait

## Need More Help?

📖 See `SHOPIFY_MIGRATION.md` for detailed guide
📖 See `README.md` for general usage
📖 See `SUMMARY.md` for implementation details
