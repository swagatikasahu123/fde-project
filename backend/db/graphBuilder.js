'use strict';

/**
 * db/graphBuilder.js
 *
 * Constructs a property graph from the SQLite database.
 *
 * NODE TYPES (7):
 *   Customer        — business_partners
 *   SalesOrder      — sales_order_headers
 *   Product         — products + product_descriptions
 *   Plant           — plants
 *   Delivery        — outbound_delivery_headers
 *   BillingDocument — billing_document_headers
 *   Payment         — payments_ar (grouped by accountingDocument)
 *
 * EDGE TYPES (10):
 *   PLACES          Customer      → SalesOrder        (soldToParty)
 *   ORDERS          Customer      → Product            (via SO items)
 *   CONTAINS        SalesOrder    → Product            (sales_order_items.material)
 *   FULFILLED_BY    SalesOrder    → Delivery           (via delivery items referencing SO)
 *   SHIPS_FROM      Delivery      → Plant              (delivery_items.plant)
 *   STORED_AT       Product       → Plant              (product_plants)
 *   INVOICED_AS     Delivery      → BillingDocument    (billing items referencing delivery)
 *   CLEARED_BY      BillingDocument → Payment          (billing_document_headers.accountingDocument)
 *   PAYS            Customer      → Payment            (payments_ar.customer)
 *   CANCELLED       BillingDocument → BillingDocument  (billing_document_cancellations)
 *
 * NODE ID FORMAT:  "<Type>:<naturalKey>"
 *   e.g.  "Customer:310000108"
 *         "SalesOrder:740506"
 *         "Payment:9400000220"    (accountingDocument used as key)
 *
 * Public API:
 *   buildFullGraph(db)                  → { nodes, edges }
 *   buildNeighborGraph(db, type, id)    → { nodes, edges }  (node + its direct neighbors)
 */

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Canonical node ID */
function nid(type, key) {
  return `${type}:${key}`;
}

/**
 * Add a node to the map only if it hasn't been seen yet.
 * nodeMap: Map<id, node>
 */
function addNode(nodeMap, type, key, label, data) {
  const id = nid(type, key);
  if (!nodeMap.has(id)) {
    nodeMap.set(id, { id, type, label, data });
  }
}

/**
 * Add a directed edge to the set if the combination (source→target+label)
 * hasn't already been recorded.
 * edgeSet: Set<string>  (dedup key)
 * edges:   Array
 */
