'use strict';

/**
 * services/claudeService.js  (powered by Groq — free tier)
 *
 * Three-step NL → SQL → Answer pipeline using Groq.
 * Model: llama-3.3-70b-versatile (free, fast, excellent at SQL)
 *
 * Free tier: 14,400 requests/day, 30 requests/minute — very generous.
 * Get your key at: https://console.groq.com → API Keys → Create
 *
 * STEP 1 — GUARDRAIL: classify question as SAP_O2C or OFF_TOPIC
 * STEP 2 — SQL GENERATION: schema + join paths + examples → clean SELECT
 * STEP 3 — ANSWER GENERATION: rows → grounded natural language answer
 */

const Groq = require('groq-sdk');

// ─────────────────────────────────────────────────────────────────────────────
// Client
// ─────────────────────────────────────────────────────────────────────────────

const groq  = new Groq({ apiKey: process.env.GROQ_API_KEY });
const MODEL = 'llama-3.3-70b-versatile'; // best free model on Groq

// Helper: single chat completion call
async function chat(systemPrompt, userMessage, maxTokens = 1024, temperature = 0) {
  const response = await groq.chat.completions.create({
    model:       MODEL,
    temperature,
    max_tokens:  maxTokens,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userMessage  },
    ],
  });
  return response.choices[0].message.content.trim();
}

