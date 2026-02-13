/**
 * Finmo API Type Definitions
 *
 * Derived from real Finmo API response sample (.planning/finmo_app_sample.json).
 * Only fields relevant to checklist generation are fully typed.
 * Enum-like string fields use union types with `| string` fallback for forward compatibility.
 *
 * SECURITY: sinNumber field is marked @sensitive — never log or include in output.
 */

// ---------------------------------------------------------------------------
// Top-level API response
// ---------------------------------------------------------------------------

/** Complete Finmo application API response */
export interface FinmoApplicationResponse {
  application: FinmoApplication;
  applicant: FinmoApplicant;
  borrowers: FinmoBorrower[];
  incomes: FinmoIncome[];
  properties: FinmoProperty[];
  assets: FinmoAsset[];
  liabilities: FinmoLiability[];
  addresses: FinmoAddress[];
  addressSituations: FinmoAddressSituation[];
  creditReports: unknown[];
  activities: unknown[];
  agents: unknown[];
  fees: unknown[];
  teamMembers: unknown[];
  users: unknown[];
  referralLink: unknown | null;
  idVerificationRequests: unknown[];
}

// ---------------------------------------------------------------------------
// Application
// ---------------------------------------------------------------------------

/** Top-level application record — determines deal type, goal, and property context */
export interface FinmoApplication {
  id: string;
  /** "purchase" | "refinance" — drives property-section doc requirements */
  goal: 'purchase' | 'refinance' | string;
  /** "owner_occupied" | "rental" etc. — determines if rental docs needed */
  use: 'owner_occupied' | 'rental' | string;
  /** "searching" | "found_property" — controls gift donor proof-of-funds timing */
  process: 'searching' | 'found_property' | string;
  /** ID of the subject property (if linked) */
  propertyId: string | null;
  /** Down payment amount in dollars */
  downPayment: number;
  /** Expected closing date (ISO string) */
  closingDate: string | null;
  status: string;
  purchasePrice: number;
  mortgageAmountRequested: number;
  /** Province code (e.g., "BC") for the subject property — used for provincial rules */
  subjectPropertyProvince: string | null;
  createdAt: string;
  updatedAt: string;
  /** Free-text comments from the applicant */
  comments: string | null;
  /** Lender submission status */
  lenderSubmitStatus: string | null;
  /** Application status: pre_qualified, live_deal, approved, etc. */
  applicationStatus: string | null;
  /** Mortgage classifications (e.g., "residential") */
  mortgageClassifications: string[];
  /** Product type (e.g., "type_a") */
  productType: string | null;
  /** Intended use of funds for refinance (e.g., "home_renovation", "equity_take_out") */
  intendedUseOfFunds: string[];
  /** First mortgage or not */
  mortgageInfoType: string | null;
  /** Whether e-sign has been completed */
  esignStatus: string | null;
  /** Credit consent status */
  creditConsentStatus: string | null;
}

// ---------------------------------------------------------------------------
// Applicant (top-level user who started the application)
// ---------------------------------------------------------------------------

/** The primary applicant — often the main borrower */
export interface FinmoApplicant {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
}

// ---------------------------------------------------------------------------
// Borrower
// ---------------------------------------------------------------------------

