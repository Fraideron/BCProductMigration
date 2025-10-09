# BigCommerce Catalog Migrator

## Version 2.0 - Refactored & Improved Architecture 🎉

Copy your BigCommerce **catalog** from a **production** store to a **sandbox** (or any other BC store) or **Shopify** store using the V3 REST API.

### Features

- ✅ Brands → by name (vendors in Shopify)
- ✅ Categories → preserves parent → child tree (custom collections in Shopify)
- ✅ Products → base fields (skips `custom_url` to avoid collisions)
- ✅ Options & Variants → **idempotent** option creation, robust mapping, **auto‑create missing option values**
- ✅ Custom Fields → **idempotent** (metafields in Shopify)
- ✅ Images → tries `image_url` first, then **falls back to binary upload**
- ✅ Weight & Dimensions → migrates product dimensions (width, height, depth) to Shopify metafields
- ✅ Pagination, 429 retry w/ backoff, id‑remapping
- ✅ Duplicate‑name safe via **upsert by name** (configurable)
- ✅ Variant SKUs → **conflict‑safe** creation (`suffix` / `blank` / `skip` strategies)
- ✅ Inventory synchronization with Inventory API
- ✅ **NEW**: Migrate to Shopify stores with `--to-shopify` flag

### What's New in v2.0

- 🏗️ **Modular Architecture**: Refactored from a single 847-line file into 17+ focused modules
- 📦 **Better Organization**: Clear separation of concerns (config, API, services, migrators)
- 🧪 **Testable**: Each component can be tested independently
- 🔧 **Maintainable**: Easier to understand, modify, and extend
- 📚 **Well Documented**: Comprehensive architecture and migration guides
- 🔄 **100% Compatible**: All features work exactly the same as v1.0
- 🛍️ **Shopify Support**: Migrate from BigCommerce to Shopify stores

> **Tech**: Node.js (ESM), Axios, Dotenv, FormData, mime-types.