// Helper: multi-turn chat (for SQL gen with conversation history)
async function chatWithHistory(systemPrompt, history, userMessage, maxTokens = 1024) {
  const messages = [{ role: 'system', content: systemPrompt }];
  for (const turn of history) {
    if (turn.role === 'user' || turn.role === 'assistant') {
      messages.push({ role: turn.role, content: turn.content });
    }
  }
  messages.push({ role: 'user', content: userMessage });

  const response = await groq.chat.completions.create({
    model:       MODEL,
    temperature: 0,
    max_tokens:  maxTokens,
    messages,
  });
  return response.choices[0].message.content.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Schema DDL — exact column names from the live SQLite database
// ─────────────────────────────────────────────────────────────────────────────

const SCHEMA_DDL = `
-- TABLE: business_partners  (master customer records)
CREATE TABLE business_partners (
  businessPartner TEXT PRIMARY KEY,   -- e.g. "310000108"
  customer TEXT,
  businessPartnerFullName TEXT,       -- company display name
  businessPartnerName TEXT,
  businessPartnerIsBlocked INTEGER,
  isMarkedForArchiving INTEGER,
  creationDate TEXT, lastChangeDate TEXT, industry TEXT
);

-- TABLE: business_partner_addresses
CREATE TABLE business_partner_addresses (
  businessPartner TEXT,               -- FK → business_partners.businessPartner
  addressId TEXT,
  cityName TEXT, country TEXT, region TEXT, streetName TEXT, postalCode TEXT,
  PRIMARY KEY (businessPartner, addressId)
);

-- TABLE: customer_company_assignments
CREATE TABLE customer_company_assignments (
  customer TEXT, companyCode TEXT,
  reconciliationAccount TEXT, paymentTerms TEXT,
  customerAccountGroup TEXT, deletionIndicator INTEGER,
  PRIMARY KEY (customer, companyCode)
);

-- TABLE: customer_sales_area_assignments
CREATE TABLE customer_sales_area_assignments (
  customer TEXT, salesOrganization TEXT, distributionChannel TEXT, division TEXT,
  currency TEXT, customerPaymentTerms TEXT, incotermsClassification TEXT,
  PRIMARY KEY (customer, salesOrganization, distributionChannel, division)
);

-- TABLE: plants
CREATE TABLE plants (
  plant TEXT PRIMARY KEY,             -- e.g. "WB05"
  plantName TEXT, salesOrganization TEXT, isMarkedForArchiving INTEGER
);

-- TABLE: products
CREATE TABLE products (
  product TEXT PRIMARY KEY,           -- e.g. "S8907367001003"
  productType TEXT, productOldId TEXT, productGroup TEXT,
  baseUnit TEXT, division TEXT, grossWeight REAL, netWeight REAL,
  creationDate TEXT, isMarkedForDeletion INTEGER
);

-- TABLE: product_descriptions  (always join with language = 'EN')
CREATE TABLE product_descriptions (
  product TEXT,                       -- FK → products.product
  language TEXT,
  productDescription TEXT,            -- human-readable name e.g. "SUNSCREEN GEL SPF50 50ML"
  PRIMARY KEY (product, language)
);

-- TABLE: product_plants
CREATE TABLE product_plants (
  product TEXT, plant TEXT,
  profitCenter TEXT, mrpType TEXT, availabilityCheckType TEXT,
  PRIMARY KEY (product, plant)
);

-- TABLE: product_storage_locations
CREATE TABLE product_storage_locations (
  product TEXT, plant TEXT, storageLocation TEXT,
  physicalInventoryBlockInd TEXT,
  PRIMARY KEY (product, plant, storageLocation)
);

-- TABLE: sales_order_headers
CREATE TABLE sales_order_headers (
  salesOrder TEXT PRIMARY KEY,        -- e.g. "740506"
  salesOrderType TEXT, salesOrganization TEXT,
  soldToParty TEXT,                   -- FK → business_partners.businessPartner
  creationDate TEXT, createdByUser TEXT, lastChangeDateTime TEXT,
  totalNetAmount REAL, transactionCurrency TEXT,
  overallDeliveryStatus TEXT,         -- 'C'=complete 'A'=not started 'B'=partial
  overallOrdReltdBillgStatus TEXT,    -- 'C'=billed  ''=not billed
  requestedDeliveryDate TEXT, customerPaymentTerms TEXT,
  headerBillingBlockReason TEXT, deliveryBlockReason TEXT
);

-- TABLE: sales_order_items
CREATE TABLE sales_order_items (
  salesOrder TEXT,                    -- FK → sales_order_headers.salesOrder
  salesOrderItem TEXT,
  material TEXT,                      -- FK → products.product
  requestedQuantity REAL, requestedQuantityUnit TEXT,
  netAmount REAL, materialGroup TEXT,
  productionPlant TEXT,               -- FK → plants.plant
  storageLocation TEXT,
  salesDocumentRjcnReason TEXT,       -- '' = not rejected
  PRIMARY KEY (salesOrder, salesOrderItem)
);

-- TABLE: sales_order_schedule_lines
CREATE TABLE sales_order_schedule_lines (
  salesOrder TEXT, salesOrderItem TEXT, scheduleLine TEXT,
  confirmedDeliveryDate TEXT, orderQuantityUnit TEXT,
  confdOrderQtyByMatlAvailCheck REAL,
  PRIMARY KEY (salesOrder, salesOrderItem, scheduleLine)
);

-- TABLE: outbound_delivery_headers
CREATE TABLE outbound_delivery_headers (
  deliveryDocument TEXT PRIMARY KEY,  -- e.g. "80737721"
  creationDate TEXT, actualGoodsMovementDate TEXT,
  overallGoodsMovementStatus TEXT,    -- 'C'=complete 'A'=not started
  overallPickingStatus TEXT, shippingPoint TEXT, lastChangeDate TEXT
);

-- TABLE: outbound_delivery_items
CREATE TABLE outbound_delivery_items (
  deliveryDocument TEXT,              -- FK → outbound_delivery_headers.deliveryDocument
  deliveryDocumentItem TEXT,
  referenceSdDocument TEXT,           -- FK → sales_order_headers.salesOrder
  plant TEXT,                         -- FK → plants.plant
  storageLocation TEXT,
  actualDeliveryQuantity REAL, deliveryQuantityUnit TEXT,
  PRIMARY KEY (deliveryDocument, deliveryDocumentItem)
);

-- TABLE: billing_document_headers
CREATE TABLE billing_document_headers (
  billingDocument TEXT PRIMARY KEY,   -- e.g. "90504248"
  billingDocumentType TEXT,
  billingDocumentDate TEXT, creationDate TEXT,
  totalNetAmount REAL, transactionCurrency TEXT,
  soldToParty TEXT,                   -- FK → business_partners.businessPartner
  accountingDocument TEXT,            -- FK → payments_ar / journal_entry_items_ar
  companyCode TEXT, fiscalYear TEXT,
  billingDocumentIsCancelled INTEGER  -- 1=cancelled 0=active
);

-- TABLE: billing_document_cancellations  (same columns as billing_document_headers)
CREATE TABLE billing_document_cancellations (
  billingDocument TEXT PRIMARY KEY,
  billingDocumentDate TEXT, totalNetAmount REAL, transactionCurrency TEXT,
  soldToParty TEXT, accountingDocument TEXT, companyCode TEXT, fiscalYear TEXT,
  billingDocumentIsCancelled INTEGER
);

-- TABLE: billing_document_items
CREATE TABLE billing_document_items (
  billingDocument TEXT,               -- FK → billing_document_headers.billingDocument
  billingDocumentItem TEXT,
  material TEXT,                      -- FK → products.product
  billingQuantity REAL, billingQuantityUnit TEXT,
  netAmount REAL, transactionCurrency TEXT,
  referenceSdDocument TEXT,           -- FK → outbound_delivery_headers.deliveryDocument
  PRIMARY KEY (billingDocument, billingDocumentItem)
);

-- TABLE: journal_entry_items_ar
CREATE TABLE journal_entry_items_ar (
  companyCode TEXT, fiscalYear TEXT,
  accountingDocument TEXT,            -- links to billing_document_headers.accountingDocument
  accountingDocumentItem TEXT,
  glAccount TEXT, referenceDocument TEXT,
  customer TEXT,                      -- FK → business_partners.businessPartner
  amountInTransactionCurrency REAL, transactionCurrency TEXT,
  amountInCompanyCodeCurrency REAL,
  postingDate TEXT, clearingDate TEXT, clearingAccountingDocument TEXT,
  financialAccountType TEXT, profitCenter TEXT,
  PRIMARY KEY (companyCode, fiscalYear, accountingDocument, accountingDocumentItem)
);

-- TABLE: payments_ar
CREATE TABLE payments_ar (
  companyCode TEXT, fiscalYear TEXT,
  accountingDocument TEXT,            -- links to billing_document_headers.accountingDocument
  accountingDocumentItem TEXT,
  customer TEXT,                      -- FK → business_partners.businessPartner
  amountInTransactionCurrency REAL, transactionCurrency TEXT,
  amountInCompanyCodeCurrency REAL,
  clearingDate TEXT, clearingAccountingDocument TEXT,
  postingDate TEXT, glAccount TEXT, profitCenter TEXT, salesDocument TEXT,
  PRIMARY KEY (companyCode, fiscalYear, accountingDocument, accountingDocumentItem)
);
`.trim();

const JOIN_PATHS = `
KEY JOIN PATHS (these are validated against the live database — use them exactly):

1. Customer → Sales Orders:
   sales_order_headers.soldToParty = business_partners.businessPartner

2. Sales Order → Line Items → Products:
   sales_order_items.salesOrder = sales_order_headers.salesOrder
   sales_order_items.material   = products.product

3. Product display names (ALWAYS join this for readable names):
   product_descriptions.product = products.product AND product_descriptions.language = 'EN'

4. Sales Order → Delivery:
   outbound_delivery_items.referenceSdDocument = sales_order_headers.salesOrder
   outbound_delivery_items.deliveryDocument    = outbound_delivery_headers.deliveryDocument

5. Delivery → Plant (shipping plant):
   outbound_delivery_items.plant = plants.plant

6. Delivery → Billing Document:
   billing_document_items.referenceSdDocument = outbound_delivery_headers.deliveryDocument
   billing_document_items.billingDocument     = billing_document_headers.billingDocument

7. Billing Document → Payment:
   payments_ar.accountingDocument = billing_document_headers.accountingDocument

8. Billing Document → Journal Entry:
   journal_entry_items_ar.accountingDocument = billing_document_headers.accountingDocument

9. Customer → Payments (direct):
   payments_ar.customer = business_partners.businessPartner

10. Product → Plant availability:
    product_plants.product = products.product AND product_plants.plant = plants.plant

STATUS FIELD VALUES:
- sales_order_headers.overallDeliveryStatus:      'C'=fully delivered, 'A'=not started, 'B'=partial
- sales_order_headers.overallOrdReltdBillgStatus: 'C'=fully billed, ''=not billed, 'A'=not billed
- billing_document_headers.billingDocumentIsCancelled: 1=cancelled, 0=active
`.trim();

const EXAMPLE_QUERIES = `
EXAMPLE QUERIES — study these patterns carefully:

Q: Which customers have placed the most orders?
SQL:
SELECT bp.businessPartnerFullName, COUNT(soh.salesOrder) AS orderCount, SUM(soh.totalNetAmount) AS totalValue, soh.transactionCurrency
FROM sales_order_headers soh
JOIN business_partners bp ON bp.businessPartner = soh.soldToParty
GROUP BY soh.soldToParty, soh.transactionCurrency
ORDER BY orderCount DESC
LIMIT 10;

Q: Which products appear most in billing documents?
SQL:
SELECT pd.productDescription, bdi.material, COUNT(DISTINCT bdi.billingDocument) AS billingCount
FROM billing_document_items bdi
LEFT JOIN product_descriptions pd ON pd.product = bdi.material AND pd.language = 'EN'
WHERE bdi.material IS NOT NULL AND bdi.material != ''
GROUP BY bdi.material
ORDER BY billingCount DESC
LIMIT 10;

Q: Trace the full O2C flow for billing document 90504248
SQL:
SELECT
  bdh.billingDocument, bdh.billingDocumentDate, bdh.totalNetAmount, bdh.transactionCurrency,
  bp.businessPartnerFullName AS customer,
  bdi.referenceSdDocument AS deliveryDocument,
  odi.referenceSdDocument AS salesOrder,
  par.accountingDocument AS paymentDoc, par.clearingDate
FROM billing_document_headers bdh
LEFT JOIN business_partners bp ON bp.businessPartner = bdh.soldToParty
LEFT JOIN billing_document_items bdi ON bdi.billingDocument = bdh.billingDocument
LEFT JOIN outbound_delivery_items odi ON odi.deliveryDocument = bdi.referenceSdDocument
LEFT JOIN payments_ar par ON par.accountingDocument = bdh.accountingDocument
WHERE bdh.billingDocument = '90504248'
LIMIT 20;

Q: Find sales orders delivered but not yet billed
SQL:
SELECT soh.salesOrder, bp.businessPartnerFullName, soh.totalNetAmount, soh.transactionCurrency, soh.creationDate
FROM sales_order_headers soh
JOIN business_partners bp ON bp.businessPartner = soh.soldToParty
WHERE soh.overallDeliveryStatus = 'C'
  AND (soh.overallOrdReltdBillgStatus = '' OR soh.overallOrdReltdBillgStatus IS NULL OR soh.overallOrdReltdBillgStatus = 'A')
ORDER BY soh.totalNetAmount DESC
LIMIT 20;

Q: Which plants ship the most deliveries?
SQL:
SELECT pl.plantName, odi.plant, COUNT(DISTINCT odi.deliveryDocument) AS deliveryCount
FROM outbound_delivery_items odi
JOIN plants pl ON pl.plant = odi.plant
GROUP BY odi.plant
ORDER BY deliveryCount DESC
LIMIT 10;
`.trim();

// ─────────────────────────────────────────────────────────────────────────────
// Step 1 — Guardrail
// ─────────────────────────────────────────────────────────────────────────────

const GUARDRAIL_SYSTEM = `You are a strict topic classifier for an SAP Order-to-Cash data analytics system.

The system contains data about: customers, sales orders, products, plants, deliveries, billing documents, invoices, payments, and accounts receivable — all within an SAP Order-to-Cash (O2C) business process.

Classify the user question as exactly one of:
  SAP_O2C   — question is about SAP O2C data, business process, or any entity in the system
  OFF_TOPIC — question is completely unrelated to SAP Order-to-Cash data

Rules:
- Questions about customers, orders, products, deliveries, invoices, payments, billing, plants, amounts → SAP_O2C
- General knowledge, programming help, current events, personal topics, creative writing → OFF_TOPIC
- When in doubt → SAP_O2C

Respond with ONLY the single token: SAP_O2C or OFF_TOPIC — no other text, no punctuation, no explanation.`;

async function classifyQuestion(question) {
  const result = await chat(GUARDRAIL_SYSTEM, question, 5, 0);
  const clean  = result.toUpperCase().replace(/[^A-Z_]/g, '');
  return clean.includes('OFF_TOPIC') ? 'OFF_TOPIC' : 'SAP_O2C';
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 2 — SQL Generation
// ─────────────────────────────────────────────────────────────────────────────

const SQL_GEN_SYSTEM = `You are an expert SQLite query generator for an SAP Order-to-Cash analytics system.

${SCHEMA_DDL}

${JOIN_PATHS}

${EXAMPLE_QUERIES}

STRICT RULES — you MUST follow every rule:
1. Return ONLY a valid SQLite SELECT statement. No explanation, no markdown, no code fences (no backticks), no commentary before or after.
2. Never use INSERT, UPDATE, DELETE, DROP, CREATE, ALTER, ATTACH, or any non-SELECT keyword.
3. Always add LIMIT 100 unless the user asks for a specific number.
4. Always JOIN product_descriptions with language = 'EN' when showing product names.
5. Always JOIN business_partners for businessPartnerFullName when showing customer names.
6. Use DISTINCT where results might duplicate.
7. Column names are camelCase exactly as shown in the schema — never use snake_case.
8. For full O2C flow traces, use LEFT JOINs so partial flows are included.
9. Your ENTIRE response must be a single executable SQLite SELECT starting with the word SELECT.
10. Do NOT wrap anything in backticks or markdown code blocks.`;

async function generateSQL(question, conversationHistory) {
  const recentHistory = (conversationHistory || []).slice(-6);
  let sql = await chatWithHistory(SQL_GEN_SYSTEM, recentHistory, question, 1024);

  // Strip any accidental markdown fences
  sql = sql
    .replace(/^```sql\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  // If model added explanation before the SQL, extract just the SQL
  const selectIdx = sql.search(/\bSELECT\b/i);
  if (selectIdx > 0) {
    sql = sql.slice(selectIdx).trim();
  }

  return sql;
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 3 — Answer Generation
// ─────────────────────────────────────────────────────────────────────────────

const ANSWER_SYSTEM = `You are a helpful SAP Order-to-Cash data analyst.

You will receive the user's question, the SQL that was executed, and the result rows from the database.

Write a clear, concise, business-friendly answer grounded entirely in the data provided.

Rules:
- Only state facts directly supported by the result rows — do not invent anything.
- Format amounts with commas and currency (usually INR).
- Use a short bulleted list for multiple items, prose for a single fact.
- If the result set is empty, say so clearly and suggest what it might mean.
- Keep the answer under 200 words unless the data genuinely requires more.
- Do not describe the SQL or explain how you found the answer — focus purely on the business insight.`;

async function generateAnswer(question, sql, rows) {
  const dataPayload = JSON.stringify(rows.slice(0, 50), null, 2);
  const prompt = `Question: ${question}

SQL executed:
${sql}

Result rows (${rows.length} total, showing up to 50):
${dataPayload}`;

  return await chat(ANSWER_SYSTEM, prompt, 1024, 0.3);
}

// ─────────────────────────────────────────────────────────────────────────────
// Public pipeline
// ─────────────────────────────────────────────────────────────────────────────

const OFF_TOPIC_REPLY =
  'This system is designed to answer questions related to the SAP Order-to-Cash dataset only. ' +
  'Please ask questions about customers, sales orders, products, deliveries, billing documents, or payments.';

/**
 * runChatPipeline(question, conversationHistory, executeSql)
 * @returns {Promise<{ answer, sql, rowCount, isOffTopic }>}
 */
async function runChatPipeline(question, conversationHistory, executeSql) {
  // Step 1: Guardrail
  let classification;
  try {
    classification = await classifyQuestion(question);
  } catch (err) {
    console.error('[groq] Guardrail error:', err.message);
    classification = 'SAP_O2C'; // fail open
  }

  if (classification === 'OFF_TOPIC') {
    return { answer: OFF_TOPIC_REPLY, sql: null, rowCount: 0, isOffTopic: true };
  }

  // Step 2: Generate SQL
  let sql;
  try {
    sql = await generateSQL(question, conversationHistory);
  } catch (err) {
    console.error('[groq] SQL gen error:', err.message);
    throw new Error(`SQL generation failed: ${err.message}`);
  }

  if (!/^\s*SELECT/i.test(sql)) {
    throw new Error(`Generated SQL is not a SELECT statement. Got: ${sql.slice(0, 120)}`);
  }

  // Execute SQL
  let execResult;
  try {
    execResult = await executeSql(sql);
  } catch (err) {
    console.error('[groq] SQL exec error:', err.message);
    return {
      answer:     `The query could not be executed: ${err.message}\n\nGenerated SQL:\n${sql}`,
      sql,
      rowCount:   0,
      isOffTopic: false,
    };
  }

  const { rows, rowCount } = execResult;

  // Step 3: Generate answer
  let answer;
  try {
    answer = await generateAnswer(question, sql, rows);
  } catch (err) {
    console.error('[groq] Answer gen error:', err.message);
    answer = `Query returned ${rowCount} row(s):\n${JSON.stringify(rows.slice(0, 10), null, 2)}`;
  }

  return { answer, sql, rowCount, isOffTopic: false };
}

module.exports = { runChatPipeline };
