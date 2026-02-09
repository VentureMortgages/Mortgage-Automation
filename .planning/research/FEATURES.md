# Feature Landscape

**Domain:** Mortgage Document Collection Automation
**Researched:** 2026-02-09
**Confidence:** MEDIUM

## Table Stakes

Features users expect. Missing = product feels incomplete.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Personalized document checklist generation | Industry standard - Finmo, Lendesk, Floify all auto-generate based on application type | Medium | Must analyze borrower type (employed, self-employed, investor) and property type to determine required docs. Pre-approval vs full approval affects scope. |
| Secure document upload portal | Required for compliance and client trust - 86% of borrowers prefer online upload in 2026 | Low | Can use existing client portal/CRM functionality. Must have encryption in transit and at rest. |
| Real-time tracking/status dashboard | Borrowers and brokers expect to see what's received/missing at a glance | Medium | Interactive checklist showing received/pending/missing. Used by all major platforms. |
| Automated reminders for missing documents | Standard feature - clients forget, manual follow-up is too time-consuming | Low | Email/SMS reminders on schedule (e.g., 3 days, 7 days after initial request). Must be disableable per client. |
| Document classification by type | Manual sorting is too error-prone and time-consuming | High | OCR + AI to identify doc type (T4, pay stub, bank statement, etc.). 2026 baseline expectation per Gartner. |
| Centralized document storage | Documents scattered across email/Drive causes lost files and delays | Low | Single source of truth. Integration with existing storage (Google Drive in this case). |
| Role-based access controls | Compliance requirement - not everyone should see all client documents | Low | Broker, assistant, and potentially client roles with different permissions. |
| Audit trail / activity log | Regulatory requirement for mortgage industry | Low | Track who uploaded/accessed/modified what and when. |
| Document versioning | Clients re-upload corrected documents - need to track versions | Low | Avoid confusion about which version is current. |
| Mobile accessibility | Clients upload from phone - 65% of document uploads happen mobile-first in 2026 | Low | Responsive design or mobile-optimized portal. |

## Differentiators

Features that set product apart. Not expected, but valued.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Intelligent document validation | Catches errors before submission to lender - reduces back-and-forth by 34% per industry benchmarks | High | OCR extracts data, validates consistency across docs (income on pay stub vs T4), flags mismatches. Reduces errors from 10-15% to 2-3% per Deloitte. |
| Automatic file naming + organization | Saves Cat hours weekly - currently manual process | Medium | Apply naming convention automatically on classification. File to correct Drive subfolder based on doc type. |
| Cross-document validation | Catches inconsistencies early (e.g., address on DL vs bank statement) | High | Reduces lender conditions later. Competitive advantage - not standard in basic tools. |
| Context-aware follow-ups | Smarter than generic reminders - references specific missing docs | Medium | "Hi John, still need your recent pay stub to complete your pre-approval" vs "You have missing documents". |
| Multi-format document acceptance + auto-conversion | Clients send screenshots, Word docs, etc. - auto-convert to PDF | Medium | Cat currently does this manually. OCR works better on PDF anyway. |
| Batch document upload with auto-split | Client uploads one multi-page PDF - system splits by doc type | High | Advanced feature. Reduces client friction but complex to build. |
| Proactive "document health check" | System flags documents expiring soon (e.g., pay stub >30 days old) | Medium | Prevents last-minute scrambles. "Your pay stub is 25 days old - lenders prefer <30 days". |
| Integration with bank statement retrieval | One-click bank statement pull (e.g., Flinks, Plaid) | Medium | Already common in Canadian market (Finmo has this). Speeds up income verification dramatically. |
| Lender-specific checklist customization | Different lenders have different doc requirements | Medium | Taylor knows which lender = which docs. System could adapt checklist based on intended lender. |
| Document completeness score | Gamification - "Your application is 75% complete" | Low | Motivates clients to finish faster. Reduces chasing. |

## Anti-Features

Features to explicitly NOT build.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Fully automatic document submission to lenders | Too risky - mortgage submissions require broker review and judgment | Generate draft task in CRM for broker to review before sending. Human-in-the-loop by design. |
| Automatic approval/rejection based on docs | Broker's expertise is the value - automation can't replace underwriting judgment | Flag potential issues for broker review, don't make decisions. |
| Storing full PII in automation logs | Security and compliance risk - data breach exposure | Log metadata only (doc type, timestamp, user) not document contents. |
| One-size-fits-all checklist | Different scenarios need different docs - generic checklist annoys clients | Personalize based on borrower/property type. Allow manual override. |
| Rigid workflow enforcement | Every deal is different - forcing steps causes workarounds | Make steps suggestive, not mandatory. Broker can skip/reorder as needed. |
| Complex multi-page client portal | Clients want simple - upload docs and check status, that's it | Keep client-facing UI minimal. Complexity goes in broker admin interface. |
| Auto-deleting documents | Compliance requires retention - deleting anything is dangerous | Archive, don't delete. Let broker manually remove if absolutely needed. |
| Automatic email sending without draft review | Compliance and tone risk - client communications need review | Draft emails for Cat/Taylor to review and send. |

