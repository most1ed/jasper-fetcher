module.exports = [
  // Master Data Endpoints
  {
    path: '/api/client/master/customer',
    tableName: 'jasper_customer',
    params: {},
    nestedTables: [],
  },
  {
    path: '/api/client/master/item',
    tableName: 'jasper_item',
    params: {},
    nestedTables: [],
  },
  {
    path: '/api/client/master/item-group',
    tableName: 'jasper_item_group',
    params: {},
    nestedTables: [],
  },
  {
    path: '/api/client/master/sales',
    tableName: 'jasper_sales',
    params: {},
    nestedTables: [],
  },
  {
    path: '/api/client/master/warehouse',
    tableName: 'jasper_warehouse',
    params: {},
    nestedTables: [
      {
        nestedKey: 'locations',
        childTable: 'jasper_warehouse_location',
        parentKey: 'warehouse_code',
      },
    ],
  },

  // Report Endpoints (require date_from and date_to)
  {
    path: '/api/client/report/generate/stock-balance-location-report',
    tableName: 'jasper_stock_balance_location_report',
    params: {},
    nestedTables: [],
    requiresDate: true,
  },
  {
    path: '/api/client/report/generate/stock-aging-location-report',
    tableName: 'jasper_stock_aging_location_report',
    params: {},
    nestedTables: [],
    requiresDate: true,
  },
  {
    path: '/api/client/report/generate/ar-aging-report',
    tableName: 'jasper_ar_aging_report',
    params: {},
    nestedTables: [],
    requiresDate: true,
  },
  {
    path: '/api/client/report/generate/sales-quote-report',
    tableName: 'jasper_sales_quote_report',
    params: {},
    nestedTables: [],
    requiresDate: true,
  },
  {
    path: '/api/client/report/generate/sales-order-report',
    tableName: 'jasper_sales_order_report',
    params: {},
    nestedTables: [],
    requiresDate: true,
  },
  {
    path: '/api/client/report/generate/sales-target-report',
    tableName: 'jasper_sales_target_report',
    params: {},
    nestedTables: [],
    requiresDate: true,
  },
  {
    path: '/api/client/report/generate/operational-expense-report',
    tableName: 'jasper_operational_expense_report',
    params: {},
    nestedTables: [],
    requiresDate: true,
  },
  {
    path: '/api/client/report/generate/margin-report',
    tableName: 'jasper_margin_report',
    params: {},
    nestedTables: [],
    requiresDate: true,
  },
  {
    path: '/api/client/report/generate/vehicle-service-report',
    tableName: 'jasper_vehicle_service_report',
    params: {},
    nestedTables: [],
    requiresDate: true,
  },

  // Transaction Endpoints (GET only for fetching)
  {
    path: '/api/client/transaction/purchase-receipt',
    tableName: 'jasper_purchase_receipt',
    params: {},
    nestedTables: [
      {
        nestedKey: 'items',
        childTable: 'jasper_purchase_receipt_item',
        parentKey: 'purchase_receipt_no',
      },
    ],
  },
];
