'use strict';

/**
 * db/init.js
 *
 * Initialises the SQLite database on startup:
 *   1. Executes schema.sql  (CREATE TABLE IF NOT EXISTS + indexes)
 *   2. Reads every *.jsonl part-file from DATA_DIR/<entity>/
 *   3. Maps each raw JSON record to flat column values
 *      — flattens time objects {hours,minutes,seconds} → "HH:MM:SS"
 *      — coerces numeric strings to REAL
 *      — converts booleans to 0/1
 *   4. Bulk-inserts inside a per-table transaction (fast synchronous load)
 *   5. Prints a row-count summary for every core table
 *
 * FK-safe insertion order: parent tables before child tables.
 * INSERT OR REPLACE is used so re-running the server is idempotent.
 */

const fs   = require('fs');
const path = require('path');

// ─────────────────────────────────────────────────────────────────────────────
// Utility helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Flatten {hours, minutes, seconds} → "HH:MM:SS", or null */
function flattenTime(val) {
  if (!val || typeof val !== 'object') return null;
  const h = String(val.hours   ?? 0).padStart(2, '0');
  const m = String(val.minutes ?? 0).padStart(2, '0');
  const s = String(val.seconds ?? 0).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

/** Parse a numeric-string or number to REAL; return null for missing values */
function toReal(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

/** Boolean → 0 / 1 */
function toBool(v) {
  return v ? 1 : 0;
}

/** Read all non-empty lines from a JSONL file and return parsed objects */
function readJsonl(filePath) {
  const rows = [];
  const content = fs.readFileSync(filePath, 'utf8');
  let lineNo = 0;
  for (const line of content.split('\n')) {
    lineNo++;
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      rows.push(JSON.parse(trimmed));
    } catch (err) {
      console.warn(`  [init] Skipping malformed line ${lineNo} in ${path.basename(filePath)}: ${err.message}`);
    }
  }
  return rows;
}

/** Collect all *.jsonl files inside a directory (non-recursive needed here) */
function collectJsonlFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.jsonl'))
    .map(f => path.join(dir, f))
    .sort();
}

// ─────────────────────────────────────────────────────────────────────────────
// Row-mapper definitions
// Each key must exactly match the sub-folder name inside DATA_DIR.
// buildRow(raw) returns a plain object whose keys match SQLite column names.
// ─────────────────────────────────────────────────────────────────────────────

