# Jasper API Fetcher

Node.js worker to fetch data from Jasper ERP API and store in MySQL/PostgreSQL databases.

## Features

- Fetch data from all Jasper API endpoints (Master Data, Reports, Transactions)
- Support for both **MySQL** and **PostgreSQL**
- **Dynamic schema handling** - automatically creates tables and adds new columns
- **Pagination support** - handles large datasets automatically
- **Nested data extraction** - stores nested arrays in separate tables
- **Month-by-month fetching** - splits large date ranges to avoid timeouts
- **Scheduled fetching** - built-in cron scheduler for automated runs

## Installation

```bash
# Clone the repository
git clone <repository-url>
cd jasper-fetchers

# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Edit .env with your credentials
nano .env
```

## Configuration

Edit `.env` file:

```env
# Database Configuration
DB_PROVIDER=mysql              # mysql or postgres
DB_HOST=localhost
DB_PORT=3306
DB_USER=your_user
DB_PASSWORD=your_password
DB_NAME=jasper

# Jasper API Configuration
JASPER_API_URL=https://jasperv1-group-stg-be.mist-tbg.net
JASPER_API_KEY=your_api_key
OFFICE_CODE=BCTN

# Date Range Configuration
DATE_RANGE_MODE=yearly_by_month
DATE_RANGE_YEAR=2024
```

### Date Range Modes

| Mode | Description |
|------|-------------|
| `static` | Use DATE_FROM and DATE_TO values |
| `previous_month` | Auto-calculate previous month |
| `current_month` | From 1st of current month to today |
| `yearly_by_month` | Fetch entire year, split by month |
| `previous_year_by_month` | Fetch previous year, split by month |
| `ytd_by_month` | Year to date, split by month |
| `last_n_days` | Last N days (set DATE_RANGE_DAYS) |

## Usage

### Fetch All Endpoints

```bash
npm start
```

### Fetch Specific Endpoint

```bash
# Master Data
npm start customer              # Fetch customers
npm start item                  # Fetch items (large dataset)
npm start item_group            # Fetch item groups
npm start warehouse             # Fetch warehouses + locations
npm start sales                 # Fetch sales

# Reports (requires date range)
npm start margin                # Margin report
npm start stock_balance         # Stock balance location report
npm start stock_aging           # Stock aging report
npm start ar_aging              # AR aging report
npm start sales_order           # Sales order report
npm start sales_quote           # Sales quote report
npm start sales_target          # Sales target report
npm start operational_expense   # Operational expense report
npm start vehicle_service       # Vehicle service report
```

### Run Scheduler

```bash
# Start scheduler (runs on cron schedule)
npm run scheduler

# Run immediately + keep scheduler running
npm run scheduler:now
```

## Available Endpoints (16 Total → 18 Tables)

### Master Data (5 endpoints)

| # | Command | Table | API Endpoint |
|---|---------|-------|--------------|
| 1 | `npm start customer` | `jasper_customer` | `/api/client/master/customer` |
| 2 | `npm start jasper_item` | `jasper_item` | `/api/client/master/item` |
| 3 | `npm start item_group` | `jasper_item_group` | `/api/client/master/item-group` |
| 4 | `npm start jasper_sales` | `jasper_sales` | `/api/client/master/sales` |
| 5 | `npm start warehouse` | `jasper_warehouse` + `jasper_warehouse_location` | `/api/client/master/warehouse` |

### Reports (9 endpoints) - Requires Date Range

