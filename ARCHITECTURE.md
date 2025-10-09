# BigCommerce Catalog Migrator - Architecture Documentation

## Version 2.0 - Refactored Architecture

This document describes the new modular architecture of the BigCommerce Catalog Migrator.

## Project Structure

```
BCProductMigration/
├── src/
│   ├── index.js                    # Main entry point
│   ├── config/                     # Configuration management
│   │   ├── env.js                  # Environment variables configuration
│   │   └── cli.js                  # CLI argument parser
│   ├── api/                        # API communication layer
│   │   └── client.js               # BigCommerce API client setup, retry logic, pagination
│   ├── utils/                      # Utility functions
│   │   ├── string.js               # String normalization and comparison
│   │   └── array.js                # Array manipulation utilities
│   ├── models/                     # Data models and business logic
│   │   ├── product.js              # Product model and payload building
│   │   └── category.js             # Category path mapping and sorting
│   ├── services/                   # Reusable business services
│   │   ├── inventory.js            # Inventory management operations
│   │   ├── image.js                # Image upload with fallback
│   │   ├── customFields.js         # Custom fields handling
│   │   └── options.js              # Product options and values management
│   └── migrators/                  # Migration orchestration
│       ├── brands.js               # Brand migration logic
│       ├── categories.js           # Category migration logic
│       ├── products.js             # Product migration orchestration
│       ├── productFetcher.js       # Product fetching and filtering
│       ├── productUpsert.js        # Product upsert strategies
│       └── variants.js             # Variant migration with SKU conflict handling
├── package.json
├── .env
└── README.md

```

## Architecture Overview

### Layer Separation

The application is organized into distinct layers with clear responsibilities:

#### 1. **Entry Point Layer** (`src/index.js`)
- Main orchestrator that coordinates the entire migration process
- Initializes configuration and API clients
- Manages the high-level migration flow

#### 2. **Configuration Layer** (`src/config/`)
- **env.js**: Centralizes all environment variable management
- **cli.js**: Parses and validates command-line arguments
- Provides a single source of truth for all configuration

#### 3. **API Layer** (`src/api/`)
- **client.js**: HTTP client configuration and communication
- Implements retry logic with exponential backoff for rate limiting
- Provides pagination helpers for BigCommerce API
- Abstracts all API communication details

#### 4. **Utilities Layer** (`src/utils/`)
- Pure utility functions with no side effects
- **string.js**: String normalization and comparison
- **array.js**: Array manipulation (chunking, etc.)

#### 5. **Models Layer** (`src/models/`)
- Business logic for data transformation
- **product.js**: Product payload construction, variant detection
- **category.js**: Category tree operations and path mapping

#### 6. **Services Layer** (`src/services/`)
- Reusable business services for specific domains
- **inventory.js**: All inventory-related operations
- **image.js**: Image upload with URL/binary fallback
- **customFields.js**: Custom field idempotency logic
- **options.js**: Product options and option values management

#### 7. **Migrators Layer** (`src/migrators/`)
- High-level migration orchestration
- Each migrator handles one entity type
- **brands.js**: Brand migration
- **categories.js**: Category migration with parent-child ordering
- **products.js**: Main product migration orchestrator
- **productFetcher.js**: Product filtering and asset fetching
- **productUpsert.js**: Product creation/update strategies
- **variants.js**: Variant migration with SKU conflict resolution

## Key Design Principles

### 1. **Separation of Concerns**
Each module has a single, well-defined responsibility:
- Configuration is isolated from business logic
- API communication is abstracted from data manipulation
- Business rules are separate from orchestration

### 2. **Reusability**
Services and utilities can be used across different migrators:
- `requestWithRetry` is used by all API operations
- `normalize` is used for all string comparisons
- Inventory service is shared between product and variant operations

### 3. **Testability**
- Pure functions in utils/ are easily testable
- Services have minimal dependencies
- Each layer can be mocked for testing

### 4. **Maintainability**
- Small, focused files (100-300 lines each)
- Clear naming conventions
- Related functionality is grouped together

### 5. **Extensibility**
Adding new features is straightforward:
- New migrators can be added to `src/migrators/`
- New services can be created in `src/services/`
- Configuration options are centralized

## Data Flow

