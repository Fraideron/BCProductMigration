# BigCommerce Catalog Migrator

Copy your BigCommerce **catalog** from a **production** store to a **sandbox** (or any other BC store) using the V3 REST API.

- ✅ Brands → by name
- ✅ Categories → preserves parent → child tree (path-based mapping)
- ✅ Products → base fields (skips `custom_url` to avoid collisions)
- ✅ Options & Variants → **idempotent** option creation, robust mapping, **auto‑create missing option values**
- ✅ Custom Fields → **idempotent** (skip duplicates or overwrite by name)
- ✅ Images → tries `image_url` first, then **falls back to binary upload**
- ✅ Pagination, 429 retry w/ backoff, id‑remapping
- ✅ Duplicate‑name safe via **upsert by name** (configurable)
- ✅ Variant SKUs → **conflict‑safe** creation (`suffix` / `blank` / `skip` strategies)

> **Tech**: Node.js (ESM), Axios, Dotenv, FormData, mime-types.


---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [What Gets Migrated](#what-gets-migrated)
- [Usage](#usage)
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


---

## Installation

```bash
git clone <this-repo>
cd bc-catalog-migrator
npm i
```

This project uses ESM (`"type": "module"`) in `package.json`.


---

## Configuration

Create a `.env` file in the project root:

```ini
# --- SOURCE (production) ---
SRC_STORE_HASH=xxxxxxxx
SRC_ACCESS_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
# Optional; script auto-normalizes to /stores/<hash>/v3 even if omitted:
SRC_BASE_URL=https://api.bigcommerce.com

# --- DESTINATION (sandbox) ---
DST_STORE_HASH=yyyyyyyy
DST_ACCESS_TOKEN=yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy
DST_BASE_URL=https://api.bigcommerce.com

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

### 1) Dry‑run (no writes)

```bash
# .env: DRY_RUN=true
npm start
```

### 2) Full migration

```bash
# .env: DRY_RUN=false
npm start
```

### 3) Migrate only a subset (optional quick filter)

```js
// inside migrateProducts()
const only = new Set([1204, 2054]); // source product IDs to include
const products = (await pagedGetAll(src, '/catalog/products', { include: 'custom_fields,options,variants' }))
  .filter(p => only.has(p.id));
```

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
- `--skip-images` — do not upload/verify images.
- `--skip-custom-fields` — do not upsert custom fields.

**Examples**
```bash
# Dry run a single product by name contains
node migrate.js --dry-run --only-name="Greek Key Porcelain Garden Stool"

# Migrate two specific IDs, write mode, skip images
node migrate.js --write --only-id=2724,2725 --skip-images

# Regex match + limit to first hit
node migrate.js --name-regex="^Blue.*(Stool|Lamp)$" --limit=1

# Resume after a known source id
node migrate.js --write --start-after-id=2000
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
.
├─ migrate.js                 # main script
├─ package.json               # deps & scripts
├─ .env                       # your credentials (not committed)
└─ README.md                  # this file
```

Key functions (high‑level):
- `pagedGetAll()` – pagination helper
- `requestWithRetry()` – 429-aware HTTP
- `migrateBrands()`, `migrateCategories()`, `migrateProducts()` – orchestration
- `upsertProductByName()` – duplicate‑name safe
- `ensureOptionsInDst()` / `indexDstOptions()` – option dedupe & lookup
- `ensureOptionValue()` – auto‑create option values on demand
- `mapVariantOptionValuesAsync()` – robust mapping to `{ option_id, id }`
- `ensureCustomFieldsInDst()` – custom field idempotency
- `uploadImageWithFallback()` – image_url → binary upload fallback


---

## Changelog

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

## Contributing

PRs and issues are welcome. If you add support for modifiers/metafields/channels, please include:
- API endpoints used,
- example payloads,
- and the migration order of dependent entities.


---

## License

MIT © Your Name