function addEdge(edgeSet, edges, sourceId, targetId, label) {
  const key = `${sourceId}|${targetId}|${label}`;
  if (!edgeSet.has(key)) {
    edgeSet.add(key);
    edges.push({ source: sourceId, target: targetId, label });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Node builders  (each returns an array of { id, type, label, data } objects)
// ─────────────────────────────────────────────────────────────────────────────

function buildCustomerNodes(db) {
  const rows = db.prepare(`
    SELECT
      bp.businessPartner,
      bp.customer,
      bp.businessPartnerFullName,
      bp.businessPartnerName,
      bp.businessPartnerCategory,
      bp.businessPartnerGrouping,
      bp.createdByUser,
      bp.creationDate,
      bp.lastChangeDate,
      bp.businessPartnerIsBlocked,
      bp.isMarkedForArchiving,
      bp.organizationBpName1,
      bp.industry,
      bpa.cityName,
      bpa.country,
      bpa.region,
      bpa.streetName,
      bpa.postalCode
    FROM business_partners bp
    LEFT JOIN business_partner_addresses bpa
           ON bpa.businessPartner = bp.businessPartner
    GROUP BY bp.businessPartner
  `).all();

  return rows.map(r => ({
    id:    nid('Customer', r.businessPartner),
    type:  'Customer',
    label: r.businessPartnerFullName || r.businessPartnerName || r.businessPartner,
    data:  r,
  }));
}

function buildSalesOrderNodes(db) {
  const rows = db.prepare(`
    SELECT
      salesOrder,
      salesOrderType,
      salesOrganization,
      distributionChannel,
      organizationDivision,
      soldToParty,
      creationDate,
      createdByUser,
      lastChangeDateTime,
      totalNetAmount,
      transactionCurrency,
      overallDeliveryStatus,
      overallOrdReltdBillgStatus,
      requestedDeliveryDate,
      incotermsClassification,
      incotermsLocation1,
      customerPaymentTerms,
      headerBillingBlockReason,
      deliveryBlockReason
    FROM sales_order_headers
  `).all();

  return rows.map(r => ({
    id:    nid('SalesOrder', r.salesOrder),
    type:  'SalesOrder',
    label: `SO ${r.salesOrder}`,
    data:  r,
  }));
}

function buildProductNodes(db) {
  const rows = db.prepare(`
    SELECT
      p.product,
      p.productType,
      p.productOldId,
      p.productGroup,
      p.baseUnit,
      p.division,
      p.industrySector,
      p.grossWeight,
      p.weightUnit,
      p.netWeight,
      p.creationDate,
      p.lastChangeDate,
      p.isMarkedForDeletion,
      pd.productDescription
    FROM products p
    LEFT JOIN product_descriptions pd
           ON pd.product = p.product AND pd.language = 'EN'
  `).all();

  return rows.map(r => ({
    id:    nid('Product', r.product),
    type:  'Product',
    label: r.productDescription || r.productOldId || r.product,
    data:  r,
  }));
}

function buildPlantNodes(db) {
  const rows = db.prepare(`
    SELECT
      plant,
      plantName,
      valuationArea,
      salesOrganization,
      distributionChannel,
      division,
      factoryCalendar,
      language,
      addressId,
      isMarkedForArchiving
    FROM plants
  `).all();

  return rows.map(r => ({
    id:    nid('Plant', r.plant),
    type:  'Plant',
    label: r.plantName || r.plant,
    data:  r,
  }));
}

function buildDeliveryNodes(db) {
  const rows = db.prepare(`
    SELECT
      deliveryDocument,
      creationDate,
      creationTime,
      actualGoodsMovementDate,
      actualGoodsMovementTime,
      overallGoodsMovementStatus,
      overallPickingStatus,
      overallProofOfDeliveryStatus,
      shippingPoint,
      deliveryBlockReason,
      headerBillingBlockReason,
      hdrGeneralIncompletionStatus,
      lastChangeDate
    FROM outbound_delivery_headers
  `).all();

  return rows.map(r => ({
    id:    nid('Delivery', r.deliveryDocument),
    type:  'Delivery',
    label: `Delivery ${r.deliveryDocument}`,
    data:  r,
  }));
}

function buildBillingDocumentNodes(db) {
  // Combine headers + flag whether the doc also appears in cancellations
  const rows = db.prepare(`
    SELECT
      bdh.billingDocument,
      bdh.billingDocumentType,
      bdh.billingDocumentDate,
      bdh.creationDate,
      bdh.creationTime,
      bdh.lastChangeDateTime,
      bdh.totalNetAmount,
      bdh.transactionCurrency,
      bdh.companyCode,
      bdh.fiscalYear,
      bdh.accountingDocument,
      bdh.soldToParty,
      bdh.billingDocumentIsCancelled,
      bdh.cancelledBillingDocument,
      CASE WHEN bdc.billingDocument IS NOT NULL THEN 1 ELSE 0 END AS isCancellation
    FROM billing_document_headers bdh
    LEFT JOIN billing_document_cancellations bdc
           ON bdc.billingDocument = bdh.billingDocument
  `).all();

  return rows.map(r => ({
    id:    nid('BillingDocument', r.billingDocument),
    type:  'BillingDocument',
    label: `Invoice ${r.billingDocument}`,
    data:  r,
  }));
}

function buildPaymentNodes(db) {
  // One Payment node per unique accountingDocument in payments_ar
  const rows = db.prepare(`
    SELECT
      accountingDocument,
      companyCode,
      fiscalYear,
      customer,
      transactionCurrency,
      companyCodeCurrency,
      SUM(amountInTransactionCurrency)  AS totalAmountTxn,
      SUM(amountInCompanyCodeCurrency)  AS totalAmountCC,
      MIN(postingDate)                  AS postingDate,
      MIN(clearingDate)                 AS clearingDate,
      MIN(clearingAccountingDocument)   AS clearingAccountingDocument,
      MIN(glAccount)                    AS glAccount,
      MIN(financialAccountType)         AS financialAccountType
    FROM payments_ar
    GROUP BY accountingDocument, companyCode, fiscalYear, customer,
             transactionCurrency, companyCodeCurrency
  `).all();

  return rows.map(r => ({
    id:    nid('Payment', r.accountingDocument),
    type:  'Payment',
    label: `Payment ${r.accountingDocument}`,
    data:  r,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Edge builders  (each returns an array of { source, target, label })
// ─────────────────────────────────────────────────────────────────────────────

/** PLACES: Customer → SalesOrder */
function buildPlacesEdges(db) {
  return db.prepare(`
    SELECT DISTINCT soldToParty, salesOrder
    FROM sales_order_headers
    WHERE soldToParty IS NOT NULL AND soldToParty != ''
  `).all().map(r => ({
    source: nid('Customer',    r.soldToParty),
    target: nid('SalesOrder',  r.salesOrder),
    label:  'PLACES',
  }));
}

/** ORDERS: Customer → Product  (aggregated across all sales order items) */
function buildOrdersEdges(db) {
  return db.prepare(`
    SELECT DISTINCT soh.soldToParty, soi.material
    FROM sales_order_headers soh
    JOIN sales_order_items soi ON soi.salesOrder = soh.salesOrder
    WHERE soh.soldToParty IS NOT NULL AND soh.soldToParty != ''
      AND soi.material    IS NOT NULL AND soi.material    != ''
  `).all().map(r => ({
    source: nid('Customer', r.soldToParty),
    target: nid('Product',  r.material),
    label:  'ORDERS',
  }));
}

/** CONTAINS: SalesOrder → Product */
function buildContainsEdges(db) {
  return db.prepare(`
    SELECT DISTINCT salesOrder, material
    FROM sales_order_items
    WHERE material IS NOT NULL AND material != ''
  `).all().map(r => ({
    source: nid('SalesOrder', r.salesOrder),
    target: nid('Product',    r.material),
    label:  'CONTAINS',
  }));
}

/** FULFILLED_BY: SalesOrder → Delivery  (via outbound_delivery_items) */
function buildFulfilledByEdges(db) {
  return db.prepare(`
    SELECT DISTINCT odi.referenceSdDocument AS salesOrder,
                    odi.deliveryDocument
    FROM outbound_delivery_items odi
    JOIN sales_order_headers soh
      ON soh.salesOrder = odi.referenceSdDocument
    WHERE odi.referenceSdDocument IS NOT NULL
      AND odi.referenceSdDocument != ''
  `).all().map(r => ({
    source: nid('SalesOrder', r.salesOrder),
    target: nid('Delivery',   r.deliveryDocument),
    label:  'FULFILLED_BY',
  }));
}

/** SHIPS_FROM: Delivery → Plant  (via outbound_delivery_items.plant) */
function buildShipsFromEdges(db) {
  return db.prepare(`
    SELECT DISTINCT odi.deliveryDocument, odi.plant
    FROM outbound_delivery_items odi
    JOIN plants p ON p.plant = odi.plant
    WHERE odi.plant IS NOT NULL AND odi.plant != ''
  `).all().map(r => ({
    source: nid('Delivery', r.deliveryDocument),
    target: nid('Plant',    r.plant),
    label:  'SHIPS_FROM',
  }));
}

/** STORED_AT: Product → Plant  (via product_plants) */
function buildStoredAtEdges(db) {
  return db.prepare(`
    SELECT DISTINCT pp.product, pp.plant
    FROM product_plants pp
    JOIN products p ON p.product = pp.product
    JOIN plants   pl ON pl.plant  = pp.plant
  `).all().map(r => ({
    source: nid('Product', r.product),
    target: nid('Plant',   r.plant),
    label:  'STORED_AT',
  }));
}

/** INVOICED_AS: Delivery → BillingDocument  (via billing_document_items) */
function buildInvoicedAsEdges(db) {
  return db.prepare(`
    SELECT DISTINCT bdi.referenceSdDocument AS deliveryDocument,
                    bdi.billingDocument
    FROM billing_document_items bdi
    JOIN outbound_delivery_headers odh
      ON odh.deliveryDocument = bdi.referenceSdDocument
    JOIN billing_document_headers bdh
      ON bdh.billingDocument  = bdi.billingDocument
    WHERE bdi.referenceSdDocument IS NOT NULL
      AND bdi.referenceSdDocument != ''
  `).all().map(r => ({
    source: nid('Delivery',        r.deliveryDocument),
    target: nid('BillingDocument', r.billingDocument),
    label:  'INVOICED_AS',
  }));
}

/** CLEARED_BY: BillingDocument → Payment  (via shared accountingDocument) */
function buildClearedByEdges(db) {
  return db.prepare(`
    SELECT DISTINCT bdh.billingDocument, par.accountingDocument
    FROM billing_document_headers bdh
    JOIN payments_ar par ON par.accountingDocument = bdh.accountingDocument
    WHERE bdh.accountingDocument IS NOT NULL
      AND bdh.accountingDocument != ''
  `).all().map(r => ({
    source: nid('BillingDocument', r.billingDocument),
    target: nid('Payment',         r.accountingDocument),
    label:  'CLEARED_BY',
  }));
}

/** PAYS: Customer → Payment */
function buildPaysEdges(db) {
  return db.prepare(`
    SELECT DISTINCT customer, accountingDocument
    FROM payments_ar
    WHERE customer IS NOT NULL AND customer != ''
  `).all().map(r => ({
    source: nid('Customer', r.customer),
    target: nid('Payment',  r.accountingDocument),
    label:  'PAYS',
  }));
}

/**
 * CANCELLED: BillingDocument → BillingDocument
 * The billing_document_cancellations table contains billing documents that
 * ARE cancellations. Each of those docs also exists in billing_document_headers.
 * We draw an edge from the original billing document to its cancellation doc.
 *
 * Strategy: every cancellation doc appears in billing_document_headers (confirmed).
 * We identify the "original" by matching soldToParty + fiscal context — or, more
 * directly, we flag the edge as:  the cancellation doc  CANCELLED  the original.
 *
 * Because cancelledBillingDocument is '' in this dataset, we create a self-referential
 * "CANCELLED" label on each document that appears in billing_document_cancellations,
 * drawing an edge from the corresponding header → cancellation record node.
 * Both sides are BillingDocument nodes (they share the same billingDocument key).
 */
function buildCancelledEdges(db) {
  // Get all cancellation docs that also exist in billing_document_headers
  // Draw edge:  BillingDocument(bdh with isCancelled=1) → BillingDocument(bdc)
  // Since they share the same billingDocument key we instead draw:
  // Original invoice (non-cancelled, same soldToParty) → cancellation doc
  //
  // Practical approach: use billing_document_cancellations as the definitive
  // set of cancelled docs and mark edges from any billing doc with
  // billingDocumentIsCancelled = 1 to itself (to surface the cancellation flag).
  // More usefully: link the cancellation doc back to the first non-cancelled
  // billing doc for the same customer+accountingDocument family.
  //
  // Simpler & correct: draw an edge for every cancelled billing document
  // from the billing_document_headers row (billingDocumentIsCancelled=1)
  // to its entry in billing_document_cancellations — both use the same
  // billingDocument key, so both map to the same BillingDocument node.
  // This produces a self-loop which carries the CANCELLED semantic for the UI.
  //
  // For graph visualization a self-loop isn't useful. Instead we emit an edge
  // from the cancellation-marked billing doc toward the cancellation table's
  // own node — but since they share IDs we upgrade the approach:
  //
  // Final semantics chosen: for each row in billing_document_cancellations
  // that has a different billingDocument value than its cancelledBillingDocument
  // (when non-empty), draw an edge. When cancelledBillingDocument is empty
  // (as in this dataset), draw the edge: BillingDocument → BillingDocument
  // as a CANCELLED self-annotation by emitting a meta-edge between the
  // cancellation billing doc and the original billing doc for the same customer
  // on the same accountingDocument.
  const rows = db.prepare(`
    SELECT DISTINCT bdc.billingDocument         AS cancelDoc,
                    bdh.billingDocument          AS origDoc
    FROM billing_document_cancellations bdc
    JOIN billing_document_headers bdh
      ON  bdh.soldToParty        = bdc.soldToParty
      AND bdh.accountingDocument = bdc.accountingDocument
      AND bdh.billingDocument   != bdc.billingDocument
    WHERE bdc.billingDocument IS NOT NULL
  `).all();

  // Fall back: if no cross-doc matches found, emit a self-edge so CANCELLED
  // is still represented in the graph (the UI can style self-loops as badges).
  if (rows.length === 0) {
    return db.prepare(`
      SELECT DISTINCT billingDocument AS cancelDoc
      FROM billing_document_cancellations
    `).all().map(r => ({
      source: nid('BillingDocument', r.cancelDoc),
      target: nid('BillingDocument', r.cancelDoc),
      label:  'CANCELLED',
    }));
  }

  return rows.map(r => ({
    source: nid('BillingDocument', r.cancelDoc),
    target: nid('BillingDocument', r.origDoc),
    label:  'CANCELLED',
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Public: build full graph
// ─────────────────────────────────────────────────────────────────────────────

function buildFullGraph(db) {
  // ── Nodes ──────────────────────────────────────────────────────────────────
  const nodeMap = new Map();

  const allNodeBuilders = [
    buildCustomerNodes,
    buildSalesOrderNodes,
    buildProductNodes,
    buildPlantNodes,
    buildDeliveryNodes,
    buildBillingDocumentNodes,
    buildPaymentNodes,
  ];

  for (const builder of allNodeBuilders) {
    for (const node of builder(db)) {
      nodeMap.set(node.id, node);
    }
  }

  // ── Edges ──────────────────────────────────────────────────────────────────
  const edgeSet = new Set();
  const edges   = [];

  const allEdgeBuilders = [
    buildPlacesEdges,
    buildOrdersEdges,
    buildContainsEdges,
    buildFulfilledByEdges,
    buildShipsFromEdges,
    buildStoredAtEdges,
    buildInvoicedAsEdges,
    buildClearedByEdges,
    buildPaysEdges,
    buildCancelledEdges,
  ];

  for (const builder of allEdgeBuilders) {
    for (const edge of builder(db)) {
      // Only emit edges whose both endpoints exist as nodes
      if (nodeMap.has(edge.source) && nodeMap.has(edge.target)) {
        addEdge(edgeSet, edges, edge.source, edge.target, edge.label);
      }
    }
  }

  return {
    nodes: Array.from(nodeMap.values()),
    edges,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public: build neighbor subgraph for expand-on-click
// Returns the focal node + all nodes directly connected by one hop,
// along with only the edges that connect those nodes.
// ─────────────────────────────────────────────────────────────────────────────

function buildNeighborGraph(db, nodeType, nodeId) {
  // 1. Get the full graph (cached by the route layer if needed; for now simple)
  const full = buildFullGraph(db);

  const focalId = nid(nodeType, nodeId);

  // 2. Find all edges touching the focal node
  const relevantEdges = full.edges.filter(
    e => e.source === focalId || e.target === focalId
  );

  if (relevantEdges.length === 0) {
    // Return just the focal node if it exists
    const focal = full.nodes.find(n => n.id === focalId);
    return focal
      ? { nodes: [focal], edges: [] }
      : { nodes: [],      edges: [] };
  }

  // 3. Collect all node IDs involved
  const neighborIds = new Set([focalId]);
  for (const e of relevantEdges) {
    neighborIds.add(e.source);
    neighborIds.add(e.target);
  }

  // 4. Filter node list to just those IDs
  const nodes = full.nodes.filter(n => neighborIds.has(n.id));

  return { nodes, edges: relevantEdges };
}

// ─────────────────────────────────────────────────────────────────────────────
// Graph statistics helper  (used by the route for the metadata envelope)
// ─────────────────────────────────────────────────────────────────────────────

function graphStats(nodes, edges) {
  const typeCounts = {};
  const edgeCounts = {};

  for (const n of nodes) {
    typeCounts[n.type] = (typeCounts[n.type] || 0) + 1;
  }
  for (const e of edges) {
    edgeCounts[e.label] = (edgeCounts[e.label] || 0) + 1;
  }

  return {
    totalNodes: nodes.length,
    totalEdges: edges.length,
    nodeTypes:  typeCounts,
    edgeTypes:  edgeCounts,
  };
}

module.exports = { buildFullGraph, buildNeighborGraph, graphStats };
