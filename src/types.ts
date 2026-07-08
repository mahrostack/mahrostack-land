export type UserRole = 'driver' | 'admin' | 'accountant' | 'keeper' | 'manager';

export interface User {
  _id: string;
  partyId?: string;
  username: string;
  email: string;
  fName: string;
  lName: string;
  phone: string;
  role: UserRole;
  roleCodes?: string[];
  permissionCodes?: string[];
  twoFactorEnabled: boolean;
  mustChangePassword?: boolean;
  twoFactorSecret?: string;
  profileImage?: string;
}

export interface ProductUnitRef {
  id: string;
  code?: string;
  name?: string;
  nameAr?: string;
  label?: string;
  symbol?: string | null;
}

export interface Product {
  _id: string;
  name: string;
  baseUnitId?: string;
  baseUnit?: ProductUnitRef;
  defaultQuantityUnitId?: string | null;
  defaultQuantityUnit?: ProductUnitRef;
  defaultPricingUnitId?: string | null;
  defaultPricingUnit?: ProductUnitRef;
}

export type PartyBalanceNature = 'DEBIT' | 'CREDIT' | 'ZERO';

export interface Partner {
  _id: string;
  name: string;
  phone?: string;
  status?: string;
  fullName?: string | null;
  firstName?: string | null;
  middleName?: string | null;
  lastName?: string | null;
  balance?: string | null;
  balanceNature?: PartyBalanceNature | null;
}

export interface TradeExpense {
  expenseTypeCode: string;
  expenseTypeName: string;
  amount: number;
  notes?: string;
}

export interface TradePayment {
  amount: number;
  method: 'cash' | 'transfer';
  date: string;
}

/** Labeled fixed deduction applied to the whole invoice (net approach). */
export interface TradeDiscount {
  /** Present only on persisted discounts read back from the API. */
  id?: string;
  label: string;
  amount: number;
  note?: string;
}

export interface TradeLineDraft {
  id: string;
  product: Product;
  quantity: number;
  unitPrice: number;
  /** Optional deduction per pricing unit. Defaults to 0. */
  discountPerUnit: number;
  quantityUnitId: string;
  pricingUnitId: string;
  quantityUnitLabel: string;
  pricingUnitLabel: string;
  /** pricingQuantity × discountPerUnit. */
  lineDiscountAmount: number;
  /** Net of the per-line discount. */
  lineTotal: number;
}

import type { DriverDayStatus, WorkDayKind } from './api/types';
import type { TradeSettlement } from './lib/trade-settlement';

export type { WorkDayKind };

export interface TradeData {
  tradeType: 'buy' | 'sell';
  partnerId: string;
  partnerName: string;
  productId: string;
  productName: string;
  quantity: number;
  unit: string;
  pricingUnitId?: string;
  pricePerUnit: number;
  /** Per-pricing-unit deduction on the (first) line. Defaults to 0. */
  discountPerUnit: number;
  /** pricingQuantity × discountPerUnit for the (first) line. */
  lineDiscountAmount: number;
  totalAmount: number;
  expenses: TradeExpense[];
  payments: TradePayment[];
  /** Invoice-level labeled discounts (net approach). */
  discounts: TradeDiscount[];
  /** Sum of invoice-level discounts. */
  invoiceDiscountAmount: number;
  settlement?: TradeSettlement;
}

export interface Workday {
  _id: string;
  /** @deprecated prefer ownerUserId */
  driverId: string;
  ownerUserId?: string;
  kind?: WorkDayKind;
  date: string;
  status: DriverDayStatus;
  statusLabel: string;
  isOpen: boolean;
  isMutable: boolean;
  openedAt: string;
  closedAt?: string;
  totalIncome: number;
  totalExpense: number;
  netCash: number;
  /** Day-level expected cash (operational balance). */
  operationalCash: number;
  /** Posted ledger custody balance (accounting balance). */
  accountingBalance?: number;
  warehouseId?: string;
  warehouseName?: string;
  vehicleId?: string;
  vehicleLabel?: string;
}

export interface Transaction {
  _id: string;
  workdayId: string;
  driverId: string;
  type: 'income' | 'expense' | 'trade';
  sourceType: string;
  sourceId?: string;
  typeLabel: string;
  amount: number;
  description: string;
  createdAt: string;
  attachments: Attachment[];
  isDeleted?: boolean;
  tradeData?: TradeData;
  partyId?: string;
  partyName?: string;
  expenseTypeCode?: string;
  expenseTypeName?: string;
  expenseMode?: 'operational' | 'payment';
  /** Peer driver transfer direction when sourceType is TRANSFER. */
  peerTransferDirection?: 'inbound' | 'outbound';
  /** Linked sale document when income is a customer collection receipt. */
  linkedSaleId?: string;
  /** Linked purchase document when expense is a supplier payment. */
  linkedPurchaseId?: string;
  /** Draft/posted status of the underlying treasury or trade document. */
  documentStatus?: string;
}

export interface Attachment {
  _id: string;
  filename: string;
  mimetype: string;
  size: number;
  uploadDate: string;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  twoFactorRequired?: boolean;
  challengeToken?: string;
}
