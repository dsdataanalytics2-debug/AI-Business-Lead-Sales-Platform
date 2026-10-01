# AI Business Lead & Sales Automation Platform

## Full Project Plan / Product Requirements Document (PRD)

**Working Name:** LeadMate  
**Integration:** StoreMate  
**Document Version:** 1.1  
**Purpose:** Internal lead generation, business intelligence, demo website generation, CRM, and sales automation platform.

---

## Change Log

### v1.1 (changes from v1.0)

- **Added Section 3A — Data Source Strategy** (source-by-source matrix, finalized in Phase 0, with a validation spike).
- **Added Section 3B — Bangladesh-First Requirements** (phone normalization, Bangla content, online-presence signals, BDT, bKash/Nagad as post-MVP).
- **StoreMate Demo returned to MVP as "Demo Lite"** (one generic template + `Generate Demo` button + StoreMate API + demo URL). Industry templates move to post-MVP.
- **Lead scoring is now campaign-wise via Scoring Profiles** (Website Acquisition, Website Redesign in MVP; Review Management and Automation later). A single global score is removed.
- **Added `SuppressionList`, `UsageLedger`, `ScoringProfile`, `ScoringRule`, `DataSourceConfig` entities.**
- **Added `PROPOSAL` CRM stage.**
- **Demo safety policy:** `DEMO — NOT OFFICIAL` label, `noindex,nofollow`, expiry, auto-disable, and delete policy.
- **Validation rewritten:** baseline-first measurement; numeric thresholds are set only after real baseline data. Added testable acceptance criteria.
- **Added Section 41A — Cost Model** (cost per 100 / 1,000 leads, cost per qualified lead).
- **Added Section 45A — AI-Assisted Development Workflow** (this PRD is the source of truth; implementation happens through small build specs).
- Updated phases, MVP scope, build order, API modules, UI pages, permissions, and compliance requirements to match.

---

## 1. Project Summary

LeadMate will be an AI-powered business lead generation and sales automation platform. The system will help the company discover business leads, collect publicly available or authorized business contact information, enrich and analyze each lead, identify sales opportunities, prioritize the best leads, generate demo websites through StoreMate, and manage the complete sales process from first discovery to paying customer.

The platform should not be limited to businesses without websites. Users should be able to collect different types of business leads using flexible filters such as location, business category, website status, contact availability, rating, review count, and other supported criteria.

### Bangladesh-First Principle

LeadMate is designed first for the Bangladesh market. Phone formats, Bangla-language content, Facebook/Instagram-centric online presence, BDT pricing, and local payment methods are first-class requirements, not later add-ons. See Section 3B.

### Core Flow

```text
Business Search
      ↓
Lead Collection
      ↓
Contact Enrichment
      ↓
Duplicate Detection
      ↓
Website / Online Presence Analysis
      ↓
AI Business Analysis
      ↓
Lead Scoring & Qualification
      ↓
Service Recommendation
      ↓
StoreMate Demo Website
      ↓
Sales CRM
      ↓
Follow-up
      ↓
Proposal / Meeting
      ↓
Customer Conversion
      ↓
StoreMate Live Website / Other Services
```

---

## 2. Main Business Objective

The main objective is to reduce the amount of manual research performed by the sales team.

Instead of a salesperson manually searching for businesses, checking websites, finding contact information, deciding what service to offer, preparing a demo, and remembering follow-ups, LeadMate should organize and automate as much of this workflow as practical while keeping important customer communication under human control.

### Main Principle

> AI finds and analyzes opportunities. The sales team builds relationships and closes sales.

---

## 3. Target Users

### 3.1 Super Admin
- Full platform control.
- User and role management.
- Data-source configuration.
- AI configuration.
- StoreMate integration settings.
- System-wide reports.

### 3.2 Admin / Sales Manager
- Create lead searches/campaigns.
- View and manage leads.
- Assign leads to salespeople.
- Monitor sales performance.
- View team reports.
- Configure scoring rules where permitted.

### 3.3 Sales Executive
- View assigned leads.
- View AI analysis and recommendations.
- Create StoreMate demos.
- Generate sales drafts and call scripts.
- Add notes and communication outcomes.
- Update CRM stages.
- Set follow-ups.

### 3.4 Viewer
- Read-only access to permitted dashboards, leads, and reports.

---

# 3A. Data Source Strategy (Phase 0 Deliverable)

The data source strategy must be **finalized in Phase 0**, before the collection pipeline is built. The product depends on which sources can legitimately be used, what may be stored, and what they cost.

> Current terms, quotas, pricing, and storage/caching limits must be verified from each provider's **official documentation at implementation time**. Nothing in this PRD should be treated as a final statement of any provider's terms.

## 3A.1 Source Categories

- Official places/business-data APIs
- Licensed or permitted business directories
- The business's own public website (contact/about pages)
- User-provided data (CSV/Excel import)
- Manual entry by staff
- Licensed/partner datasets
- Social platforms (Facebook/Instagram) only through authorized APIs, public links found on the business's official website, or manual user input

Scraping that violates a source's terms, login-based scraping, and circumvention of access controls are **not** permitted sources.

## 3A.2 Data Source Matrix

Every candidate source must have one row in the matrix before it can be used in production.

| Field | Meaning |
|---|---|
| Source name | Provider / directory / method |
| Role | Discovery, Enrichment, or Both |
| Access method | Official API, licensed, public page, manual, import |
| Fields available | What the source can return |
| Fields we may persist | What the terms allow us to store |
| Persistence / caching limit | e.g. IDs only, time-limited cache, unrestricted |
| Refresh policy | How often and how data is re-fetched or expired |
| Rate limits / quotas | Per second / day / month |
| Pricing / cost model | Cost per request or per 1,000 requests, free tier |
| Bangladesh coverage | **Measured** coverage by category and area (from the spike) |
| Terms URL | Link to official terms/policy |
| Terms verified | Date and person who verified |
| Status | `PENDING`, `APPROVED`, `RESTRICTED`, `REJECTED` |

## 3A.3 Rules

- A source may be used in production only when its status is `APPROVED`.
- Persist only fields the source's terms allow. If a provider permits storing only an identifier, store the identifier and re-fetch data when needed.
- Every stored field carries `sourceId`, `fetchedAt`, and (where the terms require) `expiresAt`.
- All sources are accessed through a common `DataSourceAdapter` interface so a source can be replaced or disabled without rewriting business logic.
- Each source has an admin kill-switch (`DataSourceConfig.isEnabled`).
- Terms must be re-verified on a schedule (suggested: every 6 months) and whenever a provider announces changes.
- Legal/compliance review of the final matrix is required before production use.

## 3A.4 Validation Spike

Before the matrix is finalized, run a small spike on each candidate source:

- At least 2 business categories and 2 areas.
- Roughly 50 leads per source/category/area where available.
- Measure: result count, field coverage (phone / website / email / address / rating), duplicate rate, error rate, latency, and actual cost.
- Record the results in a **Source Evaluation Report**.

## 3A.5 Phase 0 Exit Criteria