## Feature Dependencies

```
Document Classification (OCR/AI)
    └──requires──> Document Upload Portal

Document Validation
    └──requires──> Document Classification

Cross-Document Validation
    └──requires──> Document Validation
    └──requires──> Data Extraction from multiple docs

Automated File Naming
    └──requires──> Document Classification

Automated File Organization (to Drive)
    └──requires──> Automated File Naming
    └──requires──> Document Classification

Context-Aware Follow-ups
    └──requires──> Real-time Tracking
    └──requires──> Document Classification (to know what's missing)

Document Health Check
    └──requires──> Data Extraction (to get dates from docs)
    └──requires──> Document Classification

Lender-Specific Checklists
    └──enhances──> Personalized Checklist Generation

Document Completeness Score
    └──requires──> Real-time Tracking

Batch Upload with Auto-Split
    └──requires──> Document Classification (to know where to split)
```

### Dependency Notes

- **Document Classification is foundational:** Almost all advanced features require knowing what type of document you're dealing with. Must be Phase 1.
- **Real-time Tracking enables follow-ups:** Can't send smart reminders if you don't know what's missing. Tracking must come before automated follow-ups.
- **Data Extraction unlocks validation:** To validate documents, you need to extract data from them first (OCR). Validation is a layer on top of extraction.
- **File organization depends on classification:** Can't file to the right folder if you don't know what the document is.

## MVP Recommendation

### Launch With (v1)

- Personalized document checklist generation (from Finmo application)
- Secure document upload (email + Finmo ingestion)
- Document classification by type (OCR + rule-based AI)
- Automated file naming (consistent naming convention)
- Automated file organization (to Google Drive with proper folder structure)
- Real-time tracking dashboard (received/missing status in CRM)
- Basic automated reminders (scheduled email follow-ups, initially disabled/manual trigger)
- Centralized storage (Google Drive integration)
- Audit trail (who did what when)

**Rationale:** These features deliver immediate ROI by automating Cat's most time-consuming tasks (checklist creation, downloading/renaming/filing docs, tracking status). Classification is foundational for everything else.

### Add After Validation (v1.x)

- Document validation (extract data, check for obvious errors)
- Context-aware follow-ups (reference specific missing docs in reminders)
- Multi-format auto-conversion (screenshots/Word → PDF)
- Document completeness score (motivate clients to upload faster)
- Mobile optimization (if not already included in portal)
- Proactive document health check (flag expiring documents)

**Rationale:** These improve quality and reduce back-and-forth but aren't essential for basic automation. Add once core workflow is proven.

### Future Consideration (v2+)

- Cross-document validation (consistency checking across multiple docs)
- Batch upload with auto-split (one PDF → multiple classified docs)
- Bank statement retrieval integration (Flinks/Plaid)
- Lender-specific checklist customization (adapt to chosen lender)
- Advanced OCR data extraction (parse amounts, dates, names for pre-filling CRM)

**Rationale:** High complexity, high value, but not needed until scale increases or specific pain points emerge. Bank statement integration may be redundant if Finmo already offers it.

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Personalized checklist generation | HIGH | MEDIUM | P1 |
| Document classification | HIGH | HIGH | P1 |
| Automated file naming + organization | HIGH | MEDIUM | P1 |
| Real-time tracking dashboard | HIGH | LOW | P1 |
| Secure upload portal | HIGH | LOW | P1 |
| Basic automated reminders | MEDIUM | LOW | P1 |
| Centralized storage | HIGH | LOW | P1 |
| Audit trail | MEDIUM | LOW | P1 |
| Document versioning | MEDIUM | LOW | P1 |
| Document validation | HIGH | HIGH | P2 |
| Context-aware follow-ups | MEDIUM | MEDIUM | P2 |
| Multi-format auto-conversion | MEDIUM | MEDIUM | P2 |
| Document completeness score | LOW | LOW | P2 |
| Mobile optimization | MEDIUM | LOW | P2 |
| Document health check | MEDIUM | MEDIUM | P2 |
| Cross-document validation | MEDIUM | HIGH | P3 |
| Batch upload with auto-split | LOW | HIGH | P3 |
| Bank statement integration | MEDIUM | MEDIUM | P3 |
| Lender-specific customization | LOW | MEDIUM | P3 |
| Advanced data extraction | MEDIUM | HIGH | P3 |