const INGESTORS = {

  business_partners: {
    table: 'business_partners',
    buildRow(r) {
      return {
        businessPartner:          r.businessPartner,
        customer:                 r.customer,
        businessPartnerCategory:  r.businessPartnerCategory,
        businessPartnerFullName:  r.businessPartnerFullName,
        businessPartnerGrouping:  r.businessPartnerGrouping,
        businessPartnerName:      r.businessPartnerName,
        correspondenceLanguage:   r.correspondenceLanguage,
        createdByUser:            r.createdByUser,
        creationDate:             r.creationDate,
        creationTime:             flattenTime(r.creationTime),
        firstName:                r.firstName,
        formOfAddress:            r.formOfAddress,
        industry:                 r.industry,
        lastChangeDate:           r.lastChangeDate,
        lastName:                 r.lastName,
        organizationBpName1:      r.organizationBpName1,
        organizationBpName2:      r.organizationBpName2,
        businessPartnerIsBlocked: toBool(r.businessPartnerIsBlocked),
        isMarkedForArchiving:     toBool(r.isMarkedForArchiving),
      };
    },
  },

  business_partner_addresses: {
    table: 'business_partner_addresses',
    buildRow(r) {
      return {
        businessPartner:          r.businessPartner,
        addressId:                r.addressId,
        validityStartDate:        r.validityStartDate,
        validityEndDate:          r.validityEndDate,
        addressUuid:              r.addressUuid,
        addressTimeZone:          r.addressTimeZone,
        cityName:                 r.cityName,
        country:                  r.country,
        poBox:                    r.poBox,
        poBoxDeviatingCityName:   r.poBoxDeviatingCityName,
        poBoxDeviatingCountry:    r.poBoxDeviatingCountry,
        poBoxDeviatingRegion:     r.poBoxDeviatingRegion,
        poBoxIsWithoutNumber:     toBool(r.poBoxIsWithoutNumber),
        poBoxLobbyName:           r.poBoxLobbyName,
        poBoxPostalCode:          r.poBoxPostalCode,
        postalCode:               r.postalCode,
        region:                   r.region,
        streetName:               r.streetName,
        taxJurisdiction:          r.taxJurisdiction,
        transportZone:            r.transportZone,
      };
    },
  },

  customer_company_assignments: {
    table: 'customer_company_assignments',
    buildRow(r) {
      return {
        customer:                       r.customer,
        companyCode:                    r.companyCode,
        accountingClerk:                r.accountingClerk,
        accountingClerkFaxNumber:       r.accountingClerkFaxNumber,
        accountingClerkInternetAddress: r.accountingClerkInternetAddress,
        accountingClerkPhoneNumber:     r.accountingClerkPhoneNumber,
        alternativePayerAccount:        r.alternativePayerAccount,
        paymentBlockingReason:          r.paymentBlockingReason,
        paymentMethodsList:             r.paymentMethodsList,
        paymentTerms:                   r.paymentTerms,
        reconciliationAccount:          r.reconciliationAccount,
        deletionIndicator:              toBool(r.deletionIndicator),
        customerAccountGroup:           r.customerAccountGroup,
      };
    },
  },

  customer_sales_area_assignments: {
    table: 'customer_sales_area_assignments',
    buildRow(r) {
      return {
        customer:                    r.customer,
        salesOrganization:           r.salesOrganization,
        distributionChannel:         r.distributionChannel,
        division:                    r.division,
        billingIsBlockedForCustomer: r.billingIsBlockedForCustomer,
        completeDeliveryIsDefined:   toBool(r.completeDeliveryIsDefined),
        creditControlArea:           r.creditControlArea,
        currency:                    r.currency,
        customerPaymentTerms:        r.customerPaymentTerms,
        deliveryPriority:            r.deliveryPriority,
        incotermsClassification:     r.incotermsClassification,
        incotermsLocation1:          r.incotermsLocation1,
        salesGroup:                  r.salesGroup,
        salesOffice:                 r.salesOffice,
        shippingCondition:           r.shippingCondition,
        slsUnlmtdOvrdelivIsAllwd:    toBool(r.slsUnlmtdOvrdelivIsAllwd),
        supplyingPlant:              r.supplyingPlant,
        salesDistrict:               r.salesDistrict,
        exchangeRateType:            r.exchangeRateType,
      };
    },
  },

  plants: {
    table: 'plants',
    buildRow(r) {
      return {
        plant:                          r.plant,
        plantName:                      r.plantName,
        valuationArea:                  r.valuationArea,
        plantCustomer:                  r.plantCustomer,
        plantSupplier:                  r.plantSupplier,
        factoryCalendar:                r.factoryCalendar,
        defaultPurchasingOrganization:  r.defaultPurchasingOrganization,
        salesOrganization:              r.salesOrganization,
        addressId:                      r.addressId,
        plantCategory:                  r.plantCategory,
        distributionChannel:            r.distributionChannel,
        division:                       r.division,
        language:                       r.language,
        isMarkedForArchiving:           toBool(r.isMarkedForArchiving),
      };
    },
  },

  products: {
    table: 'products',
    buildRow(r) {
      return {
        product:                      r.product,
        productType:                  r.productType,
        crossPlantStatus:             r.crossPlantStatus,
        crossPlantStatusValidityDate: r.crossPlantStatusValidityDate,
        creationDate:                 r.creationDate,
        createdByUser:                r.createdByUser,
        lastChangeDate:               r.lastChangeDate,
        lastChangeDateTime:           r.lastChangeDateTime,
        isMarkedForDeletion:          toBool(r.isMarkedForDeletion),
        productOldId:                 r.productOldId,
        grossWeight:                  toReal(r.grossWeight),
        weightUnit:                   r.weightUnit,
        netWeight:                    toReal(r.netWeight),
        productGroup:                 r.productGroup,
        baseUnit:                     r.baseUnit,
        division:                     r.division,
        industrySector:               r.industrySector,
      };
    },
  },

  product_descriptions: {
    table: 'product_descriptions',
    buildRow(r) {
      return {
        product:            r.product,
        language:           r.language,
        productDescription: r.productDescription,
      };
    },
  },

  product_plants: {
    table: 'product_plants',
    buildRow(r) {
      return {
        product:                    r.product,
        plant:                      r.plant,
        countryOfOrigin:            r.countryOfOrigin,
        regionOfOrigin:             r.regionOfOrigin,
        productionInvtryManagedLoc: r.productionInvtryManagedLoc,
        availabilityCheckType:      r.availabilityCheckType,
        fiscalYearVariant:          r.fiscalYearVariant,
        profitCenter:               r.profitCenter,
        mrpType:                    r.mrpType,
      };
    },
  },

  product_storage_locations: {
    table: 'product_storage_locations',
    buildRow(r) {
      return {
        product:                        r.product,
        plant:                          r.plant,
        storageLocation:                r.storageLocation,
        physicalInventoryBlockInd:      r.physicalInventoryBlockInd,
        dateOfLastPostedCntUnRstrcdStk: r.dateOfLastPostedCntUnRstrcdStk,
      };
    },
  },

  sales_order_headers: {
    table: 'sales_order_headers',
    buildRow(r) {
      return {
        salesOrder:                   r.salesOrder,
        salesOrderType:               r.salesOrderType,
        salesOrganization:            r.salesOrganization,
        distributionChannel:          r.distributionChannel,
        organizationDivision:         r.organizationDivision,
        salesGroup:                   r.salesGroup,
        salesOffice:                  r.salesOffice,
        soldToParty:                  r.soldToParty,
        creationDate:                 r.creationDate,
        createdByUser:                r.createdByUser,
        lastChangeDateTime:           r.lastChangeDateTime,
        totalNetAmount:               toReal(r.totalNetAmount),
        overallDeliveryStatus:        r.overallDeliveryStatus,
        overallOrdReltdBillgStatus:   r.overallOrdReltdBillgStatus,
        overallSdDocReferenceStatus:  r.overallSdDocReferenceStatus,
        transactionCurrency:          r.transactionCurrency,
        pricingDate:                  r.pricingDate,
        requestedDeliveryDate:        r.requestedDeliveryDate,
        headerBillingBlockReason:     r.headerBillingBlockReason,
        deliveryBlockReason:          r.deliveryBlockReason,
        incotermsClassification:      r.incotermsClassification,
        incotermsLocation1:           r.incotermsLocation1,
        customerPaymentTerms:         r.customerPaymentTerms,
        totalCreditCheckStatus:       r.totalCreditCheckStatus,
      };
    },
  },

  sales_order_items: {
    table: 'sales_order_items',
    buildRow(r) {
      return {
        salesOrder:              r.salesOrder,
        salesOrderItem:          r.salesOrderItem,
        salesOrderItemCategory:  r.salesOrderItemCategory,
        material:                r.material,
        requestedQuantity:       toReal(r.requestedQuantity),
        requestedQuantityUnit:   r.requestedQuantityUnit,
        transactionCurrency:     r.transactionCurrency,
        netAmount:               toReal(r.netAmount),
        materialGroup:           r.materialGroup,
        productionPlant:         r.productionPlant,
        storageLocation:         r.storageLocation,
        salesDocumentRjcnReason: r.salesDocumentRjcnReason,
        itemBillingBlockReason:  r.itemBillingBlockReason,
      };
    },
  },

  sales_order_schedule_lines: {
    table: 'sales_order_schedule_lines',
    buildRow(r) {
      return {
        salesOrder:                    r.salesOrder,
        salesOrderItem:                r.salesOrderItem,
        scheduleLine:                  r.scheduleLine,
        confirmedDeliveryDate:         r.confirmedDeliveryDate,
        orderQuantityUnit:             r.orderQuantityUnit,
        confdOrderQtyByMatlAvailCheck: toReal(r.confdOrderQtyByMatlAvailCheck),
      };
    },
  },

  outbound_delivery_headers: {
    table: 'outbound_delivery_headers',
    buildRow(r) {
      return {
        deliveryDocument:               r.deliveryDocument,
        actualGoodsMovementDate:        r.actualGoodsMovementDate,
        actualGoodsMovementTime:        flattenTime(r.actualGoodsMovementTime),
        creationDate:                   r.creationDate,
        creationTime:                   flattenTime(r.creationTime),
        deliveryBlockReason:            r.deliveryBlockReason,
        hdrGeneralIncompletionStatus:   r.hdrGeneralIncompletionStatus,
        headerBillingBlockReason:       r.headerBillingBlockReason,
        lastChangeDate:                 r.lastChangeDate,
        overallGoodsMovementStatus:     r.overallGoodsMovementStatus,
        overallPickingStatus:           r.overallPickingStatus,
        overallProofOfDeliveryStatus:   r.overallProofOfDeliveryStatus,
        shippingPoint:                  r.shippingPoint,
      };
    },
  },

  outbound_delivery_items: {
    table: 'outbound_delivery_items',
    buildRow(r) {
      return {
        deliveryDocument:        r.deliveryDocument,
        deliveryDocumentItem:    r.deliveryDocumentItem,
        actualDeliveryQuantity:  toReal(r.actualDeliveryQuantity),
        batch:                   r.batch,
        deliveryQuantityUnit:    r.deliveryQuantityUnit,
        itemBillingBlockReason:  r.itemBillingBlockReason,
        lastChangeDate:          r.lastChangeDate,
        plant:                   r.plant,
        referenceSdDocument:     r.referenceSdDocument,
        referenceSdDocumentItem: r.referenceSdDocumentItem,
        storageLocation:         r.storageLocation,
      };
    },
  },

  billing_document_headers: {
    table: 'billing_document_headers',
    buildRow(r) {
      return {
        billingDocument:             r.billingDocument,
        billingDocumentType:         r.billingDocumentType,
        creationDate:                r.creationDate,
        creationTime:                flattenTime(r.creationTime),
        lastChangeDateTime:          r.lastChangeDateTime,
        billingDocumentDate:         r.billingDocumentDate,
        billingDocumentIsCancelled:  toBool(r.billingDocumentIsCancelled),
        cancelledBillingDocument:    r.cancelledBillingDocument,
        totalNetAmount:              toReal(r.totalNetAmount),
        transactionCurrency:         r.transactionCurrency,
        companyCode:                 r.companyCode,
        fiscalYear:                  r.fiscalYear,
        accountingDocument:          r.accountingDocument,
        soldToParty:                 r.soldToParty,
      };
    },
  },

  billing_document_cancellations: {
    table: 'billing_document_cancellations',
    buildRow(r) {
      return {
        billingDocument:             r.billingDocument,
        billingDocumentType:         r.billingDocumentType,
        creationDate:                r.creationDate,
        creationTime:                flattenTime(r.creationTime),
        lastChangeDateTime:          r.lastChangeDateTime,
        billingDocumentDate:         r.billingDocumentDate,
        billingDocumentIsCancelled:  toBool(r.billingDocumentIsCancelled),
        cancelledBillingDocument:    r.cancelledBillingDocument,
        totalNetAmount:              toReal(r.totalNetAmount),
        transactionCurrency:         r.transactionCurrency,
        companyCode:                 r.companyCode,
        fiscalYear:                  r.fiscalYear,
        accountingDocument:          r.accountingDocument,
        soldToParty:                 r.soldToParty,
      };
    },
  },

  billing_document_items: {
    table: 'billing_document_items',
    buildRow(r) {
      return {
        billingDocument:         r.billingDocument,
        billingDocumentItem:     r.billingDocumentItem,
        material:                r.material,
        billingQuantity:         toReal(r.billingQuantity),
        billingQuantityUnit:     r.billingQuantityUnit,
        netAmount:               toReal(r.netAmount),
        transactionCurrency:     r.transactionCurrency,
        referenceSdDocument:     r.referenceSdDocument,
        referenceSdDocumentItem: r.referenceSdDocumentItem,
      };
    },
  },

  journal_entry_items_accounts_receivable: {
    table: 'journal_entry_items_ar',
    buildRow(r) {
      return {
        companyCode:                  r.companyCode,
        fiscalYear:                   r.fiscalYear,
        accountingDocument:           r.accountingDocument,
        accountingDocumentItem:       r.accountingDocumentItem,
        glAccount:                    r.glAccount,
        referenceDocument:            r.referenceDocument,
        costCenter:                   r.costCenter,
        profitCenter:                 r.profitCenter,
        transactionCurrency:          r.transactionCurrency,
        amountInTransactionCurrency:  toReal(r.amountInTransactionCurrency),
        companyCodeCurrency:          r.companyCodeCurrency,
        amountInCompanyCodeCurrency:  toReal(r.amountInCompanyCodeCurrency),
        postingDate:                  r.postingDate,
        documentDate:                 r.documentDate,
        accountingDocumentType:       r.accountingDocumentType,
        assignmentReference:          r.assignmentReference,
        lastChangeDateTime:           r.lastChangeDateTime,
        customer:                     r.customer,
        financialAccountType:         r.financialAccountType,
        clearingDate:                 r.clearingDate,
        clearingAccountingDocument:   r.clearingAccountingDocument,
        clearingDocFiscalYear:        r.clearingDocFiscalYear,
      };
    },
  },

  payments_accounts_receivable: {
    table: 'payments_ar',
    buildRow(r) {
      return {
        companyCode:                  r.companyCode,
        fiscalYear:                   r.fiscalYear,
        accountingDocument:           r.accountingDocument,
        accountingDocumentItem:       r.accountingDocumentItem,
        clearingDate:                 r.clearingDate,
        clearingAccountingDocument:   r.clearingAccountingDocument,
        clearingDocFiscalYear:        r.clearingDocFiscalYear,
        amountInTransactionCurrency:  toReal(r.amountInTransactionCurrency),
        transactionCurrency:          r.transactionCurrency,
        amountInCompanyCodeCurrency:  toReal(r.amountInCompanyCodeCurrency),
        companyCodeCurrency:          r.companyCodeCurrency,
        customer:                     r.customer,
        invoiceReference:             r.invoiceReference,
        invoiceReferenceFiscalYear:   r.invoiceReferenceFiscalYear,
        salesDocument:                r.salesDocument,
        salesDocumentItem:            r.salesDocumentItem,
        postingDate:                  r.postingDate,
        documentDate:                 r.documentDate,
        assignmentReference:          r.assignmentReference,
        glAccount:                    r.glAccount,
        financialAccountType:         r.financialAccountType,
        profitCenter:                 r.profitCenter,
        costCenter:                   r.costCenter,
      };
    },
  },
};