```
CLI Args → Config Layer → Main Entry Point
                            ↓
                    Create API Clients
                            ↓
            ┌───────────────┴───────────────┐
            ↓                               ↓
      Migrate Brands                  Migrate Categories
      (brands.js)                     (categories.js)
            ↓                               ↓
            └───────────────┬───────────────┘
                            ↓
                    Migrate Products
                    (products.js)
                            ↓
            ┌───────────────┼───────────────┐
            ↓               ↓               ↓
      Fetch & Filter    Upsert Product   Get Assets
      (productFetcher)  (productUpsert)  (API Client)
            ↓               ↓               ↓
            └───────────────┼───────────────┘
                            ↓
            ┌───────────────┼───────────────┬───────────────┐
            ↓               ↓               ↓               ↓
        Options         Variants      Custom Fields     Images
      (options.js)    (variants.js)  (customFields.js) (image.js)
            ↓               ↓               ↓               ↓
            └───────────────┴───────────────┴───────────────┘
                            ↓
                      Set Inventory
                    (inventory.js)
```

## Module Dependencies

### No Dependencies
- `src/utils/string.js`
- `src/utils/array.js`

### Minimal Dependencies
- `src/config/env.js` (only dotenv)
- `src/config/cli.js` (no dependencies)
- `src/api/client.js` (only axios)

### Service Dependencies
- All services depend on `api/client.js` for API calls
- Most services use `utils/string.js` for normalization

### Migrator Dependencies
- Migrators orchestrate services and models
- Each migrator is independent and can be tested separately

## Error Handling Strategy

### API Layer
- Automatic retry with exponential backoff for 429 errors
- Descriptive error messages with full context
- Graceful degradation (e.g., image fallback)

### Service Layer
- Try-catch blocks for recoverable errors
- Logging of all failures with context
- Fallback strategies where appropriate

### Migrator Layer
- Individual product failures don't stop the entire migration
- Comprehensive logging of successes and failures
- Summary statistics at the end

## Configuration Management

All configuration is centralized in `src/config/`:

### Environment Variables (`env.js`)
```javascript
config.source         // Source store credentials
config.destination    // Destination store credentials
config.settings       // Migration settings (page size, dry run)
config.strategies     // Deduplication strategies
config.inventory      // Inventory location settings
```

### CLI Arguments (`cli.js`)
Override configuration and add runtime filters:
- Product filtering (by ID, name, regex)
- Feature flags (skip images, skip custom fields)
- Debug modes

## Adding New Features

### To add a new entity type (e.g., Customers):

1. Create model in `src/models/customers.js`
2. Create service if needed in `src/services/customers.js`
3. Create migrator in `src/migrators/customers.js`
4. Import and call from `src/index.js`

### To add a new strategy:

1. Add configuration in `src/config/env.js`
2. Implement logic in relevant service
3. Use in migrator

## Testing Strategy

### Unit Tests (Future)
- Test pure functions in `utils/`
- Test payload builders in `models/`
- Mock API calls for services

### Integration Tests (Future)
- Test migrators with mock API responses
- Verify idempotency
- Test error handling

### End-to-End Tests (Future)
- Use test BigCommerce stores
- Verify complete migration flow
- Test all CLI options

## Performance Considerations

### Parallel Operations
- Brand and category fetching could be parallelized
- Image uploads are sequential (by design for API rate limits)

### Memory Usage
- Pagination prevents loading all products at once
- Each product is processed and released

### Rate Limiting
- Automatic backoff on 429 errors
- Configurable page size to reduce request frequency

## Migration to New Architecture

The refactored codebase maintains 100% feature parity with the original monolithic script:

### What's the Same
- All migration features work identically
- Same CLI arguments and behavior
- Same .env configuration
- Same output and logging

### What's Better
- Easier to understand and maintain
- Easier to test individual components
- Easier to extend with new features
- Better error isolation
- Clearer dependency management

### Backward Compatibility
The new modular architecture maintains 100% feature parity with the original implementation:
```bash
npm start       # Uses modular architecture
```

## Future Enhancements

### Short Term
- Add JSDoc comments to all functions
- Add input validation
- Improve error messages

### Medium Term
- Add unit tests
- Add integration tests
- Add TypeScript type definitions
- Add progress bars for long operations

### Long Term
- Support for modifiers
- Support for metafields
- Support for multiple inventory locations
- Parallel product processing
- Resume capability from failure point
- Dry-run diff report

## Contributing

When contributing to this project:

1. Follow the existing layer structure
2. Keep functions small and focused
3. Add appropriate error handling
4. Update this documentation for architectural changes
5. Maintain backward compatibility with .env and CLI

## License

MIT © Your Name
