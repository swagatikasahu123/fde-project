-- =============================================================================
-- SAP Order-to-Cash — SQLite Schema
--
-- Conventions:
--   • Monetary amounts  → REAL
--   • Dates             → TEXT  (ISO-8601, e.g. "2025-04-03T00:00:00.000Z")
--   • Time objects      → TEXT  (flattened to "HH:MM:SS" by the ingestor)
--   • Booleans          → INTEGER (0 / 1)
--   • All string IDs    → TEXT  (SAP keys are alphanumeric)
-- =============================================================================
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
-- ---------------------------------------------------------------------------
-- 1. BUSINESS PARTNERS  (master customer / partner records)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS business_partners (
    businessPartner TEXT PRIMARY KEY,
    customer TEXT,
    businessPartnerCategory TEXT,
    businessPartnerFullName TEXT,
    businessPartnerGrouping TEXT,
    businessPartnerName TEXT,
    correspondenceLanguage TEXT,
    createdByUser TEXT,
    creationDate TEXT,
    creationTime TEXT,
    firstName TEXT,
    formOfAddress TEXT,
    industry TEXT,
    lastChangeDate TEXT,
    lastName TEXT,
    organizationBpName1 TEXT,
    organizationBpName2 TEXT,
    businessPartnerIsBlocked INTEGER NOT NULL DEFAULT 0,
    isMarkedForArchiving INTEGER NOT NULL DEFAULT 0
);
-- ---------------------------------------------------------------------------
-- 2. BUSINESS PARTNER ADDRESSES
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS business_partner_addresses (
    businessPartner TEXT NOT NULL,
    addressId TEXT NOT NULL,
    validityStartDate TEXT,
    validityEndDate TEXT,
    addressUuid TEXT,
    addressTimeZone TEXT,
    cityName TEXT,
    country TEXT,
    poBox TEXT,
    poBoxDeviatingCityName TEXT,
    poBoxDeviatingCountry TEXT,
    poBoxDeviatingRegion TEXT,
    poBoxIsWithoutNumber INTEGER NOT NULL DEFAULT 0,
    poBoxLobbyName TEXT,
    poBoxPostalCode TEXT,
    postalCode TEXT,
    region TEXT,
    streetName TEXT,
    taxJurisdiction TEXT,
    transportZone TEXT,
    PRIMARY KEY (businessPartner, addressId),
    FOREIGN KEY (businessPartner) REFERENCES business_partners(businessPartner)
);
-- ---------------------------------------------------------------------------
-- 3. CUSTOMER ↔ COMPANY CODE ASSIGNMENTS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customer_company_assignments (
    customer TEXT NOT NULL,
    companyCode TEXT NOT NULL,
    accountingClerk TEXT,
    accountingClerkFaxNumber TEXT,
    accountingClerkInternetAddress TEXT,
    accountingClerkPhoneNumber TEXT,
    alternativePayerAccount TEXT,
    paymentBlockingReason TEXT,
    paymentMethodsList TEXT,
    paymentTerms TEXT,
    reconciliationAccount TEXT,
    deletionIndicator INTEGER NOT NULL DEFAULT 0,
    customerAccountGroup TEXT,
    PRIMARY KEY (customer, companyCode),
    FOREIGN KEY (customer) REFERENCES business_partners(businessPartner)
);
-- ---------------------------------------------------------------------------
-- 4. CUSTOMER ↔ SALES AREA ASSIGNMENTS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customer_sales_area_assignments (
    customer TEXT NOT NULL,
    salesOrganization TEXT NOT NULL,
    distributionChannel TEXT NOT NULL,
    division TEXT NOT NULL,
    billingIsBlockedForCustomer TEXT,
    completeDeliveryIsDefined INTEGER NOT NULL DEFAULT 0,
    creditControlArea TEXT,
    currency TEXT,
    customerPaymentTerms TEXT,
    deliveryPriority TEXT,
    incotermsClassification TEXT,
    incotermsLocation1 TEXT,
    salesGroup TEXT,
    salesOffice TEXT,
    shippingCondition TEXT,
    slsUnlmtdOvrdelivIsAllwd INTEGER NOT NULL DEFAULT 0,
    supplyingPlant TEXT,
    salesDistrict TEXT,
    exchangeRateType TEXT,
    PRIMARY KEY (
        customer,
        salesOrganization,
        distributionChannel,
        division
    ),
    FOREIGN KEY (customer) REFERENCES business_partners(businessPartner)
);
-- ---------------------------------------------------------------------------
-- 5. PLANTS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS plants (
    plant TEXT PRIMARY KEY,
    plantName TEXT,
    valuationArea TEXT,
    plantCustomer TEXT,
    plantSupplier TEXT,
    factoryCalendar TEXT,
    defaultPurchasingOrganization TEXT,
    salesOrganization TEXT,
    addressId TEXT,
    plantCategory TEXT,
    distributionChannel TEXT,
    division TEXT,
    language TEXT,
    isMarkedForArchiving INTEGER NOT NULL DEFAULT 0
);
-- ---------------------------------------------------------------------------
-- 6. PRODUCTS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
    product TEXT PRIMARY KEY,
    productType TEXT,
    crossPlantStatus TEXT,
    crossPlantStatusValidityDate TEXT,
    creationDate TEXT,
    createdByUser TEXT,
    lastChangeDate TEXT,
    lastChangeDateTime TEXT,
    isMarkedForDeletion INTEGER NOT NULL DEFAULT 0,
    productOldId TEXT,
    grossWeight REAL,
    weightUnit TEXT,
    netWeight REAL,
    productGroup TEXT,
    baseUnit TEXT,
    division TEXT,
    industrySector TEXT
);
-- ---------------------------------------------------------------------------
-- 7. PRODUCT DESCRIPTIONS  (language-specific display names)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS product_descriptions (
    product TEXT NOT NULL,
    language TEXT NOT NULL,
    productDescription TEXT,
    PRIMARY KEY (product, language),
    FOREIGN KEY (product) REFERENCES products(product)
);
-- ---------------------------------------------------------------------------
-- 8. PRODUCT ↔ PLANT  (availability / MRP per plant)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS product_plants (
    product TEXT NOT NULL,
    plant TEXT NOT NULL,
    countryOfOrigin TEXT,
    regionOfOrigin TEXT,
    productionInvtryManagedLoc TEXT,
    availabilityCheckType TEXT,
    fiscalYearVariant TEXT,
    profitCenter TEXT,
    mrpType TEXT,
    PRIMARY KEY (product, plant),
    FOREIGN KEY (product) REFERENCES products(product),
    FOREIGN KEY (plant) REFERENCES plants(plant)
);
-- ---------------------------------------------------------------------------
-- 9. PRODUCT STORAGE LOCATIONS  (stock at plant + storage location level)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS product_storage_locations (
    product TEXT NOT NULL,
    plant TEXT NOT NULL,
    storageLocation TEXT NOT NULL,
    physicalInventoryBlockInd TEXT,
    dateOfLastPostedCntUnRstrcdStk TEXT,
    PRIMARY KEY (product, plant, storageLocation),
    FOREIGN KEY (product) REFERENCES products(product),
    FOREIGN KEY (plant) REFERENCES plants(plant)
);
-- ---------------------------------------------------------------------------
-- 10. SALES ORDER HEADERS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sales_order_headers (
    salesOrder TEXT PRIMARY KEY,
    salesOrderType TEXT,
    salesOrganization TEXT,
    distributionChannel TEXT,
    organizationDivision TEXT,
    salesGroup TEXT,
    salesOffice TEXT,
    soldToParty TEXT,
    creationDate TEXT,
    createdByUser TEXT,
    lastChangeDateTime TEXT,
    totalNetAmount REAL,
    overallDeliveryStatus TEXT,
    overallOrdReltdBillgStatus TEXT,
    overallSdDocReferenceStatus TEXT,
    transactionCurrency TEXT,
    pricingDate TEXT,
    requestedDeliveryDate TEXT,
    headerBillingBlockReason TEXT,
    deliveryBlockReason TEXT,
    incotermsClassification TEXT,
    incotermsLocation1 TEXT,
    customerPaymentTerms TEXT,
    totalCreditCheckStatus TEXT,
    FOREIGN KEY (soldToParty) REFERENCES business_partners(businessPartner)
);
-- ---------------------------------------------------------------------------
-- 11. SALES ORDER ITEMS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sales_order_items (
    salesOrder TEXT NOT NULL,
    salesOrderItem TEXT NOT NULL,
    salesOrderItemCategory TEXT,
    material TEXT,
    requestedQuantity REAL,
    requestedQuantityUnit TEXT,
    transactionCurrency TEXT,
    netAmount REAL,
    materialGroup TEXT,
    productionPlant TEXT,
    storageLocation TEXT,
    salesDocumentRjcnReason TEXT,
    itemBillingBlockReason TEXT,
    PRIMARY KEY (salesOrder, salesOrderItem),
    FOREIGN KEY (salesOrder) REFERENCES sales_order_headers(salesOrder),
    FOREIGN KEY (material) REFERENCES products(product)
);
-- ---------------------------------------------------------------------------
-- 12. SALES ORDER SCHEDULE LINES  (confirmed delivery schedule per item)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sales_order_schedule_lines (
    salesOrder TEXT NOT NULL,
    salesOrderItem TEXT NOT NULL,
    scheduleLine TEXT NOT NULL,
    confirmedDeliveryDate TEXT,
    orderQuantityUnit TEXT,
    confdOrderQtyByMatlAvailCheck REAL,
    PRIMARY KEY (salesOrder, salesOrderItem, scheduleLine),
    FOREIGN KEY (salesOrder, salesOrderItem) REFERENCES sales_order_items(salesOrder, salesOrderItem)
);
-- ---------------------------------------------------------------------------
-- 13. OUTBOUND DELIVERY HEADERS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS outbound_delivery_headers (
    deliveryDocument TEXT PRIMARY KEY,
    actualGoodsMovementDate TEXT,
    actualGoodsMovementTime TEXT,
    creationDate TEXT,
    creationTime TEXT,
    deliveryBlockReason TEXT,
    hdrGeneralIncompletionStatus TEXT,
    headerBillingBlockReason TEXT,
    lastChangeDate TEXT,
    overallGoodsMovementStatus TEXT,
    overallPickingStatus TEXT,
    overallProofOfDeliveryStatus TEXT,
    shippingPoint TEXT
);
-- ---------------------------------------------------------------------------
-- 14. OUTBOUND DELIVERY ITEMS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS outbound_delivery_items (
    deliveryDocument TEXT NOT NULL,
    deliveryDocumentItem TEXT NOT NULL,
    actualDeliveryQuantity REAL,
    batch TEXT,
    deliveryQuantityUnit TEXT,
    itemBillingBlockReason TEXT,
    lastChangeDate TEXT,
    plant TEXT,
    referenceSdDocument TEXT,
    referenceSdDocumentItem TEXT,
    storageLocation TEXT,
    PRIMARY KEY (deliveryDocument, deliveryDocumentItem),
    FOREIGN KEY (deliveryDocument) REFERENCES outbound_delivery_headers(deliveryDocument),
    FOREIGN KEY (plant) REFERENCES plants(plant)
);
-- ---------------------------------------------------------------------------
-- 15. BILLING DOCUMENT HEADERS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS billing_document_headers (
    billingDocument TEXT PRIMARY KEY,
    billingDocumentType TEXT,
    creationDate TEXT,
    creationTime TEXT,
    lastChangeDateTime TEXT,
    billingDocumentDate TEXT,
    billingDocumentIsCancelled INTEGER NOT NULL DEFAULT 0,
    cancelledBillingDocument TEXT,
    totalNetAmount REAL,
    transactionCurrency TEXT,
    companyCode TEXT,
    fiscalYear TEXT,
    accountingDocument TEXT,
    soldToParty TEXT,
    FOREIGN KEY (soldToParty) REFERENCES business_partners(businessPartner)
);
-- ---------------------------------------------------------------------------
-- 16. BILLING DOCUMENT CANCELLATIONS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS billing_document_cancellations (
    billingDocument TEXT PRIMARY KEY,
    billingDocumentType TEXT,
    creationDate TEXT,
    creationTime TEXT,
    lastChangeDateTime TEXT,
    billingDocumentDate TEXT,
    billingDocumentIsCancelled INTEGER NOT NULL DEFAULT 0,
    cancelledBillingDocument TEXT,
    totalNetAmount REAL,
    transactionCurrency TEXT,
    companyCode TEXT,
    fiscalYear TEXT,
    accountingDocument TEXT,
    soldToParty TEXT,
    FOREIGN KEY (soldToParty) REFERENCES business_partners(businessPartner)
);
-- ---------------------------------------------------------------------------
-- 17. BILLING DOCUMENT ITEMS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS billing_document_items (
    billingDocument TEXT NOT NULL,
    billingDocumentItem TEXT NOT NULL,
    material TEXT,
    billingQuantity REAL,
    billingQuantityUnit TEXT,
    netAmount REAL,
    transactionCurrency TEXT,
    referenceSdDocument TEXT,
    referenceSdDocumentItem TEXT,
    PRIMARY KEY (billingDocument, billingDocumentItem),
    FOREIGN KEY (billingDocument) REFERENCES billing_document_headers(billingDocument),
    FOREIGN KEY (material) REFERENCES products(product)
);
-- ---------------------------------------------------------------------------
-- 18. JOURNAL ENTRY ITEMS — ACCOUNTS RECEIVABLE
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS journal_entry_items_ar (
    companyCode TEXT NOT NULL,
    fiscalYear TEXT NOT NULL,
    accountingDocument TEXT NOT NULL,
    accountingDocumentItem TEXT NOT NULL,
    glAccount TEXT,
    referenceDocument TEXT,
    costCenter TEXT,
    profitCenter TEXT,
    transactionCurrency TEXT,
    amountInTransactionCurrency REAL,
    companyCodeCurrency TEXT,
    amountInCompanyCodeCurrency REAL,
    postingDate TEXT,
    documentDate TEXT,
    accountingDocumentType TEXT,
    assignmentReference TEXT,
    lastChangeDateTime TEXT,
    customer TEXT,
    financialAccountType TEXT,
    clearingDate TEXT,
    clearingAccountingDocument TEXT,
    clearingDocFiscalYear TEXT,
    PRIMARY KEY (
        companyCode,
        fiscalYear,
        accountingDocument,
        accountingDocumentItem
    ),
    FOREIGN KEY (customer) REFERENCES business_partners(businessPartner)
);
-- ---------------------------------------------------------------------------
-- 19. PAYMENTS — ACCOUNTS RECEIVABLE
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payments_ar (
    companyCode TEXT NOT NULL,
    fiscalYear TEXT NOT NULL,
    accountingDocument TEXT NOT NULL,
    accountingDocumentItem TEXT NOT NULL,
    clearingDate TEXT,
    clearingAccountingDocument TEXT,
    clearingDocFiscalYear TEXT,
    amountInTransactionCurrency REAL,
    transactionCurrency TEXT,
    amountInCompanyCodeCurrency REAL,
    companyCodeCurrency TEXT,
    customer TEXT,
    invoiceReference TEXT,
    invoiceReferenceFiscalYear TEXT,
    salesDocument TEXT,
    salesDocumentItem TEXT,
    postingDate TEXT,
    documentDate TEXT,
    assignmentReference TEXT,
    glAccount TEXT,
    financialAccountType TEXT,
    profitCenter TEXT,
    costCenter TEXT,
    PRIMARY KEY (
        companyCode,
        fiscalYear,
        accountingDocument,
        accountingDocumentItem
    ),
    FOREIGN KEY (customer) REFERENCES business_partners(businessPartner)
);
-- =============================================================================
-- INDEXES
-- Every FK join path and common filter predicate gets an index.
-- =============================================================================
-- business_partners
CREATE INDEX IF NOT EXISTS idx_bp_customer ON business_partners(customer);
-- addresses
CREATE INDEX IF NOT EXISTS idx_bpa_partner ON business_partner_addresses(businessPartner);
-- company assignments
CREATE INDEX IF NOT EXISTS idx_cca_customer ON customer_company_assignments(customer);
CREATE INDEX IF NOT EXISTS idx_cca_companyCode ON customer_company_assignments(companyCode);
-- sales area assignments
CREATE INDEX IF NOT EXISTS idx_csaa_customer ON customer_sales_area_assignments(customer);
CREATE INDEX IF NOT EXISTS idx_csaa_salesOrg ON customer_sales_area_assignments(salesOrganization);
-- product descriptions
CREATE INDEX IF NOT EXISTS idx_pd_product ON product_descriptions(product);
-- product_plants
CREATE INDEX IF NOT EXISTS idx_pp_product ON product_plants(product);
CREATE INDEX IF NOT EXISTS idx_pp_plant ON product_plants(plant);
-- product_storage_locations
CREATE INDEX IF NOT EXISTS idx_psl_product ON product_storage_locations(product);
CREATE INDEX IF NOT EXISTS idx_psl_plant ON product_storage_locations(plant);
CREATE INDEX IF NOT EXISTS idx_psl_product_plant ON product_storage_locations(product, plant);
-- sales_order_headers
CREATE INDEX IF NOT EXISTS idx_soh_soldToParty ON sales_order_headers(soldToParty);
CREATE INDEX IF NOT EXISTS idx_soh_creationDate ON sales_order_headers(creationDate);
CREATE INDEX IF NOT EXISTS idx_soh_overallDeliveryStatus ON sales_order_headers(overallDeliveryStatus);
-- sales_order_items
CREATE INDEX IF NOT EXISTS idx_soi_salesOrder ON sales_order_items(salesOrder);
CREATE INDEX IF NOT EXISTS idx_soi_material ON sales_order_items(material);
CREATE INDEX IF NOT EXISTS idx_soi_productionPlant ON sales_order_items(productionPlant);
-- sales_order_schedule_lines
CREATE INDEX IF NOT EXISTS idx_sosl_salesOrder ON sales_order_schedule_lines(salesOrder);
CREATE INDEX IF NOT EXISTS idx_sosl_salesOrder_item ON sales_order_schedule_lines(salesOrder, salesOrderItem);
-- outbound_delivery_items
CREATE INDEX IF NOT EXISTS idx_odi_deliveryDocument ON outbound_delivery_items(deliveryDocument);
CREATE INDEX IF NOT EXISTS idx_odi_referenceSdDocument ON outbound_delivery_items(referenceSdDocument);
CREATE INDEX IF NOT EXISTS idx_odi_plant ON outbound_delivery_items(plant);
-- billing_document_headers
CREATE INDEX IF NOT EXISTS idx_bdh_soldToParty ON billing_document_headers(soldToParty);
CREATE INDEX IF NOT EXISTS idx_bdh_accountingDocument ON billing_document_headers(accountingDocument);
CREATE INDEX IF NOT EXISTS idx_bdh_billingDocumentDate ON billing_document_headers(billingDocumentDate);
-- billing_document_cancellations
CREATE INDEX IF NOT EXISTS idx_bdc_soldToParty ON billing_document_cancellations(soldToParty);
-- billing_document_items
CREATE INDEX IF NOT EXISTS idx_bdi_billingDocument ON billing_document_items(billingDocument);
CREATE INDEX IF NOT EXISTS idx_bdi_referenceSdDocument ON billing_document_items(referenceSdDocument);
CREATE INDEX IF NOT EXISTS idx_bdi_material ON billing_document_items(material);
-- journal_entry_items_ar
CREATE INDEX IF NOT EXISTS idx_jei_accountingDocument ON journal_entry_items_ar(accountingDocument);
CREATE INDEX IF NOT EXISTS idx_jei_customer ON journal_entry_items_ar(customer);
CREATE INDEX IF NOT EXISTS idx_jei_referenceDocument ON journal_entry_items_ar(referenceDocument);
CREATE INDEX IF NOT EXISTS idx_jei_postingDate ON journal_entry_items_ar(postingDate);
-- payments_ar
CREATE INDEX IF NOT EXISTS idx_par_accountingDocument ON payments_ar(accountingDocument);
CREATE INDEX IF NOT EXISTS idx_par_customer ON payments_ar(customer);
CREATE INDEX IF NOT EXISTS idx_par_clearingDate ON payments_ar(clearingDate);
CREATE INDEX IF NOT EXISTS idx_par_salesDocument ON payments_ar(salesDocument);