---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [What Gets Migrated](#what-gets-migrated)
- [Usage](#usage)
- [Shopify Migration](#shopify-migration)
- [CLI filters & flags](#cli-filters--flags)
- [How It Works](#how-it-works)
- [Idempotency & Re‑runs](#idempotency--re-runs)
- [Troubleshooting](#troubleshooting)
- [Caveats & Limitations](#caveats--limitations)
- [FAQ](#faq)
- [Project Structure](#project-structure)
- [Changelog](#changelog)
- [Contributing](#contributing)
- [License](#license)


---

## Prerequisites

- **Node.js 18+**
- BigCommerce **API Accounts** (one for each store):
  - **Source (production)**: *V2/V3 API Token* with at least:
    - Products: **Read**
    - Brands / Categories / Options / Product Images / Product Variants: **Read**
  - **Destination (sandbox)**: *V2/V3 API Token* with at least:
    - Products, Brands, Categories, Options, Product Images, Product Variants, Custom Fields: **Read/Write**
- Your **store hash** for both stores (e.g. `abc123` from `https://store-abc123.mybigcommerce.com/...`).
- **For Shopify migration**: Shopify Admin API access token with appropriate permissions


---

## Installation

```bash
git clone <this-repo>
cd bc-catalog-migrator
npm i
```

This project uses ESM (`"type": "module"`) in `package.json`.

### Requirements

- **Node.js 18+**
- BigCommerce API credentials (see Configuration below)
- Shopify credentials (optional, for Shopify migration)


---

## Configuration

Create a `.env` file in the project root:

```ini
# --- SOURCE (production) ---
SRC_STORE_HASH=xxxxxxxx
SRC_ACCESS_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
# Optional; script auto-normalizes to /stores/<hash>/v3 even if omitted:
SRC_BASE_URL=https://api.bigcommerce.com

# --- DESTINATION (sandbox) - for BigCommerce to BigCommerce migration ---
DST_STORE_HASH=yyyyyyyy
DST_ACCESS_TOKEN=yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy
DST_BASE_URL=https://api.bigcommerce.com

# --- SHOPIFY (alternative destination) - for BigCommerce to Shopify migration ---
# Use with --to-shopify flag
SHOPIFY_SHOP_DOMAIN=your-store.myshopify.com
SHOPIFY_ACCESS_TOKEN=shpat_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
SHOPIFY_API_VERSION=2024-01

# --- Tuning & behavior ---
PAGE_SIZE=250
DRY_RUN=false

# Handle duplicate product names on destination: update | suffix | skip
NAME_DEDUP_STRATEGY=update
NAME_DEDUP_SUFFIX=" [sandbox]"

# Custom fields dedupe strategy: pair | overwrite_by_name
#  - pair = skip if same (name, value) exists
#  - overwrite_by_name = PUT value to the first field with same name
CF_DEDUP_STRATEGY=pair

# Variant SKU conflict strategy: suffix | blank | skip
#  - suffix = append VARIANT_SKU_SUFFIX (and -2, -3, ...) until unique
#  - blank  = create variant without a SKU
#  - skip   = skip creating this variant
VARIANT_SKU_STRATEGY=suffix
VARIANT_SKU_SUFFIX=-SBX
```

> **Tip:** You can omit `SRC_BASE_URL` / `DST_BASE_URL`. The script normalizes to `https://api.bigcommerce.com/stores/<hash>/v3`.


---

## What Gets Migrated

**Entities**
- **Brands**: matched/created by **name**.
- **Categories**: tree rebuilt parent → child using **full path** matching.
- **Products**: name, type, SKU, description, weight, price/sale_price, brand/category mappings, visibility, availability, condition.
  - Skips `custom_url` to avoid sandbox conflicts.
- **Options & Variants**:
  - Options are **idempotent** per product: if an option with the same `display_name` already exists, it is **reused**.
  - Variant mapping uses **option display name + value label** with normalization (case/space/diacritics tolerant).
  - If a referenced value label isn’t present, the script **creates the missing value** first.
  - Variant creation is **SKU‑conflict safe** (configurable strategy).
- **Custom Fields**:
  - Pair‑dedupe (skip if exact same name+value exists) **or** overwrite by name (PUT).
- **Images**:
  - Tries `image_url` first (fast).
  - If refused by API/CDN, downloads and **uploads as multipart** (`image_file`) with verification.


---

## Usage

### Quick Start

#### BigCommerce to BigCommerce Migration
```bash
# 1. Dry-run to preview (no changes made)
npm start -- --dry-run

# 2. Migrate specific product by name
npm start -- --write --only-name="Product Name"

# 3. Full migration
npm start -- --write
```

#### BigCommerce to Shopify Migration
```bash
# 1. Dry-run to preview Shopify migration
npm start -- --dry-run --to-shopify

# 2. Migrate specific product to Shopify
npm start -- --write --to-shopify --only-name="Product Name"

# 3. Full migration to Shopify
npm start -- --write --to-shopify
```

### Available Scripts

```bash
npm start           # Run migration with new architecture
npm run migrate     # Same as npm start
npm run legacy      # Use legacy v1.0 monolithic script
```

---

## Shopify Migration

The tool now supports migrating from BigCommerce to Shopify stores using the `--to-shopify` flag.

### Shopify Configuration

To migrate to Shopify, you need to set up Shopify credentials in your `.env` file:

```ini
SHOPIFY_SHOP_DOMAIN=your-store.myshopify.com
SHOPIFY_ACCESS_TOKEN=shpat_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
SHOPIFY_API_VERSION=2024-01
```

### How to Get Shopify Credentials

1. Go to your Shopify admin panel
2. Navigate to **Apps** → **Develop apps**
3. Create a new app or use an existing one
4. Configure the following API scopes:
   - `write_products`
   - `read_products`
   - `write_collections`
   - `read_collections`
   - `write_inventory`
   - `read_inventory`
5. Install the app and copy the **Admin API access token**

### BigCommerce to Shopify Mappings

The migration handles platform differences automatically:

- **Brands** → Shopify **Vendors** (product field)
- **Categories** → Shopify **Custom Collections**
- **Custom Fields** → Shopify **Metafields** (namespace: `custom`)
- **Options** → Shopify **Product Options** (max 3 options)
- **Variants** → Shopify **Variants**
- **Images** → Shopify **Product Images**
- **Inventory** → Shopify **Inventory Levels**

### Shopify Migration Examples

```bash
# Dry-run full Shopify migration
npm start -- --dry-run --to-shopify

# Migrate all products to Shopify
npm start -- --write --to-shopify

# Migrate specific products by ID to Shopify
npm start -- --write --to-shopify --only-id=123,456,789

# Migrate products matching a name pattern to Shopify
npm start -- --write --to-shopify --name-regex="^Blue.*"

# Migrate with limit (first 10 products)
npm start -- --write --to-shopify --limit=10

# Skip images during Shopify migration
npm start -- --write --to-shopify --skip-images
```

### Shopify-Specific Notes

- Shopify supports a maximum of **3 product options** (vs unlimited in BigCommerce)
- Custom fields are stored as **metafields** with namespace `custom`
- Brands become the **vendor** field on products
- Categories are mapped to **custom collections**, and products are automatically added to them
- Inventory is managed through Shopify's inventory system
- The migration handles Shopify's rate limits automatically with retry logic

---

## CLI filters & flags

You can control which products run and how, straight from the command line.  
CLI flags override `.env` where relevant (e.g., `--dry-run` overrides `DRY_RUN`).

**Selection flags**
- `--only-id=ID1,ID2,...` — process only these source product IDs.
- `--only-name="substring"` — process products whose name **contains** this substring (case‑insensitive).
- `--name-regex="pattern"` — process products whose name matches this JS regex (e.g., `"^Blue.*(Stool|Lamp)$"`).
- `--limit=N` — process only the first N products after filtering.
- `--start-after-id=ID` — skip source products with `id <= ID` (useful for resuming).

**Behavior flags**
- `--dry-run` — force read‑only mode (overrides `DRY_RUN=true/false` in `.env`).
- `--write` — force write mode (opposite of `--dry-run`).
- `--to-shopify` — migrate to Shopify instead of BigCommerce (requires Shopify credentials in `.env`).
- `--skip-images` — do not upload/verify images.
- `--skip-custom-fields` — do not upsert custom fields (or metafields for Shopify).

**Examples**
```bash
# Dry run a single product by name contains
npm start -- --dry-run --only-name="Greek Key Porcelain Garden Stool"

# Migrate two specific IDs, write mode, skip images
npm start -- --write --only-id=2724,2725 --skip-images

# Regex match + limit to first hit
npm start -- --name-regex="^Blue.*(Stool|Lamp)$" --limit=1

# Resume after a known source id
npm start -- --write --start-after-id=2000

# Migrate to Shopify
npm start -- --write --to-shopify
```

---

## How It Works

### Request / Retry
- All API calls go through `requestWithRetry()` with **exponential backoff** on HTTP 429.

### Mapping details
- **Brands:** matched by `name`.
- **Categories:** matched by **canonical path** and created parent → child.
- **Products:** base payload built from source; `inventory_tracking` switches to `'variant'` if variants exist.
- **Options (idempotent):**
  - Reuse if a destination option with the same `display_name` exists; else `POST`.
  - If API reports “already used”, refetch options and reuse.
- **Option Values (robust):**
  - Build on-demand value map for each destination option.
  - **Auto‑create** missing value labels on the destination option when needed.
- **Variants (idempotent + conflict‑safe):**
  - If a variant **SKU** already exists **on this product**, **PUT** (update) it.
  - If the SKU exists **elsewhere** in the catalog:
    - `suffix`: retry with `<sku><VARIANT_SKU_SUFFIX>` then `<sku><VARIANT_SKU_SUFFIX>-2`…
    - `blank`: create without SKU.
    - `skip`: skip this variant.
- **Custom Fields (idempotent):**
  - `pair` strategy: skip creating duplicate (name, value) pairs.
  - `overwrite_by_name` strategy: update existing field by name; otherwise create.
- **Images (resilient):**
  - Try `image_url` → if 4xx, **download** and upload as `image_file` → verify with `GET /images`.


---

## Idempotency & Re‑runs

- **Products**: `upsert by name` prevents duplicates; choose `NAME_DEDUP_STRATEGY`.
- **Options**: creation is **dedupe‑by‑display_name** per product.
- **Option Values**: created on demand only when missing.
- **Variants**: updated when SKU already on the product; SKU conflicts across the catalog are handled by strategy.
- **Custom Fields**: duplicates are skipped or overwritten (strategy).
- **Images**: don’t re‑upload if already present? (verification step logs current count; you can extend with a hash check if needed).


---

## Troubleshooting

### 404 “The route is not found, check the URL”
- Base URL is wrong. Remove `SRC_BASE_URL`/`DST_BASE_URL` or let the script normalize to:
  `https://api.bigcommerce.com/stores/<STORE_HASH>/v3`.
- Quick test:
  ```bash
  curl -s -H "X-Auth-Token: $SRC_ACCESS_TOKEN"   "https://api.bigcommerce.com/stores/$SRC_STORE_HASH/v3/catalog/summary"
  ```

### 409 “The product name is a duplicate”
- Destination already has a product with that name.
- Set `NAME_DEDUP_STRATEGY=update` (or `suffix`/`skip`).

### 422 “Invalid field(s): option_values … must not be empty / id”
- Variants require **`{ option_id, id }`** for each option choice.
- If “must not be empty”, the source variant had no mappable options; the script **skips** it and logs the reason.

### 422 “The display name … has already been used on this product.”
- The option already exists on the product. The script now **reuses existing options** via an idempotent ensure‑options step.

### 422 “The custom field … already exists”
- Duplicate (name, value). Handled by **`ensureCustomFieldsInDst`**; pick `CF_DEDUP_STRATEGY=pair` or `overwrite_by_name`.

### 409 “Sku … is not unique”
- SKU exists elsewhere in the catalog. Handled by **VARIANT_SKU_STRATEGY** (`suffix`/`blank`/`skip`).

### Images not appearing
- Cross‑store CDN URLs may be rejected; the script **falls back** to binary upload and verifies count.

### 401 / 403
- Token is for the wrong store hash or missing permissions.

### 429
- Backoff & retry is automatic. Reduce `PAGE_SIZE` if it happens often.


---

## Caveats & Limitations

- **SEO URLs** (`custom_url`) are not copied.
- **Modifiers** (text/file/etc.), **metafields**, **channels**, **price lists**, **inventory locations**, complex rules are out of scope for this version.
- Destination product/variant IDs will differ from source.


---

## FAQ

**Q: Can I run it multiple times?**  
A: Yes. The script is **idempotent** across products, options, variants, custom fields, and images.

**Q: Does it preserve product IDs?**  
A: No — destination IDs will differ. Mapping is by name/path/labels.

**Q: Can I migrate only certain categories?**  
A: Add a filter to the fetched `products` list (by `p.categories` or `p.name`).

**Q: What about product modifiers or metafields?**  
A: Not included by default; contributions welcome.


---

## Project Structure

```
BCProductMigration/
├── src/
│   ├── index.js                    # Main entry point
│   ├── config/                     # Configuration management
│   │   ├── env.js                  # Environment variables
│   │   └── cli.js                  # CLI argument parser
│   ├── api/                        # API communication layer
│   │   ├── client.js               # BigCommerce API client, retry logic, pagination
│   │   └── shopifyClient.js        # Shopify API client
│   ├── utils/                      # Utility functions
│   │   ├── string.js               # String normalization
│   │   └── array.js                # Array utilities
│   ├── models/                     # Data models
│   │   ├── product.js              # Product model
│   │   └── category.js             # Category model
│   ├── services/                   # Business services
│   │   ├── inventory.js            # Inventory operations
│   │   ├── image.js                # Image upload
│   │   ├── customFields.js         # Custom fields
│   │   └── options.js              # Options and variants
│   └── migrators/                  # Migration orchestration
│       ├── brands.js               # Brand migration
│       ├── categories.js           # Category migration
│       ├── products.js             # Product migration
│       ├── productFetcher.js       # Product fetching
│       ├── productUpsert.js        # Product upsert
│       ├── variants.js             # Variant migration
│       ├── shopifyBrands.js        # Shopify brand migration
│       ├── shopifyCategories.js    # Shopify category migration
│       └── shopifyProducts.js      # Shopify product migration
├── migrate.js                      # Legacy v1.0 script (kept for reference)
├── package.json
├── .env
├── README.md                       # This file
├── ARCHITECTURE.md                 # Technical architecture documentation
└── MIGRATION_GUIDE.md              # v1.0 to v2.0 migration guide
```

### Key Components

**Configuration Layer**: Centralized management of environment variables and CLI arguments

**API Layer**: HTTP client with automatic retry, rate limiting, and pagination

**Services Layer**: Reusable business logic for inventory, images, custom fields, and options

**Migrators Layer**: High-level orchestration for each entity type (brands, categories, products)

**Models Layer**: Data transformation and business rules


---

## Changelog

### 2.1 - Shopify Migration Support (Current)
- 🛍️ **Shopify migration**: Added full support for migrating from BigCommerce to Shopify
- 🔧 **New CLI flag**: `--to-shopify` to enable Shopify migration mode
- 🗺️ **Platform mapping**: Automatic conversion of BigCommerce entities to Shopify equivalents
  - Brands → Vendors
  - Categories → Custom Collections
  - Custom Fields → Metafields
- 🌐 **Shopify API client**: New dedicated client with rate limiting and pagination support
- 📝 **Enhanced documentation**: Comprehensive guide for Shopify migrations

### 2.0 - Architecture Refactor
- 🏗️ **Complete architectural refactor**: Modular design with clear separation of concerns
- 📦 **17+ focused modules**: Replaced single 847-line file with organized structure
- 🧪 **Testable components**: Each module can be tested independently
- 📚 **Comprehensive documentation**: Added ARCHITECTURE.md and MIGRATION_GUIDE.md
- 🔄 **100% compatible**: All features work exactly as in v1.0
- 🔧 **Maintainable**: Easier to understand, modify, and extend
- ✅ **Legacy support**: Original migrate.js kept for reference

### 1.2
- **CLI**: add `--dry-run`, `--write`, `--only-id`, `--only-name`, `--name-regex`, `--limit`, `--start-after-id`, `--skip-images`, `--skip-custom-fields`.

### 1.1
- **Options:** idempotent creation (reuse existing by `display_name`), robust indexing.
- **Variants:** conflict‑safe SKU handling (`suffix`/`blank`/`skip`), update‑in‑place if SKU already on product.
- **Custom Fields:** idempotent; (name,value) pair‑dedupe or overwrite‑by‑name.
- **Images:** added binary upload fallback + verification.
- **URL Normalization:** resilient base URL builder for `/stores/<hash>/v3`.
- **Upsert by Name:** products update instead of creating duplicates.
- **Logging:** clearer per‑entity diagnostics (skips, conflicts, creations).

### 1.0
- Initial migration for brands, categories, products, variants, custom fields, images.


---

## Documentation

📖 **User Guides**
- [README.md](README.md) - This file: Quick start and usage guide
- [Configuration Guide](#configuration) - Environment variables and settings

🏗️ **Technical Documentation**
- [ARCHITECTURE.md](ARCHITECTURE.md) - System architecture and design principles
- [MIGRATION_GUIDE.md](MIGRATION_GUIDE.md) - Migrating from v1.0 to v2.0

---

## Contributing

PRs and issues are welcome. If you add support for modifiers/metafields/channels, please include:
- API endpoints used,
- example payloads,
- and the migration order of dependent entities.

### Development Guide

The modular architecture makes it easy to extend:

**To add a new entity type (e.g., Customers):**
1. Create model: `src/models/customers.js`
2. Create service (if needed): `src/services/customers.js`
3. Create migrator: `src/migrators/customers.js`
4. Import and call from `src/index.js`

**To add a new strategy:**
1. Add config option: `src/config/env.js`
2. Implement logic in relevant service
3. Use in migrator

See [ARCHITECTURE.md](ARCHITECTURE.md) for detailed technical documentation.

---

## License

MIT © Your Name
