/**
 * Tests for Subfolder Router
 *
 * Tests cover:
 * - ID docs route to 'person_id'
 * - Income docs route to 'person_income'
 * - Tax docs route to 'person_tax'
 * - Business/situation docs route to 'person' (borrower root)
 * - Property docs route to 'subject_property'
 * - Down payment docs route to 'down_payment'
 * - Void cheque routes to 'root'
 * - 'other' routes to 'root'
 * - getPersonSubfolderName builds "LastName, FirstName" format
 */

import { describe, it, expect } from 'vitest';
import { routeToSubfolder, getPersonSubfolderName } from '../router.js';
import type { DocumentType } from '../types.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Subfolder Router', () => {

  // -------------------------------------------------------------------------
  // routeToSubfolder
  // -------------------------------------------------------------------------

  describe('routeToSubfolder', () => {
    it('ID docs route to person_id', () => {
      const idTypes: DocumentType[] = ['photo_id', 'second_id', 'pr_card', 'passport', 'work_permit'];

      for (const docType of idTypes) {
        expect(routeToSubfolder(docType), `${docType} should route to person_id`).toBe('person_id');
      }
    });

    it('income docs route to person_income', () => {
      const incomeTypes: DocumentType[] = ['pay_stub', 'loe', 'employment_contract', 'commission_statement', 'pension_letter'];

      for (const docType of incomeTypes) {
        expect(routeToSubfolder(docType), `${docType} should route to person_income`).toBe('person_income');
      }
    });

    it('tax docs route to person_tax', () => {
      const taxTypes: DocumentType[] = ['t4', 't4a', 't1', 't5', 'noa', 't4rif', 't2', 'cra_statement_of_account'];

      for (const docType of taxTypes) {
        expect(routeToSubfolder(docType), `${docType} should route to person_tax`).toBe('person_tax');
      }
    });

    it('business docs route to person (borrower root)', () => {
      const bizTypes: DocumentType[] = ['articles_of_incorporation', 'financial_statement'];

      for (const docType of bizTypes) {
        expect(routeToSubfolder(docType), `${docType} should route to person`).toBe('person');
      }
    });

    it('situation docs route to person (borrower root)', () => {
      const situationTypes: DocumentType[] = [
        'separation_agreement', 'divorce_decree', 'discharge_certificate',
      ];

      for (const docType of situationTypes) {
        expect(routeToSubfolder(docType), `${docType} should route to person`).toBe('person');
      }
    });

    it('property docs route to subject_property', () => {
      const propertyTypes: DocumentType[] = [
        'purchase_agreement', 'mls_listing', 'property_tax_bill', 'home_insurance',
      ];

      for (const docType of propertyTypes) {
        expect(routeToSubfolder(docType), `${docType} should route to subject_property`).toBe('subject_property');
      }
    });

    it('down payment docs route to down_payment', () => {
      const dpTypes: DocumentType[] = ['bank_statement', 'rrsp_statement', 'gift_letter'];

      for (const docType of dpTypes) {
        expect(routeToSubfolder(docType), `${docType} should route to down_payment`).toBe('down_payment');
      }
    });

    it('void cheque routes to root', () => {
      expect(routeToSubfolder('void_cheque')).toBe('root');
    });

    it('other routes to root', () => {
      expect(routeToSubfolder('other')).toBe('root');
    });

    it('non-subject property docs route correctly', () => {
      expect(routeToSubfolder('lease_agreement')).toBe('non_subject_property');
      expect(routeToSubfolder('mortgage_statement')).toBe('non_subject_property');
    });

    it('additional down payment types route correctly', () => {
      expect(routeToSubfolder('tfsa_statement')).toBe('down_payment');
      expect(routeToSubfolder('fhsa_statement')).toBe('down_payment');
    });
  });

  // -------------------------------------------------------------------------
  // getPersonSubfolderName
  // -------------------------------------------------------------------------

  describe('getPersonSubfolderName', () => {
    it('builds "LastName, FirstName" format', () => {
      expect(getPersonSubfolderName('Terry', 'Albrecht', 'Borrower')).toBe('Albrecht, Terry');
    });

    it('uses firstName only when lastName is null', () => {
      expect(getPersonSubfolderName('Kathy', null, 'Borrower')).toBe('Kathy');
    });

    it('uses lastName only when firstName is null', () => {
      expect(getPersonSubfolderName(null, 'Smith', 'Borrower')).toBe('Smith');
    });

    it('uses fallback when both names are null', () => {
      expect(getPersonSubfolderName(null, null, 'Borrower')).toBe('Borrower');
    });

    it('uses lastName when firstName is empty string', () => {
      expect(getPersonSubfolderName('', 'Smith', 'Borrower')).toBe('Smith');
    });

    it('trims whitespace from both names', () => {
      expect(getPersonSubfolderName('  Susan  ', '  Hunter  ', 'Fallback')).toBe('Hunter, Susan');
    });
  });
});