- Data Source Matrix completed for every candidate source.
- At least one source marked `APPROVED` for discovery.
- `DataSourceAdapter` interface defined.
- Source Evaluation Report completed with measured cost per request.

---

# 3B. Bangladesh-First Requirements

## 3B.1 Phone Number Normalization

- Accept common input forms, including spaces, dashes, parentheses, and Bangla digits (`০–৯`):
  - `01XXXXXXXXX`
  - `8801XXXXXXXXX`
  - `+8801XXXXXXXXX`
  - `+880 1XXX-XXXXXX`
- Store a canonical value in international format (`+8801XXXXXXXXX`) in `normalizedValue`.
- Display in local format (`01XXXXXXXXX`) by default.
- Equivalent forms such as `01712345678` and `+8801712345678` must be treated as the **same** number for duplicate detection and suppression.
- Store `phoneType`: `MOBILE`, `LANDLINE`, or `UNKNOWN`.
- Numbers that cannot be normalized are kept with status `INVALID_FORMAT` rather than silently dropped.
- Mobile-number validation rules must be checked against the current Bangladesh numbering plan at implementation time and kept in a single configurable module.
- The normalization module must have a fixture-based test suite covering all formats above, plus invalid inputs.

## 3B.2 Bangla Language Support

- Full UTF-8/Unicode support across database, API, search, import/export, and generated content.
- Normalize Bangla digits to ASCII digits when parsing phone numbers, ratings, and addresses.
- Support Bangla and English business names and area names. Maintain area aliases (e.g. `Mirpur` / `মিরপুর`) so searches match both.
- CSV/Excel import and export must preserve Bangla text correctly.
- `AIService` generation methods accept a `language` parameter: `bn`, `en`, or `bn-en` (mixed).
- Demo content must support Bangla, with Bangla-capable web fonts in templates.
- Bangla AI-generated content (drafts, scripts, demo copy) requires a **human review** step, and quality must be checked by a native speaker on the first campaigns.
- The first release UI may remain English; Bangla UI is a later option.

## 3B.3 Online Presence (Beyond Websites)

Many Bangladeshi businesses operate through Facebook pages or Instagram instead of a website. "No website" does **not** mean "no online presence".

- Each lead has an `onlinePresenceType`: `WEBSITE`, `FACEBOOK_ONLY`, `INSTAGRAM_ONLY`, `MARKETPLACE_ONLY`, `NONE_DETECTED`, or `UNKNOWN`.
- Facebook/Instagram signals (page exists, link found, activity indicators) are collected **only where authorized/permitted**: authorized APIs, links published on the business's official website, or manual input.
- No login-based scraping or terms-violating collection of social data.
- Because social data access may be limited, the Online Presence Analyzer must work with partial data and show `UNKNOWN` instead of guessing.

## 3B.4 Currency and Billing

- Default currency is **BDT**.
- Store monetary amounts as integer minor units plus a currency code.
- Pricing, proposals, and reports show BDT; provider costs may be in other currencies, with the exchange rate stored at the time of cost recording.
- Payment integration (bKash, Nagad, and other local methods) is **post-MVP**. Design payment as a provider-agnostic module so these can be added later. Provider APIs and merchant requirements must be verified from official documentation when integration begins.

## 3B.5 Time and Working Calendar

- Default timezone: `Asia/Dhaka`.
- Working days and working hours are configurable per organization (follow-up reminders and "calls due" respect them).
- Public/festival holidays can be configured so follow-up scheduling avoids them.

---

# 4. Core Modules

## 4.1 Universal Business Lead Finder

The system must allow users to search for different categories of business leads instead of supporting only one niche.

### Search Inputs

- Country
- City
- Area / neighborhood
- Business category
- Keywords
- Target number of leads
- Website status
  - Any
  - Has website
  - No website
- Phone required
- Publicly listed WhatsApp required
- Email required
- Rating range
- Minimum review count
- Additional supported filters

### Example

```text
Location: Mirpur, Dhaka
Business Type: Dental Clinic
Target: 500
Phone Required: Yes
Website: No Website
```

### Expected Output

For each available business:

- Business name
- Category
- Address
- Area / city / country
- Primary phone
- Other business phone numbers when available
- Publicly listed WhatsApp contact/status when available
- Email
- Website
- Business listing/source URL
- Rating
- Review count
- Opening hours when available
- Social/business links when available
- Source information
- Collection date/time

### Data Acquisition Rule

LeadMate should use permitted APIs, authorized integrations, user-provided data, public business websites, and other sources whose use is allowed for the intended workflow. A collector/scraper should be treated as a replaceable data-acquisition component rather than the foundation of the entire product. Approved sources, storage limits, refresh policy, and costs are governed by the Data Source Matrix in Section 3A.

---

## 4.2 Contact Enrichment Engine

Contact information is one of the highest-priority parts of the system.

A lead discovered from one source may contain incomplete data. LeadMate should attempt permitted enrichment from additional relevant business sources.

### Target Contact Fields

```text
Primary Phone
Secondary Phone(s)
WhatsApp
WhatsApp Verification Status
Business Email
Website
Facebook
Instagram
Other supported business contact links
```

### Example

Initial lead:

```text
ABC Restaurant
Phone: Not Found
Website: abcrestaurant.example
```

Enrichment process:

```text
Official Website
      ↓
Contact / About Pages
      ↓
Phone Found
Email Found
Public WhatsApp Link Found
Social Links Found
      ↓
Lead Updated
```

### Important Contact Rules

- A normal phone number must not automatically be labelled as a WhatsApp number.
- WhatsApp should have statuses such as:
  - `UNKNOWN`
  - `PUBLICLY_LISTED`
  - `AUTHORIZED/CONFIRMED` where applicable
- Save the source of important contact information.
- Normalize all Bangladesh phone numbers per Section 3B.1 (`01...` and `+8801...` are the same number).
- Check every contact value against the `SuppressionList` (Section 28A) at import, enrichment, and before any outreach action.
- Social links (Facebook/Instagram) are saved only when found through permitted sources (Section 3B.3).
- Store business/public or otherwise authorized contact information, not harvested private personal contact information.

---

## 4.3 Lead Deduplication

The same business may appear through multiple sources.

The system should detect likely duplicates using combinations of:

- Normalized phone number
- Domain / website
- Business name
- Address
- Source business ID
- Other reliable identifiers

Possible duplicates should be merged carefully while preserving source history.

---

## 4.4 Master Lead Database

Every business should have a central Lead Profile.

### Example Lead Profile

```text
ABC Dental Care

BUSINESS
Category: Dental Clinic
Location: Mirpur, Dhaka
Rating: 4.6
Reviews: 253

CONTACT
Primary Phone: 01XXXXXXXXX
WhatsApp: 01XXXXXXXXX
WhatsApp Status: Publicly Listed
Email: info@example.com
Website: Not Found
Facebook: ...
Instagram: ...

SOURCES
Business Source: ...
Phone Source: ...
WhatsApp Source: Official Website
Email Source: Official Website

ANALYSIS
Website: No Website
Website Acquisition Score: 91/100
Website Redesign Score: N/A
Online Presence Type: INSTAGRAM_ONLY
Recommended Service: Website Development

SALES
Owner: Sales Executive A
Stage: NEW
Next Follow-up: —
Demo URL: —
```

