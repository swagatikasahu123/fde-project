import { useEffect } from 'react';

const TYPE_COLORS = {
  Customer:        '#3b82f6',
  SalesOrder:      '#22c55e',
  Product:         '#f97316',
  Plant:           '#a16207',
  Delivery:        '#a855f7',
  BillingDocument: '#ef4444',
  Payment:         '#14b8a6',
};

const FIELD_LABELS = {
  businessPartner:         'Partner ID',
  businessPartnerFullName: 'Company Name',
  cityName:                'City',
  country:                 'Country',
  region:                  'Region',
  streetName:              'Street',
  postalCode:              'Postal Code',
  salesOrder:              'Sales Order',
  soldToParty:             'Sold To',
  totalNetAmount:          'Net Amount',
  transactionCurrency:     'Currency',
  creationDate:            'Created',
  overallDeliveryStatus:   'Delivery Status',
  overallOrdReltdBillgStatus: 'Billing Status',
  requestedDeliveryDate:   'Requested Delivery',
  product:                 'Product ID',
  productDescription:      'Description',
  productOldId:            'Old Product ID',
  productGroup:            'Product Group',
  baseUnit:                'Unit',
  grossWeight:             'Gross Weight',
  weightUnit:              'Weight Unit',
  plant:                   'Plant ID',
  plantName:               'Plant Name',
  salesOrganization:       'Sales Org',
  deliveryDocument:        'Delivery Doc',
  overallGoodsMovementStatus: 'Goods Movement',
  overallPickingStatus:    'Picking Status',
  actualGoodsMovementDate: 'Goods Movement Date',
  billingDocument:         'Billing Doc',
  billingDocumentDate:     'Billing Date',
  billingDocumentType:     'Doc Type',
  billingDocumentIsCancelled: 'Cancelled',
  accountingDocument:      'Accounting Doc',
  totalAmountTxn:          'Total Amount',
  postingDate:             'Posting Date',
  clearingDate:            'Clearing Date',
};

const SKIP_FIELDS = new Set([
  'businessPartnerName', 'businessPartnerCategory', 'businessPartnerGrouping',
  'correspondenceLanguage', 'createdByUser', 'firstName', 'lastName',
  'formOfAddress', 'isMarkedForArchiving', 'businessPartnerIsBlocked',
  'addressId', 'addressUuid', 'addressTimeZone', 'poBox', 'poBoxDeviatingCityName',
  'poBoxDeviatingCountry', 'poBoxDeviatingRegion', 'poBoxIsWithoutNumber',
  'poBoxLobbyName', 'poBoxPostalCode', 'taxJurisdiction', 'transportZone',
  'organizationBpName1', 'organizationBpName2', 'industry',
  'salesOrderType', 'distributionChannel', 'organizationDivision',
  'salesGroup', 'salesOffice', 'lastChangeDateTime', 'pricingDate',
  'headerBillingBlockReason', 'deliveryBlockReason', 'incotermsClassification',
  'incotermsLocation1', 'customerPaymentTerms', 'totalCreditCheckStatus',
  'overallSdDocReferenceStatus', 'salesOrderItemCategory', 'materialGroup',
  'productionPlant', 'storageLocation', 'salesDocumentRjcnReason',
  'itemBillingBlockReason', 'crossPlantStatus', 'crossPlantStatusValidityDate',
  'lastChangeDate', 'isMarkedForDeletion', 'productType', 'division',
  'industrySector', 'netWeight', 'hdrGeneralIncompletionStatus',
  'headerBillingBlockReason', 'deliveryBlockReason', 'overallProofOfDeliveryStatus',
  'shippingPoint', 'lastChangeDate', 'creationTime', 'companyCode',
  'fiscalYear', 'cancelledBillingDocument', 'isCancellation',
  'companyCodeCurrency', 'totalAmountCC', 'clearingAccountingDocument',
  'glAccount', 'financialAccountType', 'customer',
]);