/** Individual borrower on the application — drives per-borrower doc rules */
export interface FinmoBorrower {
  id: string;
  applicationId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  workPhone: string | null;
  /** Whether this is a first-time home buyer — triggers FHSA/HBP doc rules */
  firstTime: boolean;
  /**
   * @sensitive Never log this field.
   * Social Insurance Number — required by Finmo but must never appear in logs or output.
   */
  sinNumber: string;
  /** Marital status — drives separation/divorce doc requirements */
  marital:
    | 'common_law'
    | 'married'
    | 'single'
    | 'divorced'
    | 'separated'
    | 'widowed'
    | string;
  birthDate: string | null;
  dependents: number;
  /** Whether this is the primary borrower on the application */
  isMainBorrower: boolean;
  /** Relationship to main borrower (null if this IS the main borrower) */
  relationshipToMainBorrower: string | null;
  /** IDs of this borrower's income entries */
  incomes: string[];
  /** IDs of this borrower's address situations */
  addressSituations: string[];
  /** IDs of this borrower's addresses */
  addresses: string[];
  /** IDs of this borrower's credit reports */
  creditReports: string[];
  /** KYC verification method */
  kycMethod: string | null;
  /** Whether KYC is completed */
  kycCompleted: boolean | null;
  /** Whether this is a business/legal entity (not a person) */
  isBusinessLegalEntity: boolean;
  /** Whether PEP-affiliated (politically exposed person) */
  pepAffiliated: boolean;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Income
// ---------------------------------------------------------------------------

/** Income entry for a borrower — primary driver of income-section doc rules */
export interface FinmoIncome {
  id: string;
  applicationId: string;
  /** ID of the borrower this income belongs to */
  borrowerId: string;
  /** Income source type — determines which income doc section applies */
  source: 'employed' | 'self_employed' | 'retired' | string;
  /** Annual or period income amount */
  income: number;
  /** How the income is expressed (e.g., "annually") */
  incomeFrequency: string;
  /** Pay type for employed — drives whether commission/bonus docs are needed */
  payType: 'salaried' | 'hourly' | 'commission' | string | null;
  /** Employer or business name */
  business: string;
  /** Job title */
  title: string;
  /** Employment start date (ISO) */
  startDate: string | null;
  /** Employment end date (ISO) — null means current/ongoing */
  endDate: string | null;
  /** Full-time, part-time, contract — contract triggers section 2 rules */
  jobType: 'full_time' | 'part_time' | 'contract' | string | null;
  /** Whether this income includes bonuses — triggers bonus doc requirements */
  bonuses: boolean;
  /** Self-employed pay types */
  selfPayType: unknown[] | null;
  /** Whether this income is currently active */
  active: boolean;
  /** Business type for self-employed */
  businessType: string | null;
  /** Industry sector code */
  industrySector: string | null;
  /** Occupation category */
  occupation: string | null;
  /** Business address fields (for employer verification) */
  businessLine1: string | null;
  businessLine2: string | null;
  businessCity: string | null;
  businessState: string | null;
  businessCountry: string | null;
  businessPostCode: string | null;
  businessPhone: string | null;
  businessEmail: string | null;
  /** Income for the period amount */
  incomePeriodAmount: number | null;
  /** Description / notes */
  description: string | null;
  /** Visibility setting */
  visibility: string | null;
}

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

/** Mortgage on a property */
export interface FinmoPropertyMortgage {
  id: string;
  propertyId: string;
  remainingAmount: number;
  lender: string;
  rate: number;
  payment: number;
  payoff: boolean;
  payoffType: string | null;
  paymentFrequency: string | null;
  type: string | null;
  term: string | null;
  renewal: string | null;
  originalMortgageAmount: number | null;
}

/** Property on the application — drives property-section and rental doc rules */
export interface FinmoProperty {
  id: string;
  applicationId: string;
  createdAt: string;
  /** Address ID (links to addresses array) */
  addressId: string | null;
  /** Whether this property is being sold */
  isSelling: boolean;
  /** Sale proceeds to be used as down payment */
  saleDownpaymentAmount: number | null;
  /** Current market value / appraisal */
  worth: number | null;
  /** Annual property taxes */
  annualTaxes: number | null;
  /** Monthly condo/strata fees */
  monthlyFees: number | null;
  /** Monthly fees offset */
  monthlyFeesOffset: number | null;
  /** Property use — rental triggers rental income docs */
  use: string;
  /** Whether there is an existing mortgage on this property */
  mortgaged: boolean | null;
  /** Monthly rental income from this property */
  rentalIncome: number;
  /** Property type — "condo" triggers condo-specific docs */
  type: 'detached' | 'condo' | 'semi_detached' | 'townhouse' | string | null;
  /** Tenure — "leasehold" may trigger additional requirements */
  tenure: 'freehold' | 'leasehold' | string | null;
  /** Number of units — 2+ triggers multi-unit docs */
  numberOfUnits: number | null;
  /** Purchase price if applicable */
  purchasePrice: number | null;
  /** Existing mortgages on this property */
  mortgages: FinmoPropertyMortgage[];
  /** Owner borrower IDs */
  owners: string[];
  /** Construction type */
  constructionType: string | null;
  /** Property style */
  style: string | null;
  /** Property age in years */
  age: number | null;
  /** Living space */
  livingSpace: number | null;
  /** Living space unit of measure */
  livingSpaceUnits: string | null;
  /** Lot size */
  lotSize: number | null;
  /** Lot size unit of measure */
  lotSizeUnits: string | null;
  /** Heating type */
  heat: string | null;
  /** Water source */
  waterInfo: string | null;
  /** Sewage type */
  sewageInfo: string | null;
  /** Tax year for annualTaxes */
  taxYear: number | null;
  /** Who pays taxes */
  paidBy: string | null;
  /** Monthly heating costs */
  monthlyHeatingCosts: number | null;
  /** Whether the property is an MLS listing */
  mlsListing: boolean;
  /** Appraised value */
  appraisedValue: number | null;
  /** Appraisal date */
  appraisalDate: string | null;
  /** Environmental hazard flag */
  environmentalHazard: boolean;
  /** Whether expenses should be included in TDS calculation */
  includeExpensesTdsCalculation: boolean;
}

// ---------------------------------------------------------------------------
// Asset
// ---------------------------------------------------------------------------

/** Asset owned by borrower(s) — drives down payment source doc rules */
export interface FinmoAsset {
  id: string;
  applicationId: string;
  /** Asset type — determines which down payment docs to request */
  type: 'cash_savings' | 'rrsp' | 'tfsa' | 'vehicle' | 'other' | string;
  /** Current value */
  value: number;
  /** Amount allocated to down payment */
  downPayment: number | null;
  /** Description (e.g., "TFSA", "2024 Chevy Colorado") */
  description: string;
  /** Borrower IDs who own this asset */
  owners: string[];
  /** Visibility setting */
  visibility: string | null;
}

// ---------------------------------------------------------------------------
// Liability
// ---------------------------------------------------------------------------

/** Liability / debt on the application — may trigger supporting doc requirements */
export interface FinmoLiability {
  id: string;
  /** Liability type — mortgage liabilities trigger mortgage statement requests */
  type:
    | 'mortgage'
    | 'unsecured_line_credit'
    | 'credit_card'
    | 'other'
    | string;
  /** Credit limit */
  creditLimit: number | null;
  /** Outstanding balance */
  balance: number;
  /** Monthly payment amount */
  monthlyPayment: number;
  /** Description (e.g., lender name) */
  description: string;
  /** Borrower IDs responsible for this liability */
  owners: string[];
  /** How this will be paid off (e.g., "from_proceeds") */
  payOffType: string | null;
  /** Maturity date */
  maturityDate: string | null;
  /** Whether imported from credit bureau */
  importedFromCreditBureau: boolean;
  /** Whether this is the credit bureau source record */
  isCreditBureauSource: boolean;
}

// ---------------------------------------------------------------------------
// Address & Address Situation (supporting types)
// ---------------------------------------------------------------------------

/** Physical address */
export interface FinmoAddress {
  id: string;
  unit: string | null;
  line1: string | null;
  line2: string | null;
  streetNumber: string | null;
  streetName: string | null;
  streetType: string | null;
  streetDirection: string | null;
  city: string;
  country: string;
  postCode: string;
  state: string;
  /** Set if this address is linked to a property */
  propertyId?: string;
  /** Set if this address is linked to a borrower */
  borrowerId?: string;
}

/** Address situation — how a borrower relates to an address (owner, renting, etc.) */
export interface FinmoAddressSituation {
  id: string;
  addressId: string;
  /** Living situation at this address */
  situation: 'owner' | 'renting' | 'other' | string;
  startDate: string | null;
  endDate: string | null;
  borrowerId: string;
}