---

# 5. Website & Online Presence Analyzer

For leads with websites, the system should run supported automated checks.

### Checks

- Website reachable or not
- HTTPS
- Mobile usability indicators
- Performance indicators
- Broken links where practical
- Contact information visibility
- Clear CTA
- Contact form
- Booking/appointment functionality where relevant
- Public WhatsApp/contact button where relevant
- Basic technical/SEO indicators

### Example

```text
HTTPS:              PASS
Mobile:             PASS
Performance:        NEEDS ATTENTION
Contact CTA:        MISSING
Booking:            NOT DETECTED
```

The analyzer should distinguish detected facts from AI interpretation.

### Online Presence Check

For every lead, record `onlinePresenceType` (Section 3B.3). Facebook/Instagram signals are included only where authorized/permitted, and any signal that could not be verified is stored as `UNKNOWN` rather than guessed.

---

# 6. AI Business Analyzer

AI will receive structured evidence collected by the system and explain potential business opportunities.

### AI Responsibilities

- Summarize the lead.
- Explain observed online-presence weaknesses.
- Identify possible service opportunities.
- Explain why a service may be relevant.
- Generate concise notes for salespeople.

### AI Must Not

- Invent services offered by the target business.
- Invent owner information.
- Treat assumptions as verified facts.
- Claim a phone number is WhatsApp without supporting evidence.

### Example

```text
Observed:
- No website detected.
- Business has 250+ public reviews.
- Public business phone is available.

Potential Opportunity:
- Website Development
- Online Appointment Integration
- Local Online Presence Improvement
```

---

# 7. Lead Scoring Engine (Campaign-Wise Scoring Profiles)

A single global score (e.g. `91/100`) is not sufficient, because a good lead for a new website is not the same as a good lead for a redesign, review management, or automation. Scoring is therefore done through **Scoring Profiles**, and each campaign selects the profile(s) that apply.

Scoring remains **deterministic and configurable**. The LLM does not decide scores.

## 7.1 Scoring Profiles

MVP profiles:

- **Website Acquisition Score** — business has no website (or only social presence) and is a good candidate for a new website.
- **Website Redesign Score** — business has a website with detected problems.

Later profiles:

- **Review Management Score**
- **Automation Score** (chatbot, booking, WhatsApp automation)
- **Local Presence Score**

## 7.2 Configuration Model

```text
ScoringProfile
  id, name, version, isActive, serviceId, thresholds (High / Medium / Low)

ScoringRule
  profileId, signalKey, operator, thresholdValue, weight, isGate
```

- Weights, thresholds, and gates are stored in configuration, not in code. Adding a new profile must not require code changes beyond new signal definitions.
- A **gate** rule makes a lead ineligible for a profile (for example, Website Redesign requires `HAS_WEBSITE`; suppressed or invalid leads are excluded from all profiles).
- Each profile's maximum score is normalized to 100.

## 7.3 Signal Library (examples)

```text
NO_WEBSITE              WEBSITE_UNREACHABLE      NO_HTTPS
POOR_MOBILE             SLOW_PERFORMANCE         NO_CONTACT_CTA
NO_BOOKING              REACHABLE_PHONE          PUBLIC_WHATSAPP
EMAIL_AVAILABLE         SOCIAL_PRESENCE          BUSINESS_ACTIVE
RATING_AT_LEAST         REVIEWS_AT_LEAST         CATEGORY_FIT
```

## 7.4 Illustrative Starting Weights

These are **starting hypotheses only**. They must be calibrated using real conversion data (Section 36).

**Website Acquisition**

```text
No website                         +25
Reachable business phone           +15
Business appears active            +10
Rating >= configured threshold     +10
Review volume >= threshold         +10
Public WhatsApp or email available +10
Has social presence                +10
Category fit for offered service   +10
---------------------------------------
Maximum                            100
```

**Website Redesign** (gate: has website)

```text
HTTPS missing/failing              +15
Poor mobile usability              +20
Performance needs attention        +15
No contact CTA / contact form      +10
Contact info hard to find          +10
Reachable business phone/email     +15
Business appears active             +5
Review volume >= threshold         +10
---------------------------------------
Maximum                            100
```

## 7.5 Explainability and History

- Each score is stored per lead **per profile** with `profileId` and `profileVersion`.
- `LeadScoreEvent` records every rule that fired and the points it added, so the UI can show a breakdown and the breakdown always sums to the score.
- When a profile changes, leads can be re-scored; previous scores are retained as history.

## 7.6 Priority Categories

- High / Medium / Low priority are derived **per profile** from configurable thresholds.
- They are operational prioritization categories, not guarantees of conversion.

---

# 8. Service Recommendation Engine

The system should map detected evidence to services offered by the company.

### Examples

**No website detected**
- Website Development
- StoreMate Website

**Existing website with technical problems**
- Website Redesign
- Performance Optimization

**No online booking where relevant**
- Booking / Appointment System

**Relevant communication gap**
- AI Chatbot
- WhatsApp Automation

**Review-management opportunity**
- Review Management
- Local Presence Services

Service rules should be configurable so the company can add future products without rewriting the whole platform.

---

# 9. StoreMate Integration

StoreMate will be responsible for demo website creation and eventual website delivery.

**MVP scope: Demo Lite.** The first release includes one generic local-business template, a `Generate Demo` button on the Lead Detail page, the StoreMate API call, and storing the returned demo URL. Industry-specific templates, advanced editing, and richer content come after the MVP.

LeadMate will be responsible for lead discovery, analysis, sales intelligence, and CRM.

## 9.1 Generate Demo Flow

```text
Lead Profile
     ↓
Generate Demo
     ↓
Validate Business Data
     ↓
Generate Draft Content
     ↓
Select StoreMate Template
     ↓
Call StoreMate API
     ↓
StoreMate Creates Demo
     ↓
Demo URL Returned
     ↓
Save URL in Lead Profile
```

### Conceptual API

```http
POST /api/v1/demo-sites
```

Example request:

```json
{
  "businessName": "ABC Dental Care",
  "category": "Dental Clinic",
  "phone": "01XXXXXXXXX",
  "address": "Mirpur, Dhaka",
  "template": "dental",
  "content": {
    "headline": "...",
    "about": "..."
  }
}
```

Example response:

```json
{
  "demoId": "demo_xxx",
  "status": "READY",
  "demoUrl": "https://abc-dental.demo.example.com"
}
```

## 9.2 Demo Lite (MVP) Requirements

**In scope**

- One generic local-business template.
- `Generate Demo` button on the Lead Detail page.
- Simple draft-content review step: the salesperson can edit headline/about text before submission.
- StoreMate API call through a background job, with status tracking and retry.
- Demo URL, status, and expiry saved on the lead.

