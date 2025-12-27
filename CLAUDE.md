# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Node.js worker that fetches data from Jasper ERP API and stores it in MySQL or PostgreSQL databases. Features dynamic schema handling, pagination, nested data extraction, and scheduled fetching.

## Commands

```bash
npm start                    # Fetch all endpoints
npm start <endpoint>         # Fetch specific endpoint (e.g., npm start margin)
npm run scheduler            # Start cron scheduler
npm run scheduler:now        # Run immediately + keep scheduler running
npm run cleanup              # Truncate all jasper_* tables
npm run cleanup:drop         # Drop all jasper_* tables

# Individual table cleanup (table name auto-prefixed with jasper_ if needed)
npm run cleanup:table stock_aging_location_report
npm run cleanup:drop:table jasper_stock_aging_location_report
```

## Architecture

**Entry Points:**
- `src/index.js` - Main fetcher, processes endpoints based on CLI args
- `src/scheduler.js` - Cron-based scheduler using node-cron
- `src/cleanup.js` - Database cleanup utility

**Core Services:**
- `src/services/fetcher.js` - Handles pagination and streaming inserts (processes page-by-page to avoid memory issues)
- `src/services/schema-handler.js` - Dynamic table/column creation from API response structure
- `src/services/api-client.js` - HTTP client with auth and retry logic

**Database Layer:**
- `src/database/adapter-factory.js` - Returns MySQL or PostgreSQL adapter based on DB_PROVIDER env
- Adapters implement: `connect()`, `disconnect()`, `insertBatch()`, `ensureConnected()`

**Configuration:**
- `src/endpoints/definitions.js` - Array of endpoint configs with path, tableName, params, nestedTables, requiresDate
- `.env` - Database credentials, API config, date range mode, cron schedule, SSH tunnel settings

## Key Patterns

- **Nested Tables**: Some endpoints extract nested arrays (e.g., `warehouse.locations`) into separate child tables with foreign key relationship
- **Date Range Modes**: Report endpoints use modes like `yearly_by_month` to split large date ranges and avoid timeouts
- **Streaming Inserts**: Data is inserted page-by-page rather than collected in memory
- **Dynamic Schema**: Tables are created from first response; new columns are added automatically on subsequent runs

## Adding New Endpoints

Add entry to `src/endpoints/definitions.js`:
```javascript
{
  path: '/api/client/...',
  tableName: 'jasper_...',
  params: {},
  nestedTables: [],      // Optional: for nested arrays
  requiresDate: true,    // Set if endpoint needs date_from/date_to
}
```
