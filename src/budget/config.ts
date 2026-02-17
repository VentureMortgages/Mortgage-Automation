/**
 * Budget Sheet Configuration
 *
 * Centralizes all environment variable access for the budget sheet automation.
 * Follows the same pattern as src/classification/config.ts.
 *
 * Environment variables:
 * - BUDGET_TEMPLATE_ID: Google Sheets ID of the master budget template
 * - BUDGET_SHEET_ENABLED: Kill switch (default: true)
 */

import 'dotenv/config';

export interface BudgetConfig {
  /** Google Sheets ID of the master budget template */
  templateId: string;
  /** Whether budget sheet creation is enabled (kill switch) */
  enabled: boolean;
  /** Default values from Taylor's historical patterns */
  defaults: {
    amortization: number;
    insurance: number;
    utilities: number;
    equityToRemain: number;
  };
}

export const budgetConfig: BudgetConfig = {
  templateId:
    process.env.BUDGET_TEMPLATE_ID ??
    '1BlqpDhYHuKY0Cgz7GnDzpcTNvMUWyrzpS24A6njzqwo',
  enabled: process.env.BUDGET_SHEET_ENABLED !== 'false',
  defaults: {
    amortization: 30,
    insurance: 100,
    utilities: 200,
    equityToRemain: 0.2,
  },
};