**Out of scope for MVP**

- Industry-specific templates.
- Advanced visual editor.
- Automatic demo sending to customers.

## 9.3 StoreMate API Contract (Finalized in Phase 0)

The MVP now depends on StoreMate, so the contract must be agreed before Phase 6 begins:

- Authentication method and credential handling.
- Request and response schema (including template ID and content fields).
- Error codes and retry rules.
- **Idempotency:** requests carry an `Idempotency-Key` (for example `leadId + contentHash`). A lead can have only one active demo at a time, enforced by a database constraint, so repeated clicks do not create multiple demos.
- Status values: `PENDING`, `READY`, `FAILED`, `ACTIVE`, `EXPIRED`, `DISABLED`, `DELETED`.
- Status delivery by webhook or polling.
- Rate limits and expected generation time.

## 9.4 Demo Content Rules

- Content uses **verified** business data only (name, category, address, phone, public hours).
- Only confirmed services appear; services are never invented.
- No fabricated reviews, testimonials, awards, or owner information.
- No logos or photos copied from the business without permission.
- AI-generated text is clearly treated as draft until reviewed by the salesperson.
- Demo contact forms are disabled. Call and WhatsApp buttons use only the business's own public contact details, and a WhatsApp button appears only when the status is publicly listed or confirmed.

## 9.5 Demo Safety and Lifecycle Policy

- Every demo page displays a visible **`DEMO — NOT OFFICIAL`** label/banner.
- Every demo page is served with `noindex,nofollow` (both the `<meta name="robots">` tag and the `X-Robots-Tag` header), and robots rules disallow crawling.
- Demo URLs use unguessable identifiers so they cannot be enumerated.
- **Expiry:** every demo has an `expiresAt` (default is configurable; suggested starting value 14 days).
- **Auto-disable:** when a demo expires, it is automatically disabled and shows an "expired" page.
- **Delete:** disabled demos are permanently deleted after a configurable retention period (suggested 30 days after expiry).
- A manager can extend, disable, or delete a demo manually at any time.
- A demo is disabled immediately if the lead is added to the `SuppressionList` or a takedown/opt-out request is received.
- When a lead converts to a customer, approved content moves into the customer's StoreMate site and the demo banner is removed from the live site only.
- Demo creation, extension, disabling, and deletion are recorded in the audit log.

---

# 10. StoreMate Template System

**MVP (Demo Lite):** one generic local-business template.

**Post-MVP industry templates can include:**

- Dental Clinic
- General Clinic
- Restaurant
- Salon
- Gym
- Real Estate
- Law Firm
- Local Shop
- Professional Services
- Generic Business

### Template Selection

```text
Business Category
      ↓
Template Mapping
      ↓
AI Draft Content
      ↓
StoreMate Site
```

Templates should be reusable. AI should primarily customize content and selected structured sections rather than generate an entirely new codebase for every lead.

---

# 11. Demo Content Generation

AI can prepare draft content using verified business information.

Possible sections:

- Hero title
- Short business introduction
- About section
- Confirmed services only
- Location
- Opening hours
- Contact CTA
- Call button
- WhatsApp button when a supported WhatsApp contact is available
- Map/location section

All generated content should be previewable/editable before it is presented as representing the target business.

---

# 12. Sales CRM

### Pipeline

```text
NEW
 ↓
ANALYZED
 ↓
CONTACTED
 ↓
REPLIED
 ↓
INTERESTED
 ↓
DEMO_SENT
 ↓
MEETING
 ↓
PROPOSAL
 ↓
WON
```

Additional outcomes:

```text
LOST
NO_RESPONSE
NOT_INTERESTED
INVALID_LEAD
```

Stages may be skipped when appropriate (for example, a customer may go from `INTERESTED` directly to `PROPOSAL`). Stage changes are recorded in `LeadActivity` and the audit log. A lead on the `SuppressionList` cannot be moved into any outreach stage.

### Lead CRM Information

- Assigned salesperson
- Current stage
- Priority
- Notes
- Contact attempts
- Last contact date
- Next follow-up
- Customer response summary
- Demo URL
- Recommended service
- Proposal status
- Won/lost reason

---

# 13. AI Sales Assistant

LeadMate should help the salesperson prepare communication rather than blindly mass-send AI messages.

### Actions

- Generate WhatsApp draft
- Generate email draft
- Generate call script
- Generate follow-up draft
- Generate proposal draft
- Summarize previous interaction
- Suggest next CRM action based on recorded facts/rules

### Example

```text
[ Generate WhatsApp Draft ]
[ Generate Email Draft ]
[ Generate Call Script ]
[ Generate Proposal ]
```

Initial releases should use human review/approval before outbound communication.

Drafts and scripts can be generated in Bangla, English, or mixed (`bn`, `en`, `bn-en`). Before any draft is shown as ready, the system checks the target contact against the `SuppressionList`.

---

# 14. Follow-up Management

The system should prevent valuable leads from being forgotten.

### Track

- First contact
- Last contact
- Demo sent date
- Next follow-up date
- Follow-up count
- Response status

### Sales Dashboard Example

```text
Today's Work

High-Priority Leads:  12
Calls Due:              8
Follow-ups Due:        17
Demo Sites Pending:     5
Replies Needing Action: 6
```

---

# 15. Lead Assignment

Managers should be able to assign leads manually or through configurable rules.

Example:

```text
500 New Leads

Sales A → 100
Sales B → 100
Sales C → 100
Sales D → 100
Sales E → 100
```

Possible future rules:

- Round robin
- Area-based
- Category-based
- Workload-based
- Campaign-based

---

# 16. Campaign System

Users should be able to save search criteria as campaigns.

### Examples

**Website Campaign**

```text
Location: Dhaka
Category: Restaurant
Phone: Required
Website: Missing
```

**Contactable Dental Leads**

```text
Location: Mirpur
Category: Dental Clinic
Phone: Required
Public WhatsApp: Preferred/Required
```

**Website Redesign Campaign**

```text
Website: Exists
Audit Issues: Detected
Phone/Email: Available
```

Campaigns make the lead engine reusable for different company services.

---

# 17. Search and Filters

Users should be able to combine filters such as:

- Country
- City
- Area
- Category
- Keyword
- Has phone
- Has public WhatsApp
- Has email
- Has website
- No website
- Rating range
- Review count
- Lead score range (per scoring profile)
- Scoring profile
- Online presence type
- Suppressed / not suppressed
- Priority
- Recommended service
- CRM stage
- Assigned salesperson
- Demo created/not created
- Contacted/not contacted
- Follow-up due
- Data source
- Created date

---

# 18. Import / Export

### Import

Support CSV/Excel import for existing company leads.

Imported leads should pass through:

```text
Import
 ↓
Validation
 ↓
Normalization
 ↓
Duplicate Check
 ↓
Optional Enrichment
 ↓
Master Lead Database
```

### Export

Authorized users should be able to export filtered lead/report data to CSV/Excel according to role and company policy.

---

# 19. Demo to Customer Conversion

