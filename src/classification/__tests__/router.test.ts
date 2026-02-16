/**
 * Tests for Subfolder Router
 *
 * Tests cover:
 * - Income docs route to 'person'
 * - Property docs route to 'subject_property'
 * - Down payment docs route to 'down_payment'
 * - Void cheque routes to 'root'
 * - 'other' routes to 'root'
 * - Residency docs route to 'person'
 * - getPersonSubfolderName builds correct name (first name only)
 * - getPersonSubfolderName with null name uses fallback
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
    it('income docs route to person subfolder', () => {
      const incomeTypes: DocumentType[] = ['t4', 'pay_stub', 'loe', 'noa', 't1', 'pension_letter'];

      for (const docType of incomeTypes) {
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

    it('residency docs route to person', () => {
      const residencyTypes: DocumentType[] = ['pr_card', 'passport', 'work_permit'];

      for (const docType of residencyTypes) {
        expect(routeToSubfolder(docType), `${docType} should route to person`).toBe('person');
      }
    });

    it('business docs route to person', () => {
      const bizTypes: DocumentType[] = ['t2', 'articles_of_incorporation', 'financial_statement'];

      for (const docType of bizTypes) {
        expect(routeToSubfolder(docType), `${docType} should route to person`).toBe('person');
      }
    });

    it('situation docs route to person', () => {
      const situationTypes: DocumentType[] = [
        'separation_agreement', 'divorce_decree', 'discharge_certificate',
      ];

      for (const docType of situationTypes) {
        expect(routeToSubfolder(docType), `${docType} should route to person`).toBe('person');
      }
    });

    it('tax docs route to person', () => {
      const taxTypes: DocumentType[] = ['t4a', 't5', 't4rif', 'cra_statement_of_account'];

      for (const docType of taxTypes) {
        expect(routeToSubfolder(docType), `${docType} should route to person`).toBe('person');
      }
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
    it('builds correct name from firstName (first name only per Drive conventions)', () => {
      expect(getPersonSubfolderName('Terry', 'Albrecht', 'Borrower 1')).toBe('Terry');
    });

    it('uses firstName even when lastName is null', () => {
      expect(getPersonSubfolderName('Kathy', null, 'Borrower 1')).toBe('Kathy');
    });

    it('uses fallback when firstName is null', () => {
      expect(getPersonSubfolderName(null, null, 'Borrower 1')).toBe('Borrower 1');
    });

    it('uses fallback when firstName is empty string', () => {
      expect(getPersonSubfolderName('', 'Smith', 'Borrower 1')).toBe('Borrower 1');
    });

    it('trims whitespace from firstName', () => {
      expect(getPersonSubfolderName('  Susan  ', 'Hunter', 'Fallback')).toBe('Susan');
    });
  });
});