// FK-safe insertion order: every parent table before its children
const INGEST_ORDER = [
  'business_partners',
  'business_partner_addresses',
  'customer_company_assignments',
  'customer_sales_area_assignments',
  'plants',
  'products',
  'product_descriptions',
  'product_plants',
  'product_storage_locations',
  'sales_order_headers',
  'sales_order_items',
  'sales_order_schedule_lines',
  'outbound_delivery_headers',
  'outbound_delivery_items',
  'billing_document_headers',
  'billing_document_cancellations',
  'billing_document_items',
  'journal_entry_items_accounts_receivable',
  'payments_accounts_receivable',
];

// ─────────────────────────────────────────────────────────────────────────────
// Core ingest function
// ─────────────────────────────────────────────────────────────────────────────

function initDatabase(db, dataDir) {
  // 1. Apply schema
  console.log('[init] Applying schema...');
  const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schemaSql);
  console.log('[init] Schema applied.\n');

  const startTotal = Date.now();

  // 2. Ingest each entity in FK-safe order
  for (const folderName of INGEST_ORDER) {
    const ingestor = INGESTORS[folderName];
    if (!ingestor) {
      console.warn(`[init] No ingestor for "${folderName}" — skipping.`);
      continue;
    }

    const folderPath = path.join(dataDir, folderName);
    const files = collectJsonlFiles(folderPath);

    if (files.length === 0) {
      console.warn(`[init] No JSONL files found in ${folderPath} — skipping.`);
      continue;
    }

    // Read all part-files for this entity
    let rawRows = [];
    for (const file of files) {
      rawRows = rawRows.concat(readJsonl(file));
    }

    if (rawRows.length === 0) {
      console.log(`[init] ${folderName}: 0 source rows.`);
      continue;
    }

    // Map raw JSON → column objects
    const mappedRows  = [];
    let   mapFailures = 0;
    for (const raw of rawRows) {
      try {
        mappedRows.push(ingestor.buildRow(raw));
      } catch (err) {
        mapFailures++;
        if (mapFailures <= 3) {
          console.warn(`  [init] Mapping error in ${folderName}: ${err.message}`);
        }
      }
    }

    if (mappedRows.length === 0) {
      console.warn(`[init] ${folderName}: all rows failed mapping — skipping.`);
      continue;
    }

    // Derive column list from the first mapped row
    const columns      = Object.keys(mappedRows[0]);
    const placeholders = columns.map(c => `@${c}`).join(', ');
    const insertSQL    = `INSERT OR REPLACE INTO ${ingestor.table} (${columns.join(', ')}) VALUES (${placeholders})`;

    let stmt;
    try {
      stmt = db.prepare(insertSQL);
    } catch (err) {
      console.error(`[init] Failed to prepare INSERT for ${ingestor.table}: ${err.message}`);
      throw err;
    }

    // Bulk insert inside a single transaction
    const start = Date.now();
    let inserted = 0;
    let rowFailures = 0;

    const insertAll = db.transaction((rows) => {
      for (const row of rows) {
        try {
          stmt.run(row);
          inserted++;
        } catch (err) {
          rowFailures++;
          if (rowFailures <= 3) {
            console.warn(`  [init] Row insert error in ${ingestor.table}: ${err.message}`);
          }
        }
      }
    });

    insertAll(mappedRows);

    const ms      = Date.now() - start;
    const skipped = mappedRows.length - inserted;
    const parts   = [`${String(inserted).padStart(6)} rows`];
    if (skipped     > 0) parts.push(`${skipped} skipped`);
    if (mapFailures > 0) parts.push(`${mapFailures} map errors`);
    if (rowFailures > 0) parts.push(`${rowFailures} insert errors`);
    parts.push(`${ms}ms`);

    console.log(`[init]   ${ingestor.table.padEnd(38)} ${parts.join(' | ')}`);
  }

  const totalMs = Date.now() - startTotal;
  console.log(`\n[init] Ingest complete in ${totalMs}ms.\n`);

  // 3. Sanity row-count summary
  const coreTables = [
    'business_partners',
    'business_partner_addresses',
    'customer_company_assignments',
    'customer_sales_area_assignments',
    'plants',
    'products',
    'product_descriptions',
    'product_plants',
    'product_storage_locations',
    'sales_order_headers',
    'sales_order_items',
    'sales_order_schedule_lines',
    'outbound_delivery_headers',
    'outbound_delivery_items',
    'billing_document_headers',
    'billing_document_cancellations',
    'billing_document_items',
    'journal_entry_items_ar',
    'payments_ar',
  ];

  console.log('[init] Row counts:');
  for (const t of coreTables) {
    try {
      const { count } = db.prepare(`SELECT COUNT(*) AS count FROM ${t}`).get();
      console.log(`  ${t.padEnd(40)} ${String(count).padStart(7)}`);
    } catch (err) {
      console.warn(`  ${t}: ${err.message}`);
    }
  }

  console.log('\n[init] Database ready.\n');
}

module.exports = { initDatabase };