When a customer accepts a StoreMate demo:

```text
Demo Lead
   ↓
Convert to Customer
   ↓
Create/Link StoreMate Customer
   ↓
Reuse Approved Demo Content
   ↓
Plan / Billing Workflow
   ↓
Custom Domain Workflow
   ↓
Live Website
```

The system should preserve the relationship between the original LeadMate lead and the StoreMate customer/site.

Billing uses BDT by default. bKash/Nagad and other local payment integrations are post-MVP (Section 3B.4); until then, payment status can be recorded manually.

---

# 20. Existing Customer Upsell / Recurring Services

After conversion, the platform may later support relevant recurring services:

- StoreMate subscription
- Website maintenance
- Review management
- Local online-presence reporting
- SEO services
- Booking systems
- AI chatbot
- WhatsApp automation
- Other company services

This allows LeadMate to support customer acquisition and later account growth.

---

# 21. Review Management — Future Module

With appropriate authorized integrations, the platform may:

- Retrieve supported customer reviews.
- Identify reviews needing attention.
- Generate response drafts.
- Allow staff approval.
- Publish through permitted APIs where supported.
- Track response activity.

Do not design this around unauthorized access to a customer's business account.

---

# 22. Competitor / Market Monitoring — Future Module

For customers who request it, the platform may monitor permitted public business signals such as:

- New relevant businesses in an area
- Public rating changes
- Review-volume changes
- Website changes that can be lawfully monitored
- Other configured public signals

The output should be factual monitoring/reporting rather than unsupported claims about competitors.

---

# 23. Dashboards

## 23.1 Management Dashboard

Example KPIs:

```text
Total Leads
Qualified Leads
New Leads
Contacted
Replies
Interested
Demos Created
Meetings
Won
Lost
Conversion Rate
```

### Funnel

```text
Leads
  ↓
Qualified
  ↓
Contacted
  ↓
Replied
  ↓
Interested
  ↓
Demo
  ↓
Customer
```

Reports should also support breakdown by:

- Campaign
- Location
- Category
- Salesperson
- Service
- Time period

## 23.2 Sales Dashboard

- Assigned leads
- New leads
- Priority leads
- Today's follow-ups
- Pending demos
- Recent replies
- Meetings
- Won/lost activity

---

# 24. Role-Based Access Control

Suggested roles:

```text
SUPER_ADMIN
ADMIN
SALES_MANAGER
SALES_EXECUTIVE
VIEWER
```

Permissions should be granular, for example:

- Search leads
- View leads
- Export leads
- Edit leads
- Assign leads
- Generate demos
- View all team leads
- Manage users
- Manage integrations
- View reports
- Change scoring rules / manage scoring profiles
- Manage data sources
- Manage suppression list
- View cost reports
- Extend / disable / delete demos

---

# 25. Notifications

Possible in-app notifications:

- Follow-up due
- New lead assigned
- Demo ready
- Demo generation failed
- Customer replied through an authorized integration
- Meeting due
- Lead requires review

Email/other notifications can be added later if required.

---

# 26. Audit Logs

Important actions should be recorded:

- Lead created/imported
- Lead edited
- Assignment changed
- CRM stage changed
- Demo generated
- Contact information changed
- Export performed
- User/role changes
- Integration changes

This is important for accountability and debugging.

---

# 27. Data Model — High-Level

Suggested entities:

```text
User
Role
Permission
Organization
Team

Lead
LeadContact
LeadSource
LeadSocialLink
LeadWebsiteAudit
LeadAnalysis
LeadScore            // one row per lead per scoring profile
LeadScoreEvent
ScoringProfile
ScoringRule

Campaign
SearchJob
CollectionJob
EnrichmentJob

Assignment
LeadNote
LeadActivity
FollowUp
Communication

Service
ServiceRecommendation

DemoSite
StoreMateCustomerLink

Proposal
Meeting

Notification
AuditLog

Integration
IntegrationCredentialReference
DataSourceConfig
SuppressionList
UsageLedger
```

Credentials/secrets must not be stored in plain text.

---

# 28. Suggested Lead Table

```text
Lead
---------------------------------
id
organizationId
businessName
normalizedName
category
address
area
city
country
latitude
longitude
rating
reviewCount
websiteUrl
websiteStatus
onlinePresenceType
priority
crmStage
assignedUserId
recommendedServiceId
createdAt
updatedAt
```

Contact information should preferably be normalized into a related table rather than adding unlimited columns to `Lead`.

### LeadContact

```text
id
leadId
type            // PHONE, WHATSAPP, EMAIL
value
normalizedValue
status
sourceId
isPrimary
verifiedAt
createdAt
updatedAt
```

`phoneType` (`MOBILE`, `LANDLINE`, `UNKNOWN`) and status values such as `INVALID_FORMAT` are stored on phone contacts. `normalizedValue` for Bangladesh numbers uses the canonical `+8801XXXXXXXXX` form (Section 3B.1).

---

# 28A. Additional Tables

## SuppressionList

```text
id
organizationId
type              // PHONE, WHATSAPP, EMAIL, DOMAIN, BUSINESS
normalizedValue
channelScope      // ALL, CALL, WHATSAPP, EMAIL
reason            // OPT_OUT, DO_NOT_CONTACT, COMPLAINT, INVALID, LEGAL, INTERNAL_POLICY
sourceNote
addedBy
addedAt
expiresAt         // nullable
```

Rules:

- Checked at import, enrichment, assignment, draft generation, demo generation, and before any outreach is logged as sent.
- Matching uses normalized values, so `01...` and `+8801...` match each other.
- A suppressed lead cannot receive drafts, demos, or outreach-stage CRM changes.
- Re-importing or re-collecting a suppressed contact must not reactivate it.
- Only authorized roles can add or remove entries; every change is audit-logged.

## UsageLedger

```text
id
organizationId
jobId
campaignId        // nullable
leadId            // nullable
provider
operation         // e.g. PLACES_SEARCH, AI_ANALYSIS, DEMO_CREATE
units
unitType          // requests, tokens_in, tokens_out, demos
costAmount
currency
exchangeRateToBDT
isEstimate
createdAt
```

Every billable or quota-limited external call writes a ledger row. This is what makes cost per lead and cost per qualified lead measurable (Section 41A).

## DataSourceConfig

```text
id
name
role              // DISCOVERY, ENRICHMENT, BOTH
status            // PENDING, APPROVED, RESTRICTED, REJECTED
isEnabled
termsUrl
termsVerifiedAt
termsVerifiedBy
persistencePolicy
refreshPolicy
rateLimitConfig
```

---

# 29. Background Job Architecture

Long-running operations should not block web requests.

```text
Next.js UI
    ↓
Backend API
    ↓
PostgreSQL
    ↓
Redis / BullMQ
    ↓
Workers
 ├─ Lead Collection Worker
 ├─ Contact Enrichment Worker
 ├─ Website Audit Worker
 ├─ AI Analysis Worker
 └─ StoreMate Demo Worker
```

Job statuses:

```text
QUEUED
RUNNING
COMPLETED
FAILED
RETRYING
CANCELLED
```

---

# 30. Recommended Technical Stack

## Frontend

- Next.js
- TypeScript
- Tailwind CSS
- Component library as appropriate
- React Query or equivalent server-state solution

## Backend

Recommended for this project:

- Node.js + TypeScript
- Express or a structured Node framework
- REST API initially

Alternative: FastAPI is also suitable if the team prefers Python for backend/data-processing work.

## Database

- PostgreSQL
- Prisma ORM if using Node.js

## Queue / Background Processing

- Redis
- BullMQ

## AI Layer

Create a provider-independent AI service abstraction so models/providers can be changed without rewriting business logic. All generation methods accept a `language` parameter (`bn`, `en`, `bn-en`), and every call records token usage in the `UsageLedger`.

```text
AIService
 ├─ analyzeLead()
 ├─ generateWebsiteDraft()
 ├─ generateSalesMessage()
 ├─ generateCallScript()
 ├─ generateFollowUp()
 └─ generateProposal()
```

## Website Generation

- StoreMate API

## Storage

- Existing company-supported object/file storage where required.

---

# 31. API Modules

Suggested backend modules:

```text
/auth
/users
/roles
/organizations
/leads
/lead-contacts
/campaigns
/search-jobs
/enrichment
/website-audits
/ai-analysis
/lead-scores
/services
/recommendations
/crm
/follow-ups
/communications
/demos
/storemate
/proposals
/reports
/notifications
/integrations
/data-sources
/suppression
/scoring-profiles
/usage-costs
/audit-logs
```

---

# 32. Main UI Pages

```text
/login
/dashboard

/leads
/leads/:id
/leads/import

/discover
/campaigns
/campaigns/:id

/follow-ups

/demos
/demos/:id

/pipeline

/reports

/team
/users

/settings
/settings/scoring
/settings/services
/settings/integrations
/settings/storemate
/settings/data-sources
/settings/suppression
/settings/costs
```

---

# 33. Lead Detail Page Layout

Suggested layout:

```text
-------------------------------------------------
ABC Dental Care             Scores: Acquisition 91 | Redesign N/A
Dental Clinic               Stage: Interested
-------------------------------------------------

[Business] [Contacts] [Analysis] [Website Audit]
[Demo] [Activity] [Notes] [Follow-ups]

CONTACT
Phone
WhatsApp
Email
Website

AI OPPORTUNITY
Website Development
Reason: No website detected

ACTIONS
[Generate Demo]
[WhatsApp Draft]
[Email Draft]
[Call Script]
[Proposal]

CRM
Assigned To
Stage
Next Follow-up
```

---

# 34. Development Phases

Each phase is implemented through its own small build spec (Section 45A). Numeric thresholds are set only after real baseline data exists (Section 36).

## Phase 0 — Foundation + Data Source Strategy

Build:

- Repository structure, environment configuration, database
- Authentication, RBAC
- Logging, error handling
- Queue infrastructure
- **Data Source Matrix and validation spike** (Section 3A)
- **StoreMate API contract** (Section 9.3)
- **Bangladesh phone normalization module with fixture tests** (Section 3B.1)
- Skeletons for `SuppressionList`, `UsageLedger`, and `DataSourceConfig`

**Exit condition:** Users can log in and roles/permissions work; Data Source Matrix is complete with at least one `APPROVED` discovery source; the StoreMate API contract is agreed; the Source Evaluation Report exists.

---

## Phase 1 — Lead Collection MVP

Build:

- Business discovery UI
- Approved data-source integration through `DataSourceAdapter`
- Search jobs and lead storage
- Contact fields with source and timestamp
- Duplicate detection
- Lead table, search/filter
- CSV import/export
- Usage ledger entries for every paid call

**Exit condition:** A user can run a business search and save leads. A **Baseline Report** is produced for the pilot campaigns (phone rate, WhatsApp rate, website rate, duplicate rate, cost per 100 leads). The Baseline Report is the input for setting numeric targets in later phases.

---

## Phase 2 — Contact Enrichment

Build:

- Enrichment jobs
- Official-website contact extraction where permitted
- Phone/email normalization
- Public WhatsApp-link detection
- Authorized social-link detection (Section 3B.3)
- Contact source tracking and quality/status

**Exit condition:** Leads can be enriched, and every important contact shows status, source, and timestamp. Enrichment success rate is measured and added to the Baseline Report.

---

## Phase 3 — Website & Online Presence Analyzer

Build:

- Website status checker and basic audit
- `onlinePresenceType` detection
- Structured audit results, background workers

**Exit condition:** Existing websites receive repeatable, evidence-based audit results; unverifiable signals are stored as `UNKNOWN`.

---

## Phase 4 — Scoring Profiles + AI Analysis

Build:

- `ScoringProfile` / `ScoringRule` configuration
- Website Acquisition and Website Redesign profiles
- Score history and breakdown (`LeadScoreEvent`)
- AI lead summary, opportunity detection, service recommendation

**Exit condition:** Each lead shows a per-profile score whose breakdown sums to the total; salespeople can see why an opportunity was suggested.

---

## Phase 5 — CRM

Build:

- CRM stages including `PROPOSAL`
- Assignment, notes, activities, follow-ups
- Pipeline view, sales dashboard
- `SuppressionList` enforcement across all outreach actions

**Exit condition:** Salespeople can manage leads from new to won/lost without another spreadsheet, and suppressed contacts are blocked from outreach actions.

---

## Phase 6 — StoreMate Demo Lite

Build:

- StoreMate API integration per the agreed contract
- One generic template, `Generate Demo` button
- Draft-content review step
- Demo job queue, status, URL, expiry
- Demo safety policy (Section 9.5): label, `noindex,nofollow`, expiry, auto-disable, delete

**Exit condition:** A qualified lead can generate a demo from the Lead Detail page; repeated clicks create only one active demo; demo safety rules are verified by automated tests.

---

## Phase 7 — AI Sales Assistant

Build:

- WhatsApp draft, email draft, call script, follow-up draft, proposal draft
- Bangla / English / mixed generation with human review
- Interaction summary

**Exit condition:** Salespeople can generate contextual drafts from actual lead information; drafts for suppressed contacts are blocked.

---

## Phase 8 — Analytics, Cost & Management

Build:

- Funnel, campaign, salesperson, service, and location/category reports
- Cost reports from `UsageLedger` (Section 41A)
- Exportable reports

**Exit condition:** Management can see where leads originate, how they progress, and what each campaign cost per lead and per qualified lead.

---

## Phase 9 — Post-MVP Expansion

- Industry-specific StoreMate templates
- bKash/Nagad and other local payment integrations
- Additional scoring profiles (Review Management, Automation, Local Presence)
- Bangla UI
- Review management and monitoring modules (Sections 21–22)

---

## Phase 10 — SaaS / Multi-Tenant Expansion (Optional)

Build later only if the product will be sold to other agencies: organization isolation, plans, usage limits, credits, billing, white label, agency teams, custom branding.

