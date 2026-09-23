export type Role = "admin" | "staff" | "partner";
export type ContainerType = "cone" | "cup" | "none";
export type CheckStatus = "incomplete" | "matched" | "minor" | "major";
export type RemittanceStatus = "pending" | "submitted" | "verified" | "rejected";
export type PaymentMethod = "gcash" | "bank" | "cash" | "other";
export type LocationStatus = "pending" | "active" | "paused" | "terminated";
export type DiscrepancyCause = "waste" | "spillage" | "test_dispense" | "staff_error" | "unexplained" | "other";

export interface Profile {
  id: string;
  role: Role;
  full_name: string;
  location_id: string | null;
  is_active: boolean;
}

export interface Location {
  id: string;
  code: string;
  partner_name: string;
  store_name: string;
  address: string;
  contact_phone: string | null;
  contact_email: string | null;
  store_hours: string | null;
  responsible_person: string | null;
  partnership_start_date: string | null;
  status: LocationStatus;
  partner_share_pct: number;
  remit_gcash_name: string | null;
  remit_gcash_number: string | null;
  remit_bank_name: string | null;
  remit_bank_account_name: string | null;
  remit_bank_account_number: string | null;
  payout_method: PaymentMethod | null;
  payout_account_name: string | null;
  payout_account_number: string | null;
  payout_bank_name: string | null;
  tolerance_servings: number;
  major_threshold_servings: number;
  opening_count_date: string | null;
  opening_cones: number | null;
  opening_cups: number | null;
  installation_checklist: Record<string, boolean>;
  notes: string | null;
  activated_at: string | null;
}

export interface Product {
  id: string;
  location_id: string;
  name: string;
  price_centavos: number;
  servings_per_unit: number;
  container_type: ContainerType;
  is_active: boolean;
  sort_order: number;
}

export interface InventoryItem {
  id: string;
  name: string;
  unit: string;
  yield_servings: number;
  unit_cost_centavos: number;
  container_type: ContainerType;
  is_premix: boolean;
  default_reorder_point: number;
  is_active: boolean;
  sort_order: number;
}

export interface Machine {
  id: string;
  serial_number: string;
  model: string;
  purchase_value_centavos: number;
  location_id: string | null;
  status: "in_storage" | "active" | "retired";
  baseline_reading: number | null;
  baseline_photo_path: string | null;
  counter_max: number | null;
  installed_at: string | null;
  notes: string | null;
}

export interface DailyCheck {
  id: string;
  location_id: string;
  business_date: string;
  has_counter: boolean;
  has_count: boolean;
  has_sales: boolean;
  counter_delta: number | null;
  reported_servings: number | null;
  container_servings: number | null;
  cones_used: number | null;
  cups_used: number | null;
  expected_cones: number | null;
  expected_cups: number | null;
  diff_counter_sales: number | null;
  diff_counter_containers: number | null;
  diff_sales_containers: number | null;
  max_abs_diff: number | null;
  tolerance_servings: number;
  major_threshold_servings: number;
  status: CheckStatus;
  partner_explanation: string | null;
  resolution_cause: DiscrepancyCause | null;
  resolution_notes: string | null;
  resolved_at: string | null;
}

export interface Remittance {
  id: string;
  location_id: string;
  business_date: string;
  sales_report_id: string;
  amount_due_centavos: number;
  amount_sent_centavos: number | null;
  method: PaymentMethod | null;
  reference_no: string | null;
  receipt_path: string | null;
  status: RemittanceStatus;
  rejection_reason: string | null;
  attempts: number;
  submitted_at: string | null;
  verified_at: string | null;
  admin_note: string | null;
}

export interface DailyStatusRow {
  location_id: string;
  location_code: string;
  store_name: string;
  business_date: string;
  has_counter: boolean;
  has_count: boolean;
  has_sales: boolean;
  remittance_status: RemittanceStatus | null;
  amount_due_centavos: number | null;
  check_status: CheckStatus | null;
  check_resolved: boolean | null;
}

export interface StockRow {
  location_id: string;
  location_code: string;
  item_id: string;
  item_name: string;
  unit: string;
  container_type: ContainerType;
  is_premix: boolean;
  on_hand: number;
  reorder_point: number;
  par_level: number;
  stock_status: "ok" | "low" | "out";
  sort_order: number;
}

export const CAUSE_LABELS: Record<DiscrepancyCause, string> = {
  waste: "Waste",
  spillage: "Spillage",
  test_dispense: "Test dispense",
  staff_error: "Staff error (wrong entry)",
  unexplained: "Unexplained",
  other: "Other",
};

export const METHOD_LABELS: Record<PaymentMethod, string> = {
  gcash: "GCash",
  bank: "Bank transfer",
  cash: "Cash (hand-over)",
  other: "Other",
};

export const INSTALL_CHECKLIST: { key: string; label: string }[] = [
  { key: "machine_installed", label: "Machine installed and plugged in safely" },
  { key: "machine_tested", label: "Test run done, product quality OK" },
  { key: "staff_trained", label: "Store staff trained (dispensing, cleaning, daily app flow)" },
  { key: "signage", label: "Menu board / price signage placed" },
  { key: "cleaning_kit", label: "Cleaning kit and sanitizer left at store" },
  { key: "app_login_tested", label: "Partner logged in on their phone and tested the app" },
];