function formatValue(key, val) {
  if (val === null || val === undefined || val === '') return '—';
  if (typeof val === 'boolean' || val === 0 || val === 1) {
    if (['billingDocumentIsCancelled'].includes(key)) return val ? 'Yes' : 'No';
  }
  if (typeof val === 'string' && val.match(/^\d{4}-\d{2}-\d{2}T/)) {
    return val.slice(0, 10);
  }
  if ((key === 'totalNetAmount' || key === 'totalAmountTxn' || key === 'totalAmountCC') && typeof val === 'number') {
    return val.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return String(val);
}

const DELIVERY_STATUS = { C: 'Complete', A: 'Not Started', B: 'Partial' };
const BILLING_STATUS  = { C: 'Billed', A: 'Not Billed', '': 'Not Billed' };

export default function NodeInspector({ node, onClose }) {
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  if (!node) return null;

  const color  = TYPE_COLORS[node.type] || '#6b7280';
  const data   = node.data || {};

  // Build visible rows: only show labelled fields, skip noise
  const rows = Object.entries(data)
    .filter(([k]) => !SKIP_FIELDS.has(k) && (FIELD_LABELS[k] || false))
    .map(([k, v]) => {
      let display = formatValue(k, v);
      if (k === 'overallDeliveryStatus') display = DELIVERY_STATUS[v] || v || '—';
      if (k === 'overallOrdReltdBillgStatus') display = BILLING_STATUS[v] ?? (v || '—');
      return [FIELD_LABELS[k], display];
    });

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.panel} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ ...styles.header, borderColor: color }}>
          <div style={{ ...styles.typePill, background: color + '22', color, borderColor: color + '55' }}>
            {node.type}
          </div>
          <span style={styles.label}>{node.label}</span>
          <button style={styles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
        </div>

        {/* ID row */}
        <div style={styles.idRow}>
          <span style={styles.idLabel}>ID</span>
          <span style={styles.idValue} className="mono">{node.id.split(':')[1]}</span>
        </div>

        {/* Metadata table */}
        {rows.length > 0 && (
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <tbody>
                {rows.map(([label, value]) => (
                  <tr key={label} style={styles.row}>
                    <td style={styles.tdLabel}>{label}</td>
                    <td style={styles.tdValue}>{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Hint */}
        <div style={styles.hint}>Double-click the node to expand its connections</div>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 1000,
    display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end',
    pointerEvents: 'none',
  },
  panel: {
    pointerEvents: 'all',
    width: 300,
    maxHeight: 'calc(100vh - 80px)',
    margin: '40px 16px 0 0',
    background: '#13161e',
    border: '1px solid #252a38',
    borderRadius: 12,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    boxShadow: '0 24px 60px rgba(0,0,0,0.6)',
    animation: 'slideIn 0.18s ease',
  },
  header: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '14px 16px',
    borderBottom: '1px solid',
    flexShrink: 0,
  },
  typePill: {
    fontSize: 11, fontWeight: 600, letterSpacing: '0.06em',
    padding: '2px 8px', borderRadius: 20, border: '1px solid',
    flexShrink: 0,
  },
  label: {
    flex: 1, fontSize: 13, fontWeight: 500, color: '#e8eaf0',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  closeBtn: {
    background: 'none', border: 'none', color: '#4d5670',
    cursor: 'pointer', fontSize: 14, padding: '2px 4px',
    flexShrink: 0, lineHeight: 1,
    transition: 'color 0.15s',
  },
  idRow: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '10px 16px', borderBottom: '1px solid #1a1e29',
    flexShrink: 0,
  },
  idLabel: { fontSize: 11, color: '#4d5670', fontWeight: 600, letterSpacing: '0.05em' },
  idValue: { fontSize: 12, color: '#8892aa' },
  tableWrap: { overflowY: 'auto', flex: 1 },
  table: { width: '100%', borderCollapse: 'collapse' },
  row: { borderBottom: '1px solid #1a1e29' },
  tdLabel: {
    padding: '8px 16px', fontSize: 11, color: '#4d5670',
    fontWeight: 500, whiteSpace: 'nowrap', verticalAlign: 'top',
    width: '40%',
  },
  tdValue: { padding: '8px 16px 8px 0', fontSize: 12, color: '#c8cfe0', verticalAlign: 'top' },
  hint: {
    padding: '10px 16px', fontSize: 11, color: '#4d5670',
    borderTop: '1px solid #1a1e29', flexShrink: 0,
    fontStyle: 'italic',
  },
};