**Priority key:**
- P1: Must have for launch - delivers core automation value
- P2: Should have - improves quality and user experience after core is proven
- P3: Nice to have - add when scale demands or specific use cases emerge

## Competitor Feature Analysis

| Feature | Finmo (Current) | Lendesk | Floify | Our Approach |
|---------|-----------------|---------|--------|--------------|
| Auto-generate checklist | Yes - analyzes application | Yes | Yes | Yes - parse Finmo webhook data to determine checklist |
| Document upload | Yes - client portal | Yes | Yes | Multi-channel: email monitoring + Finmo portal |
| Document classification | Unknown/Basic | Yes | Yes | AI/OCR + rules - critical differentiator for our automation |
| File organization | Manual (Cat downloads) | Integrated | Integrated | Automated - rename + file to Drive with zero manual work |
| Real-time tracking | Yes - in Finmo | Yes | Yes | Yes - sync to MyBrokerPro CRM as source of truth |
| Automated follow-ups | Yes | Yes | Yes | Yes - but initially disabled (human-in-loop) until proven |
| Document validation | Unknown | Likely basic | Basic | Medium-term: extract data, flag errors before lender submission |
| Integration with CRM | Limited (email notifications) | Native | Integrates | Deep - MyBrokerPro/GoHighLevel as command center |
| Bank statement retrieval | Yes (mentioned in research) | Yes | Unknown | Defer - Finmo may already handle this |
| Multi-format handling | Unknown | Likely | Likely | Auto-convert to PDF - Cat does this manually now |

**Key Insight:** Finmo handles client-facing portal well. Our automation focuses on the broker-side workflow (classification, filing, tracking in CRM) that Finmo doesn't solve. We're automating Cat's manual work, not replacing Finmo.

## Sources

**General Mortgage Automation:**
- [5 Best Document Automation Tools for Mortgage Brokers](https://www.usecollect.com/blog/5-best-document-automation-tools-for-mortgage-brokers)
- [Mortgage Process Automation: The Key to Success in 2026](https://www.abbyy.com/blog/ai-mortgage-process-automation/)
- [The Future of Mortgage Automation: How Intelligent Document Processing Is Transforming 2026](https://www.docvu.ai/the-future-of-mortgage-automation-how-intelligent-document-processing-is-transforming-2026/)

**Canadian Broker Tools:**
- [The Perfect Canadian Mortgage Broker Technology Stack](https://www.lendesk.com/blog/perfect-broker-tech-stack)
- [Canadian Mortgage Broker Tools](https://www.mortgagelogic.news/canadian-mortgage-broker-tools/)

**Document Classification & Validation:**
- [OCR & AI: Revolutionizing Mortgage Lending Efficiency](https://rapidio.com/revolutionizing-mortgage-lending-with-ai-ocr-technology/)
- [How To Classify Mortgage Documents Using OCR & AI](https://www.opsflowhq.com/newsletter-issues/how-to-classify-mortgage-documents-using-ocr-ai)
- [OCR Mortgage Underwriting Process: The Complete Guide](https://www.docsumo.com/blogs/ocr/mortgage-underwriting)

**Document Management Best Practices:**
- [Solving Mortgage Document Management Challenges](https://floify.com/blog/overcoming-common-mortgage-document-management-challenges)
- [A Guide To Mortgage Document Collection Best Practices](https://filerequestpro.com/articles/mortgage-document-collection-best-practices/)
- [Document Naming Conventions - Fannie Mae](https://singlefamily.fanniemae.com/job-aid/loan-quality-connect/topic/document_naming_conventions.htm)

**Client Portal Features:**
- [Client portal for mortgage websites: benefits + tutorial](https://clustdoc.com/blog/client-portal-mortgage-website/)
- [Online Mortgage Application 2026: Digital Process](https://mortgage-info.com/blog/online-mortgage-application-2026-digital-process)

**Automated Follow-ups:**
- [Simplify Mortgage Document Management with Floify](https://floify.com/blog/mortgage-brokers-use-secure-cloud-service-to-collect-and-process-mortgage-documentation-from-borrowers)
- [Automate Online Mortgage Application Follow-Ups with AI Calls](https://convin.ai/blog/how-can-ai-powered-calls-streamline-mortgage-application-follow-ups)

**Anti-Patterns:**
- [Is It Time to Upgrade Your Mortgage Document Management Process?](https://mortgage.metasource.com/mortgage-quality-control-blog/upgrade-document-management-process/)
- [How Mortgage Originators Can Avoid Hacks in Document Management](https://floify.com/blog/how-lenders-and-loan-originators-can-avoid-hacks-in-mortgage-document-management)

---
*Feature research for: Mortgage Document Collection Automation*
*Researched: 2026-02-09*
*Confidence: MEDIUM (WebSearch verified with multiple industry sources, no official API documentation reviewed)*