| # | Command | Table | API Endpoint |
|---|---------|-------|--------------|
| 6 | `npm start stock_balance` | `jasper_stock_balance_location_report` | `/api/client/report/generate/stock-balance-location-report` |
| 7 | `npm start stock_aging` | `jasper_stock_aging_location_report` | `/api/client/report/generate/stock-aging-location-report` |
| 8 | `npm start ar_aging` | `jasper_ar_aging_report` | `/api/client/report/generate/ar-aging-report` |
| 9 | `npm start sales_quote` | `jasper_sales_quote_report` | `/api/client/report/generate/sales-quote-report` |
| 10 | `npm start sales_order` | `jasper_sales_order_report` | `/api/client/report/generate/sales-order-report` |
| 11 | `npm start sales_target` | `jasper_sales_target_report` | `/api/client/report/generate/sales-target-report` |
| 12 | `npm start operational_expense` | `jasper_operational_expense_report` | `/api/client/report/generate/operational-expense-report` |
| 13 | `npm start margin` | `jasper_margin_report` | `/api/client/report/generate/margin-report` |
| 14 | `npm start vehicle_service` | `jasper_vehicle_service_report` | `/api/client/report/generate/vehicle-service-report` |

### Transactions (1 endpoint)

| # | Command | Table | API Endpoint |
|---|---------|-------|--------------|
| 15 | `npm start purchase_receipt` | `jasper_purchase_receipt` + `jasper_purchase_receipt_item` | `/api/client/transaction/purchase-receipt` |

### Nested Tables

| Parent Table | Child Table | Relationship Key |
|--------------|-------------|------------------|
| `jasper_warehouse` | `jasper_warehouse_location` | `warehouse_code` |
| `jasper_purchase_receipt` | `jasper_purchase_receipt_item` | `purchase_receipt_no` |

## Scheduler Configuration

Configure cron schedule in `.env`:

```env
# Run on 1st of every month at midnight
CRON_SCHEDULE=0 0 1 * *

# Run every Sunday at 2:00 AM
CRON_SCHEDULE=0 2 * * 0

# Run every day at midnight
CRON_SCHEDULE=0 0 * * *
```

### Run as System Service (Linux)

```bash
# Install service
sudo cp jasper-fetcher.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable jasper-fetcher
sudo systemctl start jasper-fetcher

# Check status
sudo systemctl status jasper-fetcher

# View logs
sudo journalctl -u jasper-fetcher -f
```

## Project Structure

```
jasper-fetchers/
├── src/
│   ├── index.js              # Main entry point
│   ├── scheduler.js          # Cron scheduler
│   ├── config/
│   │   └── database.js       # Database configuration
│   ├── services/
│   │   ├── api-client.js     # HTTP client with auth
│   │   ├── fetcher.js        # Pagination & data handler
│   │   └── schema-handler.js # Dynamic table management
│   ├── database/
│   │   ├── mysql-adapter.js  # MySQL operations
│   │   ├── postgres-adapter.js # PostgreSQL operations
│   │   └── adapter-factory.js  # DB provider selection
│   ├── endpoints/
│   │   └── definitions.js    # Endpoint configurations
│   └── utils/
│       └── logger.js         # Logging utility
├── .env.example
├── .gitignore
├── package.json
└── jasper-fetcher.service    # Systemd service file
```

## Schema Handling

The fetcher automatically handles schema changes:

1. **First run**: Creates tables based on API response structure
2. **Subsequent runs**: Adds new columns if API response has new fields
3. **Never drops columns**: Preserves existing data

## Examples

### Fetch 2024 Data Month by Month

```bash
# Set in .env
DATE_RANGE_MODE=yearly_by_month
DATE_RANGE_YEAR=2024

# Run
npm start margin
```

Output:
```
Processing: margin-report [2024-01] (2024-01-01 to 2024-01-31) -> 277 records
Processing: margin-report [2024-02] (2024-02-01 to 2024-02-29) -> 312 records
Processing: margin-report [2024-03] (2024-03-01 to 2024-03-31) -> 306 records
...
```

### Fetch Previous Month Only

```bash
# Set in .env
DATE_RANGE_MODE=previous_month

# Run
npm start
```

## Troubleshooting

### Connection Timeout
Large datasets may timeout. Use `yearly_by_month` mode to split data:
```env
DATE_RANGE_MODE=yearly_by_month
```

### Missing Columns
If API adds new fields, the fetcher automatically adds columns. No action needed.

### Database Connection Error
Check your database credentials in `.env` and ensure the database exists.

## License

ISC