Do not make this a requirement for the first internal MVP unless there is an immediate business need.

---

# 35. Recommended MVP Scope

The first release should prove one complete workflow, from lead discovery to a demo link in the hands of a salesperson.

### MVP Must Have

- Authentication, RBAC
- Data Source Matrix and approved data source
- Business search and lead collection
- Business contact storage with source tracking
- Bangladesh phone normalization
- Contact enrichment
- Duplicate detection
- Lead filters
- Website status and basic website audit, plus online presence type
- Scoring Profiles: Website Acquisition and Website Redesign
- AI analysis and service recommendation
- CRM pipeline (including `PROPOSAL`), lead assignment, notes, follow-ups
- `SuppressionList`
- CSV import/export
- **StoreMate Demo Lite** (one generic template, `Generate Demo`, demo URL, demo safety policy)
- Usage ledger and basic cost report

### MVP+ / Next Release

- Industry-specific StoreMate templates
- AI sales drafts (Bangla/English), proposal generator
- Advanced analytics
- Additional scoring profiles

### Later

- bKash/Nagad integration
- Review manager, competitor monitoring
- Full SaaS/white-label system
- Advanced communication integrations

---

# 36. Validation and Acceptance Criteria

## 36.1 Principle

Numeric targets (for example, "X% of leads have a phone number") depend heavily on source, category, and location. Arbitrary KPIs are avoided. Instead, **measure a real baseline first, then set targets from it.**

## 36.2 Stage A — Baseline Measurement (no pass/fail targets)

Run controlled test campaigns across a matrix of sources, categories, and locations, for example at least 3 categories (such as dental clinics, restaurants, salons) in at least 2 areas, with roughly 100 leads per combination where available.

Measure:

- Usable phone rate
- Publicly listed WhatsApp rate
- Email rate
- No-website rate and online presence type distribution
- Website-needing-improvement rate
- Duplicate rate and invalid-business rate
- Enrichment success rate
- Cost per 100 leads and cost per 1,000 leads
- **Accuracy from a manual check:** a human verifies a random sample per combination (suggested minimum 30) for valid business, correct phone, and correct category

## 36.3 Stage B — Set Targets from Baseline

- Record baseline numbers, chosen targets, and the reasoning in a **Validation Report** with date.
- Targets are set per source/category/location where the baseline shows meaningful differences.
- Targets are reviewed after each new source or market is added.

## 36.4 Stage C — Controlled Outreach Pilot

- A small pilot where salespeople contact leads through the approved human-reviewed workflow.
- Measure contact rate, response rate, interested rate, demo-request rate, and conversion.
- Use the results to calibrate scoring profile weights (Section 7.4).

## 36.5 Testable Acceptance Criteria (pass/fail)

These are binary and do not depend on market baselines.

**Data and contacts**

- The phone-normalization fixture suite passes for all documented formats and invalid inputs.
- Re-running or retrying a collection/enrichment job creates no duplicate leads.
- Every stored contact has a source and a timestamp.
- A contact is never labelled `PUBLICLY_LISTED` WhatsApp without a stored evidence source.
- Data is stored only within the persistence limits recorded in the Data Source Matrix.

**Scoring**

- For every score, the `LeadScoreEvent` breakdown sums to the stored score.
- Changing a profile's weights produces a new `profileVersion` and preserves earlier scores as history.

**Suppression and outreach**

- A suppressed contact blocks draft generation, demo generation, and outreach-stage CRM changes.
- `01...` and `+8801...` forms of the same number are matched by suppression and duplicate checks.

**Demo**

- Every demo page shows `DEMO — NOT OFFICIAL` and returns `noindex,nofollow` (meta tag and header) — verified by an automated test.
- A demo is automatically disabled at expiry and deleted after the retention period.
- Repeated clicks on `Generate Demo` create at most one active demo per lead.

**Cost and reliability**

- Every billable external call writes a `UsageLedger` row.
- Failed jobs show an understandable error and respect retry limits.

**Security**

- RBAC is enforced on backend routes, verified by tests for each role.
- External URL fetching is protected against SSRF and has timeouts and size limits.

---

# 37. Security Requirements

- Never expose API keys to the frontend.
- Encrypt sensitive integration credentials at rest.
- Use secure authentication/session handling.
- Apply RBAC on backend routes, not only UI.
- Rate-limit sensitive endpoints.
- Validate all user input.
- Sanitize imported data.
- Protect against SSRF when analyzing external URLs.
- Restrict website fetching to safe HTTP/HTTPS behavior.
- Add request timeouts and size limits.
- Keep audit logs for important administrative actions.
- Back up PostgreSQL.
- Use environment/secret management for production credentials.

---

# 38. Compliance and Responsible Data Use

The product should be designed for legitimate business lead generation.

Requirements:

- Prefer official/permitted APIs and authorized integrations.
- Follow applicable terms for third-party data sources.
- Respect applicable privacy and marketing laws.
- Do not collect private personal contact information through circumvention.
- Preserve contact/source provenance where practical.
- Do not label an ordinary phone as WhatsApp without evidence.
- Provide suppression/do-not-contact handling for outreach workflows through the `SuppressionList` (Section 28A), enforced on the backend.
- Support opt-out handling where applicable.
- Avoid uncontrolled mass messaging.
- Use human approval for outbound AI-generated communication in initial versions.
- Review current WhatsApp, email, Google/business-data, Meta (Facebook/Instagram), and other platform policies before enabling automated outbound actions.
- Do not collect Facebook/Instagram data through login-based or terms-violating scraping (Section 3B.3).
- Have the applicable Bangladesh laws and regulations on data protection, electronic communication, and marketing reviewed by qualified legal counsel before production use; this PRD does not substitute for legal advice.
- Honor takedown requests: a business that asks to be removed is added to the `SuppressionList` and any demo for it is disabled (Section 9.5).
- Define a data retention policy for lead, contact, and source data, and delete or anonymize data that is no longer needed.

---

# 39. Reliability Requirements

- Background jobs must support retries with limits.
- Failed jobs must expose understandable errors.
- Do not create duplicate leads when a job retries.
- Store external-source IDs where available.
- Store timestamps for collected/enriched information.
- Cache carefully without treating stale information as current.
- Use idempotency for StoreMate demo creation.
- Prevent one lead from accidentally creating multiple demos from repeated clicks.

---

# 40. Performance / Scaling

Initial architecture should support asynchronous processing.

Do not perform hundreds of website audits or AI requests directly inside an HTTP request.

Use:

```text
API
 ↓
Queue
 ↓
Workers
 ↓
Rate Limits / Concurrency Limits
 ↓
External Services
```

Scale workers independently as lead volume increases.

---

# 41. AI Cost Control

Not every operation needs an LLM.

Use normal code for:

- Duplicate detection
- Phone normalization
- Filtering
- Lead scoring
- Status rules
- Simple website checks

Use AI for:

- Lead summaries
- Evidence-based opportunity explanation
- Website draft content
- Sales drafts
- Call scripts
- Proposal drafts

Cache/reuse AI results until underlying lead data materially changes.

---

# 41A. Cost Model

The platform must measure what it costs to find and qualify a lead, so campaigns can be judged on cost as well as volume.

## Cost Components

| Component | Examples |
|---|---|
| Data provider / API | Per-request charges for discovery and details |
| Enrichment | Page fetching, third-party enrichment charges |
| AI tokens | Analysis, drafts, demo content (input + output tokens) |
| Website audit compute | Worker/compute time for audits |
| Hosting / infrastructure | Servers, database, queue, storage (allocated per month) |
| StoreMate demo generation | Per-demo generation and demo hosting cost |

## Metrics

```text
Cost per 100 leads       = total campaign cost / leads collected x 100
Cost per 1,000 leads     = total campaign cost / leads collected x 1,000
Cost per qualified lead  = total campaign cost / qualified leads
```

A **qualified lead** is defined per campaign, for example: not a duplicate, not suppressed, has the contact fields the campaign requires, and meets the High-priority threshold of the campaign's scoring profile.

## Requirements

- All paid/quota-limited calls write to the `UsageLedger` (Section 28A).
- Fixed costs (hosting) can be entered as monthly values and allocated across campaigns.
- Reports break costs down by campaign, source, and time period.
- Support per-campaign budget caps: a campaign stops or pauses when its cap is reached, with an alert before that.
- Costs are reported in BDT; provider costs in other currencies are converted using a stored exchange rate.
- Later, extend to cost per customer acquired and revenue per campaign.

---

# 42. Success Metrics

Track product success using measurable metrics:

### Data Quality

- Valid leads collected
- Contact availability rate
- Duplicate rate
- Enrichment success rate
- Cost per 100 / 1,000 leads
- Cost per qualified lead

### Sales

- Contact rate
- Response rate
- Interested rate
- Demo-request rate
- Demo-to-customer conversion
- Lead-to-customer conversion

### Operations

- Time saved per salesperson
- Average time from lead discovery to first contact
- Follow-ups completed on time
- Demo generation success rate

### Revenue

- Customers acquired
- Revenue by campaign
- Revenue by service
- Customer acquisition cost where measurable
- Recurring revenue generated through StoreMate/other services

---

# 43. Example End-to-End Scenario

A Sales Manager creates:

```text
Campaign: Mirpur Dental Clinics
Location: Mirpur, Dhaka
Category: Dental Clinic
Target: 300
Phone: Required
Website: Any
```

LeadMate:

1. Collects permitted business data.
2. Saves 300 raw leads.
3. Removes/merges duplicates.
4. Enriches contact information.
5. Checks website status.
6. Audits existing websites.
7. Calculates lead scores.
8. Generates AI opportunity summaries.
9. Recommends relevant company services.
10. Manager filters high-priority leads.
11. Leads are assigned to salespeople.
12. Salesperson opens ABC Dental Care.
13. LeadMate shows no website and a public business phone.
14. Salesperson generates a StoreMate demo.
15. StoreMate returns the demo URL.
16. AI prepares a personalized outreach draft.
17. Salesperson reviews and contacts the business through the approved workflow.
18. CRM stage changes to `CONTACTED`.
19. Customer responds and stage changes to `INTERESTED`.
20. Demo is presented.
21. Customer accepts.
22. Lead is converted to customer.
23. StoreMate demo becomes the basis of the live website.
24. LeadMate records the sale and reports conversion to management.

---

# 44. Final Product Vision

LeadMate should eventually become the company's **AI Customer Acquisition Operating System**.

It should connect four major functions:

```text
DISCOVER
Find relevant businesses
      ↓
UNDERSTAND
Collect contacts + analyze opportunities
      ↓
SELL
CRM + AI sales assistance + StoreMate demos
      ↓
CONVERT & GROW
Customer conversion + recurring services
```

StoreMate remains the website creation/delivery engine, while LeadMate becomes the intelligence and sales engine that brings potential customers into StoreMate and other company services.

---

# 45. Recommended Build Order

```text
01. Project Foundation
02. Authentication + RBAC
03. Data Source Matrix + Validation Spike + StoreMate API Contract
04. Lead Database + Phone Normalization
05. Business Search / Approved Data Source
06. Duplicate Detection + SuppressionList
07. Contact Enrichment
08. Search + Filters
09. Website & Online Presence Analyzer
10. Scoring Profiles (Acquisition, Redesign)
11. AI Analysis + Service Recommendations
12. CRM Pipeline (incl. PROPOSAL)
13. Assignment + Follow-up
14. StoreMate Demo Lite
15. AI Sales Assistant (Bangla/English)
16. Management Analytics + Cost Reports
17. Industry Templates, Payments (bKash/Nagad), Extra Profiles
18. Additional Integrations
19. Optional SaaS / White Label
```

**Important:** Do not start by building every advanced feature. First prove that the platform can reliably find a useful business lead, obtain legitimate business contact information, identify a real opportunity, move that lead through the CRM, and put a safe demo link in a salesperson's hands. Then add deeper automation.

---

# 45A. AI-Assisted Development Workflow

This PRD is the **source of truth**. It is **not** a single prompt to hand to an AI coding tool, because implementing all 45+ sections at once leads to over-building and inconsistent decisions.

## Working Method

- Development proceeds in small milestones, each with its own **build spec** (for example `docs/build-specs/phase-0.md`).
- One milestone per task. Review, test, and merge before starting the next.
- If implementation reveals a PRD problem, update the PRD (version bump + change log) rather than silently deviating.
- The coding tool must not invent data sources, scraping methods, or policy decisions. Those come from the Data Source Matrix and this PRD.

## Build Spec Template

```text
Title / Milestone
Goal
Referenced PRD sections
In scope
Out of scope (explicit non-goals)
Data model changes
API endpoints
UI changes
Background jobs
Acceptance criteria (testable)
Tests required
Security / compliance checks
Definition of done
```

## Definition of Done (every milestone)

- Acceptance criteria pass with automated tests where practical.
- RBAC enforced on the backend for new endpoints.
- New external calls write `UsageLedger` entries.
- Secrets are not in code or logs.
- Documentation and the PRD change log are updated if behavior changed.

---

# 45B. Open Decisions (To Resolve Before / During Phase 0)

1. Which discovery and enrichment sources are approved (Data Source Matrix result).
2. StoreMate API contract details (authentication, idempotency, status delivery, rate limits).
3. Default demo expiry and deletion retention periods.
4. Default working days/hours and holidays for follow-up scheduling.
5. Bangladesh legal/compliance review scope and outcome.
6. Approved outreach channels and workflow (especially WhatsApp) for the pilot.
7. Budget cap defaults per campaign.
8. Who performs Bangla content quality review during the first campaigns.
9. Hosting and storage provider for the first release.

---

## Final One-Line Description

> **LeadMate is an AI-powered business lead generation and sales automation platform that discovers and enriches business leads, analyzes their digital needs, prioritizes sales opportunities, generates StoreMate demo websites, and manages the journey from lead to paying customer.**
