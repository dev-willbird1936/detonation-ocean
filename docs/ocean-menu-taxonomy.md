# Complete five-depth ocean menu — all 50 entries

**Every entry is assigned once to Sunlight, Twilight, Midnight, Abyss or Trench.** The 37 supported/named-scenario positions are distinguished from 10 editorial positions and 3 reference-library positions. A menu position is not automatically a verified initial-access fact.

The earlier evidence-only catalogue remains unchanged in `data/ocean-taxonomy.json` and `docs/ocean-taxonomy.md`.

## Counts

| Depth | Entries |
| --- | ---: |
| Sunlight | 9 |
| Twilight | 1 |
| Midnight | 4 |
| Abyss | 5 |
| Trench | 31 |
| **Total** | **50** |

## Family/depth matrix

| Family | Sunlight | Twilight | Midnight | Abyss | Trench | Total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Deception & Impersonation | 0 | 1 | 2 | 5 | 1 | 9 |
| Intrusion & Weaknesses | 0 | 0 | 0 | 0 | 6 | 6 |
| Coordinated & Automated Abuse | 4 | 0 | 0 | 0 | 6 | 10 |
| Trusted-Source Compromise | 1 | 0 | 0 | 0 | 3 | 4 |
| Theft & Surveillance | 2 | 0 | 2 | 0 | 8 | 12 |
| Extortion & Destruction | 2 | 0 | 0 | 0 | 7 | 9 |

## Reading the assignments

- **documented:** placement already supported in the evidence-only catalogue.
- **scenario:** a named supported stage/variant is selected; this is not a blanket placement for the entire campaign.
- **editorial:** the menu must contain the entry, but the historical route remains unconfirmed. The uncertainty badge is required.
- **reference:** a disclosure/display-risk library position, not a newly invented victim compromise.

Depth is interaction, not damage. Credential acquisition can remain unresolved while a later organisation-side single-factor access scenario is documented. Later keylogger capture is not the earlier RCE gate.

## All 50, sorted by depth and family

### Sunlight — Clean (9)

#### Melissa (1999)

- **ID:** `melissa-1999` · **Family:** Coordinated & Automated Abuse · **Basis:** documented
- **Victim:** Employee opening the infected Word document
- **Selected scope:** Catalogue entry
- **Placement reason:** Attachment-driven macro execution enables automated mass mailing; propagation is the dominant lesson.
- **Evidence-only status:** placed (sunlight). Attachment-driven macro execution enables automated mass mailing; propagation is the dominant lesson.
- **Subtypes/tags:** phishing; phishing delivery; macro worm; email disruption
- **Historical confidence:** high · **Original label:** phishing, SEV5
- **Sources:** [1](https://www.fbi.gov/news/stories/melissa-virus-20th-anniversary-032519) · [2](https://news.microsoft.com/source/1999/03/30/alert-on-macro-virus-issues/) · [3](https://www.microsoft.com/en-us/wdsi/threats/malware-encyclopedia-description?Name=Virus%3AW97M%2FMelissa.A) · [4](https://www.sei.cmu.edu/documents/2648/1999_102_001_413932.pdf) · [5](https://commdocs.house.gov/committees/science/hsy131170.000/hsy131170_1.HTM) · [6](https://www.justice.gov/archive/criminal/cybercrime/press-releases/2002/melissaSent.htm) · [7](https://cdn-dynmedia-1.microsoft.com/is/content/microsoftcorp/microsoft/final/en-us/microsoft-brand/documents/Microsoft_Security_Intelligence_Report_volume_7_Jan-Jun2009.pdf)

#### ILOVEYOU (Love Bug) (2000)

- **ID:** `iloveyou-2000` · **Family:** Coordinated & Automated Abuse · **Basis:** documented
- **Victim:** Recipient opening the script attachment
- **Selected scope:** Catalogue entry
- **Placement reason:** User execution starts the mass-mailing worm; overwriting and credential theft remain secondary consequences.
- **Evidence-only status:** placed (sunlight). User execution starts the mass-mailing worm; overwriting and credential theft remain secondary consequences.
- **Subtypes/tags:** phishing; phishing delivery; script execution; destructive malware
- **Historical confidence:** high · **Original label:** phishing, SEV5
- **Sources:** [1](https://www.microsoft.com/en-us/wdsi/threats/malware-encyclopedia-description?Name=Virus%3AVBS%2FLoveLetter&threatId=-2147428236) · [2](https://web.archive.org/web/20001204063700/http://www.cert.org/advisories/CA-2000-04.html) · [3](https://www.virusbulletin.com/virusbulletin/2015/05/throwback-thursday-when-love-came-town-june-2000) · [4](https://commdocs.house.gov/committees/science/hsy131170.000/hsy131170_1.HTM) · [5](https://cdn-dynmedia-1.microsoft.com/is/content/microsoftcorp/microsoft/final/en-us/microsoft-brand/documents/Microsoft_Security_Intelligence_Report_volume_7_Jan-Jun2009.pdf)

#### Mydoom (2004)

- **ID:** `mydoom-2004` · **Family:** Coordinated & Automated Abuse · **Basis:** documented
- **Victim:** Recipient executing the email-delivered worm
- **Selected scope:** Email-attachment variant
- **Placement reason:** Classified on the documented email-attachment execution route, not every peer-to-peer variant.
- **Evidence-only status:** placed (sunlight). Classified on the documented email-attachment execution route, not every peer-to-peer variant.
- **Subtypes/tags:** phishing; phishing delivery; mass mailing; denial of service
- **Historical confidence:** high · **Original label:** phishing, SEV5
- **Sources:** [1](https://www.microsoft.com/en-us/wdsi/threats/malware-encyclopedia-description?Name=Win32%2FMydoom) · [2](https://www.f-secure.com/v-descs/mydoom-m) · [3](https://cdn-dynmedia-1.microsoft.com/is/content/microsoftcorp/microsoft/final/en-us/microsoft-brand/documents/Microsoft_Security_Intelligence_Report_volume_7_Jan-Jun2009.pdf)

#### Emotet (2014)

- **ID:** `emotet-2014` · **Family:** Coordinated & Automated Abuse · **Basis:** documented
- **Victim:** Recipient opening a malicious attachment
- **Selected scope:** Malicious-attachment variant
- **Placement reason:** Classified on the sourced malicious-file execution variant. Its coordinated delivery platform is primary; do not imply every Emotet link causes one-click execution.
- **Evidence-only status:** placed (sunlight). Classified on the sourced malicious-file execution variant. Its coordinated delivery platform is primary; do not imply every Emotet link causes one-click execution.
- **Subtypes/tags:** phishing; phishing delivery; botnet; malware delivery
- **Historical confidence:** high · **Original label:** phishing, SEV5
- **Sources:** [1](https://www.cisa.gov/news-events/cybersecurity-advisories/aa20-280a) · [2](https://www.cisa.gov/news-events/alerts/2018/07/20/emotet-malware) · [3](https://www.microsoft.com/en-us/wdsi/threats/malware-encyclopedia-description?Name=Win32%2FEmotet)

#### RSA SecurID (2011)

- **ID:** `rsa-2011` · **Family:** Trusted-Source Compromise · **Basis:** documented
- **Victim:** RSA employee targeted at the authentication supplier
- **Selected scope:** Reported RSA employee attachment route
- **Placement reason:** Reporting describes an Excel attachment with an embedded exploit. The supplier-trust lesson is primary; do not claim a precise token-seed scope or every downstream customer compromised.
- **Evidence-only status:** placed (sunlight). Reporting describes an Excel attachment with an embedded exploit. The supplier-trust lesson is primary; do not claim a precise token-seed scope or every downstream customer compromised.
- **Subtypes/tags:** phishing; spearphishing; document exploitation; authentication-supplier compromise
- **Historical confidence:** high · **Original label:** phishing, SEV5
- **Sources:** [1](https://arstechnica.com/information-technology/2011/04/spearphishing-0-day-rsa-hack-not-extremely-sophisticated/) · [2](https://www.sec.gov/Archives/edgar/data/790070/000119312511070159/dex991.htm) · [3](https://www.sec.gov/Archives/edgar/data/790070/000119312511070159/dex992.htm)

#### Anthem (2015)

- **ID:** `anthem-2015` · **Family:** Theft & Surveillance · **Basis:** editorial
- **Victim:** Employee of the affected Anthem subsidiary
- **Selected scope:** Malware-file delivery/execution story from the indictment
- **Placement reason:** The indictment describes a link, file download and execution, without establishing whether an employee separately executed the file. Sunlight is the editorial best fit for the file-execution story, not a verified manual launch.
- **Required badge:** Entry route unconfirmed — editorial placement
- **Evidence-only status:** unknown. The indictment distinguishes clicking a hyperlink, downloading a file and executing it. It does not establish whether the victim separately ran the file; one-click-only and manual-file execution are both unproven.
- **Subtypes/tags:** espionage; spearphishing; backdoor; data exfiltration
- **Historical confidence:** high · **Original label:** espionage, SEV2
- **Sources:** [1](https://www.justice.gov/d9/press-releases/attachments/2019/05/09/anthem_indictment_0.pdf) · [2](https://www.justice.gov/archives/opa/pr/member-sophisticated-china-based-hacking-group-indicted-series-computer-intrusions-including)

#### Carbanak (Anunak) (2015)

- **ID:** `carbanak-2015` · **Family:** Theft & Surveillance · **Basis:** documented
- **Victim:** Bank employee targeted by a malicious attachment
- **Selected scope:** Catalogue entry
- **Placement reason:** The described attachment route enables later banking and ATM theft; the theft operation is the dominant story.
- **Evidence-only status:** placed (sunlight). The described attachment route enables later banking and ATM theft; the theft operation is the dominant story.
- **Subtypes/tags:** phishing; spearphishing; malware; financial theft
- **Historical confidence:** high · **Original label:** phishing, SEV5
- **Sources:** [1](https://securelist.com/the-great-bank-robbery-the-carbanak-apt/68732/)

#### PC Cyborg (AIDS Trojan) (1989)

- **ID:** `pccyborg-1989` · **Family:** Extortion & Destruction · **Basis:** documented
- **Victim:** Recipient running the AIDS-information disk program
- **Selected scope:** Catalogue entry
- **Placement reason:** Running the delivered program is required; later reboot counting and ransom demands are consequences.
- **Evidence-only status:** placed (sunlight). Running the delivered program is required; later reboot counting and ransom demands are consequences.
- **Subtypes/tags:** ransomware; mailed media
- **Historical confidence:** high · **Original label:** ransomware, SEV5
- **Sources:** [1](https://www.watchguard.com/wgrd-security-hub/ransomware-tracker/aids-trojan)

#### Ukrainian power grid (2015)

- **ID:** `ukraine-2015` · **Family:** Extortion & Destruction · **Basis:** editorial
- **Victim:** Affected Ukrainian power-grid operator
- **Selected scope:** Reported malicious-Office-attachment delivery story
- **Placement reason:** The attachment infection is reported, but CISA did not establish its role in the grid intrusion. Sunlight illustrates that delivery story; it is not proof that opening the document caused the outage.
- **Required badge:** Entry route unconfirmed — editorial placement
- **Evidence-only status:** unknown. CISA confirms remote breaker operation and disruption but says BlackEnergy's initial-access role was still under evaluation. Do not convert a reported attachment infection into a proven outage-entry gate.
- **Subtypes/tags:** phishing; industrial disruption; remote administration; reported spearphishing; KillDisk
- **Historical confidence:** high · **Original label:** phishing, SEV2
- **Sources:** [1](https://attack.mitre.org/campaigns/C0028/) · [2](https://www.cisa.gov/news-events/ics-alerts/ir-alert-h-16-056-01) · [3](https://cdn.selinc.com/assets/Literature/Publications/Technical%20Papers/6774_UkraineCyber_DEW_20170130_Web7.pdf?v=20181015-210831)

### Twilight — Risky or inconclusive (1)

#### LAPSUS$ (Okta / Microsoft / T-Mobile / Uber) (2022)

- **ID:** `lapsus-2022` · **Family:** Deception & Impersonation · **Basis:** scenario
- **Victim:** Employee responding to attacker-induced MFA prompts
- **Selected scope:** Documented MFA-fatigue/approval variant, not every LAPSUS$ incident
- **Placement reason:** Use the employee MFA-approval scenario documented within the campaign. Purchased credentials, help-desk and SIM-swap variants retain their own different interaction requirements.
- **Required badge:** Selected scenario — other routes may differ
- **Evidence-only status:** unknown. The entry combines MFA fatigue, help-desk deception, SIM swapping and purchased credentials. No single required action is established for the whole combined campaign.
- **Subtypes/tags:** social; MFA fatigue; help-desk impersonation; SIM swapping; purchased credentials
- **Historical confidence:** high · **Original label:** social, SEV2
- **Sources:** [1](https://www.microsoft.com/en-us/security/blog/2022/03/22/dev-0537-criminal-actor-targeting-organizations-for-data-exfiltration-and-destruction/)

### Midnight — Steals (4)

#### Smishing / parcel lure (2010s) (2016)

- **ID:** `smishing-2016` · **Family:** Deception & Impersonation · **Basis:** documented
- **Victim:** SMS recipient entering credentials at the spoofed site
- **Selected scope:** Credential-entry variant, not malware-download variants
- **Placement reason:** For the credential-page variant described in the entry, following the link alone does not disclose credentials; submission is the decisive action.
- **Evidence-only status:** placed (midnight). For the credential-page variant described in the entry, following the link alone does not disclose credentials; submission is the decisive action.
- **Subtypes/tags:** phishing; SMS phishing; credential capture
- **Historical confidence:** high · **Original label:** phishing, SEV2
- **Sources:** [1](https://consumer.ftc.gov/consumer-alerts/2023/12/fake-shipping-notification-emails-text-messages-what-you-need-know-holiday-season)

#### Quishing (QR-code phishing) (2024)

- **ID:** `quishing-2024` · **Family:** Deception & Impersonation · **Basis:** documented
- **Victim:** QR-code recipient submitting credentials to the spoofed site
- **Selected scope:** Credential-entry variant, not malware-download variants
- **Placement reason:** For the described credential-stealing-site variant, scanning/navigation alone is not credential theft. Classify credential submission, not the preliminary QR scan.
- **Evidence-only status:** placed (midnight). For the described credential-stealing-site variant, scanning/navigation alone is not credential theft. Classify credential submission, not the preliminary QR scan.
- **Subtypes/tags:** phishing; QR phishing; credential capture
- **Historical confidence:** high · **Original label:** phishing, SEV2
- **Sources:** [1](https://consumer.ftc.gov/consumer-alerts/2023/12/scammers-hide-harmful-links-qr-codes-steal-your-information)

#### Zeus (Zbot) (2007)

- **ID:** `zeus-2007` · **Family:** Theft & Surveillance · **Basis:** scenario
- **Victim:** Banking user whose browser is already compromised
- **Selected scope:** Banking-form credential-capture scenario, not initial malware installation
- **Placement reason:** The displayed boundary is entering banking credentials into a browser modified by Zeus. Initial installation remains a separate, unresolved question.
- **Required badge:** Selected scenario — other routes may differ
- **Evidence-only status:** unknown. Typing a banking password after infection is not initial access. The broad malware entry does not establish one required installation route.
- **Subtypes/tags:** phishing; banking Trojan; form grabbing; keylogging
- **Historical confidence:** high · **Original label:** phishing, SEV3
- **Sources:** [1](https://digital.nhs.uk/cyber-alerts/2017/cc-1138) · [2](https://www.sophos.com/en-us/threat-detection-library/mal/zbot) · [3](https://securelist.com/zeus-on-the-hunt/36289/)

#### Collection #1 (credential compilation) (2019)

- **ID:** `collection1-2019` · **Family:** Theft & Surveillance · **Basis:** reference
- **Victim:** No single newly compromised victim represented by the compilation
- **Selected scope:** Password/credential-reuse reference
- **Placement reason:** The compiled credential collection belongs beside password-related lessons. It is not a fresh attack or proof that a victim submitted a password in 2019.
- **Required badge:** Reference entry — not a victim-compromise classification
- **Evidence-only status:** not-applicable. A compilation of previously exposed credentials is a disclosure, not a fresh intrusion with an established interaction gate.
- **Subtypes/tags:** theft; credential compilation; disclosure; credential-reuse risk
- **Historical confidence:** high · **Original label:** theft, SEV1
- **Sources:** [1](https://www.troyhunt.com/the-773-million-record-collection-1-data-reach/)

### Abyss — Takes control (5)

#### Lookalike / IDN homograph domains (2005)

- **ID:** `lookalike-2005` · **Family:** Deception & Impersonation · **Basis:** reference
- **Victim:** Browser user inspecting an apparent origin
- **Selected scope:** Navigation/origin-display risk reference
- **Placement reason:** The browser-display risk is encountered while navigating to an apparent origin. This is a reference placement, not a claim that navigation itself steals credentials.
- **Required badge:** Reference entry — not a victim-compromise classification
- **Evidence-only status:** not-applicable. This standalone record describes an address-bar spoofing risk, not a completed credential leak or a single compromise gate. Keep it in reference material rather than inventing a breach depth.
- **Subtypes/tags:** phishing; IDN homograph; origin-display spoofing
- **Historical confidence:** high · **Original label:** phishing, SEV2
- **Sources:** [1](https://www.mozilla.org/en-US/security/advisories/mfsa2005-29/) · [2](https://bugzilla.mozilla.org/show_bug.cgi?id=281831)

#### Crypto drainer kits (wallet-approval phishing) (2022)

- **ID:** `drainer-2022` · **Family:** Deception & Impersonation · **Basis:** documented
- **Victim:** Wallet holder signing the malicious approval
- **Selected scope:** Approval-only wallet-drainer variant
- **Placement reason:** The described gate is a wallet authorisation/signature, not supplying an OTP or recovery secret. Keep the high financial impact separate from depth.
- **Evidence-only status:** placed (abyss). The described gate is a wallet authorisation/signature, not supplying an OTP or recovery secret. Keep the high financial impact separate from depth.
- **Subtypes/tags:** phishing; wallet-approval phishing; financial theft
- **Historical confidence:** high · **Original label:** phishing, SEV4
- **Sources:** [1](https://www.chainalysis.com/blog/crypto-drainers/)

#### OAuth consent phishing (AiTM precursor, category) (2023)

- **ID:** `oauth-2023` · **Family:** Deception & Impersonation · **Basis:** documented
- **Victim:** User granting the malicious connected app access
- **Selected scope:** Consent-only variant
- **Placement reason:** The consent-only variant grants access without a fake login, password capture, extra authentication-factor disclosure or downloaded-file execution.
- **Evidence-only status:** placed (abyss). The consent-only variant grants access without a fake login, password capture, extra authentication-factor disclosure or downloaded-file execution.
- **Subtypes/tags:** phishing; OAuth consent; permission abuse
- **Historical confidence:** high · **Original label:** phishing, SEV2
- **Sources:** [1](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/protect-against-consent-phishing)

#### Business Email Compromise (invoice thread) (2024)

- **ID:** `bec-2024` · **Family:** Deception & Impersonation · **Basis:** documented
- **Victim:** Finance recipient persuaded to authorise a fraudulent payment
- **Selected scope:** Finance-victim transaction boundary, not mailbox initial access
- **Placement reason:** Classify the entry's invoice/payment authorisation boundary, not an invented initial compromise of the existing email thread. No attacker-directed credential disclosure or file execution is specified.
- **Evidence-only status:** placed (abyss). Classify the entry's invoice/payment authorisation boundary, not an invented initial compromise of the existing email thread. No attacker-directed credential disclosure or file execution is specified.
- **Subtypes/tags:** bec; invoice-thread impersonation; payment-authorisation fraud
- **Historical confidence:** high · **Original label:** bec, SEV2
- **Sources:** [1](https://www.fbi.gov/news/stories/business-e-mail-compromise-on-the-rise) · [2](https://www.ic3.gov/PSA/2024/PSA240911) · [3](https://www.microsoft.com/en-us/security/blog/2022/07/12/from-cookie-theft-to-bec-attackers-use-aitm-phishing-sites-as-entry-point-to-further-financial-fraud/)

#### Salesforce / UNC6040 vishing (2025)

- **ID:** `salesforce-2025` · **Family:** Deception & Impersonation · **Basis:** documented
- **Victim:** Employee approving the malicious connected app
- **Selected scope:** Catalogue entry
- **Placement reason:** Voice persuasion leads to application authorisation without password theft; data export follows the consent boundary.
- **Evidence-only status:** placed (abyss). Voice persuasion leads to application authorisation without password theft; data export follows the consent boundary.
- **Subtypes/tags:** social; vishing; connected-app consent; data theft
- **Historical confidence:** high · **Original label:** social, SEV2
- **Sources:** [1](https://cloud.google.com/blog/topics/threat-intelligence/voice-phishing-data-extortion)

### Trench — Destroys (31)

#### SIM swap / SMS OTP interception (2020)

- **ID:** `simswap-2020` · **Family:** Deception & Impersonation · **Basis:** documented
- **Victim:** Subscriber whose number is reassigned
- **Selected scope:** Subscriber perspective; carrier-social-engineering variant
- **Placement reason:** In the selected carrier-impersonation variant, the attacker persuades carrier staff and receives redirected codes. The subscriber does not provide the code or approve MFA. Carrier employees are a different perspective.
- **Evidence-only status:** placed (trench). In the selected carrier-impersonation variant, the attacker persuades carrier staff and receives redirected codes. The subscriber does not provide the code or approve MFA. Carrier employees are a different perspective.
- **Subtypes/tags:** social; carrier impersonation; account recovery abuse; OTP interception
- **Historical confidence:** high · **Original label:** social, SEV4
- **Sources:** [1](https://www.ic3.gov/PSA/2022/PSA220208)

#### Heartbleed (2014)

- **ID:** `heartbleed-2014` · **Family:** Intrusion & Weaknesses · **Basis:** documented
- **Victim:** Operator of the vulnerable TLS service
- **Selected scope:** Catalogue entry
- **Placement reason:** Remote heartbeat handling can expose process memory without a victim response.
- **Evidence-only status:** placed (trench). Remote heartbeat handling can expose process memory without a victim response.
- **Subtypes/tags:** vulnerability; software vulnerability; memory disclosure
- **Historical confidence:** high · **Original label:** vulnerability, SEV1
- **Sources:** [1](https://www.cisa.gov/news-events/alerts/2014/04/08/openssl-heartbleed-vulnerability-cve-2014-0160) · [2](https://www.netcraft.com/blog/half-a-million-widely-trusted-websites-vulnerable-to-heartbleed-bug)

#### Yahoo forged cookies 2015–16 (2016)

- **ID:** `yahoo-cookies-2016` · **Family:** Intrusion & Weaknesses · **Basis:** documented
- **Victim:** Yahoo account holder targeted by a forged session
- **Selected scope:** Catalogue entry
- **Placement reason:** Forged cookies allow attacker access without the account holder supplying a password or responding.
- **Evidence-only status:** placed (trench). Forged cookies allow attacker access without the account holder supplying a password or responding.
- **Subtypes/tags:** exploit; session forgery; authentication bypass
- **Historical confidence:** high · **Original label:** exploit, SEV1
- **Sources:** [1](https://www.sec.gov/Archives/edgar/data/1011006/000119312517065791/d293630d10k.htm) · [2](https://www.sec.gov/Archives/edgar/data/1011006/000119312516793106/d305610dex991.htm) · [3](https://ca.finance.yahoo.com/news/yahoo-says-32-million-accounts-233322849.html)

#### Equifax (2017)

- **ID:** `equifax-2017` · **Family:** Intrusion & Weaknesses · **Basis:** documented
- **Victim:** Operator of the exposed Equifax web application
- **Selected scope:** Catalogue entry
- **Placement reason:** Server-side exploitation of the unpatched application needs no victim response; data theft is a secondary outcome.
- **Evidence-only status:** placed (trench). Server-side exploitation of the unpatched application needs no victim response; data theft is a secondary outcome.
- **Subtypes/tags:** exploit; unpatched application; data theft
- **Historical confidence:** high · **Original label:** exploit, SEV1
- **Sources:** [1](https://www.gao.gov/products/gao-18-559) · [2](https://www.ftc.gov/system/files/documents/cases/172_3203_equifax_complaint_7-22-19.pdf)

#### Capital One (WAF misconfiguration, SSRF) (2019)

- **ID:** `capitalone-2019` · **Family:** Intrusion & Weaknesses · **Basis:** documented
- **Victim:** Capital One cloud-environment operator
- **Selected scope:** Catalogue entry
- **Placement reason:** The documented server-side request/misconfiguration route needs no victim response; exposed credentials are obtained by the attacker, not typed by the victim.
- **Evidence-only status:** placed (trench). The documented server-side request/misconfiguration route needs no victim response; exposed credentials are obtained by the attacker, not typed by the victim.
- **Subtypes/tags:** exploit; misconfiguration; SSRF; cloud-data theft
- **Historical confidence:** high · **Original label:** exploit, SEV1
- **Sources:** [1](https://www.justice.gov/usao-wdwa/united-states-v-paige-thompson) · [2](https://www.justice.gov/usao-wdwa/press-release/file/1188626/dl)

#### Log4Shell (CVE-2021-44228) (2021)

- **ID:** `log4shell-2021` · **Family:** Intrusion & Weaknesses · **Basis:** documented
- **Victim:** Operator of an application evaluating attacker-controlled logged input
- **Selected scope:** Catalogue entry
- **Placement reason:** The server-side lookup flaw can be triggered by attacker input without a victim response.
- **Evidence-only status:** placed (trench). The server-side lookup flaw can be triggered by attacker input without a victim response.
- **Subtypes/tags:** vulnerability; software vulnerability; unsafe lookup; remote code execution
- **Historical confidence:** high · **Original label:** vulnerability, SEV1
- **Sources:** [1](https://www.cisa.gov/news-events/cybersecurity-advisories/aa21-356a)

#### SharePoint ToolShell (CVE-2025-53770) (2025)

- **ID:** `sharepoint-2025` · **Family:** Intrusion & Weaknesses · **Basis:** documented
- **Victim:** Operator of the exposed on-premises SharePoint server
- **Selected scope:** Catalogue entry
- **Placement reason:** Unauthenticated requests trigger server-side exploitation without a victim response; key theft is a consequence, not a user credential submission.
- **Evidence-only status:** placed (trench). Unauthenticated requests trigger server-side exploitation without a victim response; key theft is a consequence, not a user credential submission.
- **Subtypes/tags:** exploit; deserialisation; unauthenticated exploitation; signing-key theft
- **Historical confidence:** high · **Original label:** exploit, SEV1
- **Sources:** [1](https://msrc.microsoft.com/update-guide/vulnerability/CVE-2025-53770) · [2](https://www.microsoft.com/en-us/msrc/blog/2025/07/customer-guidance-for-sharepoint-vulnerability-cve-2025-53770)

#### Blaster (MSBlast) (2003)

- **ID:** `blaster-2003` · **Family:** Coordinated & Automated Abuse · **Basis:** documented
- **Victim:** Owner of an exposed Windows host
- **Selected scope:** Catalogue entry
- **Placement reason:** Remote service exploitation propagates without a victim click or file execution.
- **Evidence-only status:** placed (trench). Remote service exploitation propagates without a victim click or file execution.
- **Subtypes/tags:** botnet; network worm; remote service exploitation
- **Historical confidence:** high · **Original label:** botnet, SEV1
- **Sources:** [1](https://learn.microsoft.com/en-us/security-updates/securitybulletins/2003/ms03-026) · [2](https://learn.microsoft.com/en-us/troubleshoot/windows-server/security-and-malware/blaster-worm-virus-alert)

#### SQL Slammer (2003)

- **ID:** `slammer-2003` · **Family:** Coordinated & Automated Abuse · **Basis:** documented
- **Victim:** Operator of a vulnerable SQL Server
- **Selected scope:** Catalogue entry
- **Placement reason:** The network-service worm needs no victim response; scanning congestion is the outcome.
- **Evidence-only status:** placed (trench). The network-service worm needs no victim response; scanning congestion is the outcome.
- **Subtypes/tags:** botnet; network worm; service disruption
- **Historical confidence:** high · **Original label:** botnet, SEV1
- **Sources:** [1](https://www.caida.org/archive/sapphire/) · [2](https://learn.microsoft.com/en-us/security-updates/securitybulletins/2002/ms02-039)

#### Sasser worm (2004)

- **ID:** `sasser-2004` · **Family:** Coordinated & Automated Abuse · **Basis:** documented
- **Victim:** Owner of an exposed Windows host
- **Selected scope:** Catalogue entry
- **Placement reason:** LSASS exploitation and network scanning do not require a victim response.
- **Evidence-only status:** placed (trench). LSASS exploitation and network scanning do not require a victim response.
- **Subtypes/tags:** botnet; network worm; remote service exploitation
- **Historical confidence:** high · **Original label:** botnet, SEV1
- **Sources:** [1](https://www.microsoft.com/en-us/wdsi/threats/malware-encyclopedia-description?name=Win32%2FSasser) · [2](https://cdn-dynmedia-1.microsoft.com/is/content/microsoftcorp/microsoft/final/en-us/microsoft-brand/documents/Microsoft_Security_Intelligence_Report_volume_7_Jan-Jun2009.pdf) · [3](https://learn.microsoft.com/en-us/security-updates/securitybulletins/2004/ms04-011)

#### Conficker (2008)

- **ID:** `conficker-2008` · **Family:** Coordinated & Automated Abuse · **Basis:** documented
- **Victim:** Owner of a vulnerable Windows network host
- **Selected scope:** MS08-067 network-service variant
- **Placement reason:** The selected MS08-067 network-service propagation route requires no victim response; removable-media and share variants are not silently assigned this depth.
- **Evidence-only status:** placed (trench). The selected MS08-067 network-service propagation route requires no victim response; removable-media and share variants are not silently assigned this depth.
- **Subtypes/tags:** botnet; network worm; unpatched service; removable-media alternatives
- **Historical confidence:** high · **Original label:** botnet, SEV1
- **Sources:** [1](https://www.cisa.gov/news-events/alerts/2009/03/29/conficker-worm-targets-microsoft-windows-systems) · [2](https://learn.microsoft.com/en-us/security-updates/securitybulletins/2008/ms08-067) · [3](https://www.usenix.org/event/leet09/tech/full_papers/porras/porras_html)

#### Mirai (2016)

- **ID:** `mirai-2016` · **Family:** Coordinated & Automated Abuse · **Basis:** documented
- **Victim:** Owner of an internet-connected device
- **Selected scope:** Catalogue entry
- **Placement reason:** The selected self-propagating IoT botnet route does not require its owner to submit a password or respond to a lure.
- **Evidence-only status:** placed (trench). The selected self-propagating IoT botnet route does not require its owner to submit a password or respond to a lure.
- **Subtypes/tags:** botnet; IoT botnet; denial of service
- **Historical confidence:** high · **Original label:** botnet, SEV1
- **Sources:** [1](https://www.cisa.gov/news-events/alerts/2016/10/14/heightened-ddos-threat-posed-mirai-and-other-botnets)

#### VPNFilter (2018)

- **ID:** `vpnfilter-2018` · **Family:** Coordinated & Automated Abuse · **Basis:** editorial
- **Victim:** Owner of the compromised router or NAS
- **Selected scope:** Network-device compromise story; individual infection route unconfirmed
- **Placement reason:** The implant affects routers/NAS devices, making deep the menu best fit. Talos was unsure of the exploit used in a given case; no specific default-password or zero-action route is asserted.
- **Required badge:** Entry route unconfirmed — editorial placement
- **Evidence-only status:** unknown. Talos states it was unsure of the particular exploit used in any given case. Known exploits and default credentials are possibilities, not a proven interaction classification.
- **Subtypes/tags:** botnet; router implant; coordinated infrastructure; traffic surveillance
- **Historical confidence:** high · **Original label:** botnet, SEV1
- **Sources:** [1](https://blog.talosintelligence.com/vpnfilter/) · [2](https://www.cisa.gov/news-events/alerts/2018/05/25/cyber-actors-target-home-and-office-routers-and-networked-devices-worldwide)

#### Target (2013)

- **ID:** `target-2013` · **Family:** Trusted-Source Compromise · **Basis:** editorial
- **Victim:** Target organisation, not the supplier employee opening an email
- **Selected scope:** Downstream Target/vendor-credential entry story
- **Placement reason:** The attacker uses the compromised supplier relationship. Deep is the best-fit downstream menu placement, but the partially unresolved access path does not establish a complete no-action history.
- **Required badge:** Entry route unconfirmed — editorial placement
- **Evidence-only status:** unknown. Vendor credential theft and downstream POS theft are established; the curated record leaves the access path partly unresolved. Do not assign the vendor employee's email action to Target.
- **Subtypes/tags:** supply-chain; supplier credentials; POS malware; payment-card theft
- **Historical confidence:** high · **Original label:** supply-chain, SEV2
- **Sources:** [1](https://krebsonsecurity.com/2014/02/target-hackers-broke-in-via-hvac-company/) · [2](https://krebsonsecurity.com/2014/02/email-attack-on-vendor-set-up-breach-at-target/) · [3](https://krebsonsecurity.com/2014/01/a-first-look-at-the-target-intrusion-malware/)

#### NotPetya (M.E.Doc updater) (2017)

- **ID:** `notpetya-2017` · **Family:** Trusted-Source Compromise · **Basis:** documented
- **Victim:** Organisation receiving the compromised M.E.Doc updater payload
- **Selected scope:** Compromised updater mechanism
- **Placement reason:** Classified on the updater-delivery mechanism, not a fictitious tax-document lure. It does not generalise no-action entry to every manually installed package.
- **Evidence-only status:** placed (trench). Classified on the updater-delivery mechanism, not a fictitious tax-document lure. It does not generalise no-action entry to every manually installed package.
- **Subtypes/tags:** supply-chain; compromised update; wiper; network propagation
- **Historical confidence:** high · **Original label:** supply-chain, SEV1
- **Sources:** [1](https://www.microsoft.com/en-us/security/blog/2017/06/27/new-ransomware-old-techniques-petya-adds-worm-capabilities/) · [2](https://blog.talosintelligence.com/the-medoc-connection/)

#### SolarWinds / SUNBURST (2020)

- **ID:** `solarwinds-2020` · **Family:** Trusted-Source Compromise · **Basis:** documented
- **Victim:** Downstream Orion customer organisation
- **Selected scope:** Downstream signed-update mechanism
- **Placement reason:** The signed build/update channel carries the payload. Classify the downstream updater/runtime compromise, not an invented human deception step at the supplier.
- **Evidence-only status:** placed (trench). The signed build/update channel carries the payload. Classify the downstream updater/runtime compromise, not an invented human deception step at the supplier.
- **Subtypes/tags:** supply-chain; build-process compromise; signed update; espionage
- **Historical confidence:** high · **Original label:** supply-chain, SEV1
- **Sources:** [1](https://www.cisa.gov/news-events/analysis-reports/ar21-039a) · [2](https://www.solarwinds.com/blog/an-investigative-update-of-the-cyberattack) · [3](https://www.cisa.gov/sites/default/files/publications/Supply_Chain_Compromise_Detecting_APT_Activity_from_known_TTPs.pdf)

#### TJX (T.J. Maxx / Marshalls) (2007)

- **ID:** `tjx-2007` · **Family:** Theft & Surveillance · **Basis:** documented
- **Victim:** TJX store and corporate-network operators
- **Selected scope:** Reported wireless-entry route
- **Placement reason:** Classified on the reported external wireless-entry route; no employee response is required by that route. Reporting describes the route cautiously.
- **Evidence-only status:** placed (trench). Classified on the reported external wireless-entry route; no employee response is required by that route. Reporting describes the route cautiously.
- **Subtypes/tags:** card-fraud; payment-card theft; wireless access
- **Historical confidence:** high · **Original label:** card-fraud, SEV1
- **Sources:** [1](https://www.priv.gc.ca/en/opc-actions-and-decisions/investigations/investigations-into-businesses/2007/tjx_rep_070925/)

#### US Office of Personnel Management (2015)

- **ID:** `opm-2015` · **Family:** Theft & Surveillance · **Basis:** editorial
- **Victim:** OPM organisation, not an assumed contractor phishing victim
- **Selected scope:** Organisation-side compromised-contractor-identity entry story
- **Placement reason:** The compromised contractor identity supports a deep organisational-access layout. Credential acquisition and any earlier human action remain unresolved; the placement is editorial, not proof of zero interaction.
- **Required badge:** Entry route unconfirmed — editorial placement
- **Evidence-only status:** unknown. The KeyPoint credential was compromised, but how it was obtained was not determined. A compromised credential is neither proof of victim password submission nor proof of no victim action.
- **Subtypes/tags:** espionage; contractor identity; sensitive-record theft
- **Historical confidence:** high · **Original label:** espionage, SEV1
- **Sources:** [1](https://oversight.house.gov/report/opm-data-breach-government-jeopardized-national-security-generation/) · [2](https://docs.house.gov/meetings/GO/GO00/20150624/103684/HHRG-114-GO00-Transcript-20150624.pdf) · [3](https://oversight.house.gov/wp-content/uploads/2015/06/2015-06-24-FC-OPM-DATA-BREACH-PART-II.GO175001.pdf) · [4](https://www.gao.gov/products/gao-17-614)

#### Vault 7 (2017)

- **ID:** `vault7-2017` · **Family:** Theft & Surveillance · **Basis:** reference
- **Victim:** No conventional victim compromise represented by this entry
- **Selected scope:** Deep technical-capability disclosure reference
- **Placement reason:** This is an editorial reference-library position for the disclosed cyber-tool inventory. There is no conventional victim-compromise depth to assert.
- **Required badge:** Reference entry — not a victim-compromise classification
- **Evidence-only status:** not-applicable. A published inventory/disclosure is not a documented initial-access event. Its historical placement must not become a no-action attack.
- **Subtypes/tags:** espionage; disclosure; capability inventory
- **Historical confidence:** high · **Original label:** espionage, SEV1
- **Sources:** [1](https://www.washingtonpost.com/world/national-security/wikileaks-says-it-has-obtained-trove-of-cia-hacking-tools/2017/03/07/c8c50c5c-0345-11e7-b1e9-a05d3c21f7cf_story.html) · [2](https://www.bbc.com/news/technology-39193008)

#### Marriott / Starwood (2018)

- **ID:** `marriott-2018` · **Family:** Theft & Surveillance · **Basis:** editorial
- **Victim:** Marriott/Starwood organisation
- **Selected scope:** Editorial deep placement for the persistent organisation breach
- **Placement reason:** Installation of the initial web shell was not determined. Deep groups the organisation-level intrusion story but does not resolve its entry method.
- **Required badge:** Entry route unconfirmed — editorial placement
- **Evidence-only status:** unknown. The source explicitly leaves installation of the initial web shell undetermined; later tools and stolen data do not establish the entry interaction.
- **Subtypes/tags:** theft; web shell; credential harvesting; long dwell
- **Historical confidence:** high · **Original label:** theft, SEV1
- **Sources:** [1](https://www.priv.gc.ca/en/opc-actions-and-decisions/investigations/investigations-into-businesses/2022/pipeda-2022-005/)

#### LastPass (2022) (2022)

- **ID:** `lastpass-2022` · **Family:** Theft & Surveillance · **Basis:** scenario
- **Victim:** Engineer endpoint at the selected remote-exploitation stage
- **Selected scope:** Second-incident third-party remote-exploitation stage only
- **Placement reason:** The selected stage is remote exploitation of third-party media software on the engineer endpoint, before the keylogger captures later authentication. Do not classify that later password entry as the initial RCE gate.
- **Required badge:** Selected scenario — other routes may differ
- **Evidence-only status:** unknown. The entry combines two compromises. Third-party exploitation and later secret access are documented, but this combined record does not establish one decisive victim-action gate. Do not place later authentication at initial access.
- **Subtypes/tags:** exploit; third-party vulnerability; privileged endpoint; backup-data theft
- **Historical confidence:** high · **Original label:** exploit, SEV1
- **Sources:** [1](https://blog.lastpass.com/posts/security-incident-update-recommended-actions) · [2](https://www.infosecurity-magazine.com/news/lastpass-data-breach-update/)

#### MOVEit / Cl0p (CVE-2023-34362) (2023)

- **ID:** `moveit-2023` · **Family:** Theft & Surveillance · **Basis:** documented
- **Victim:** Operator of the exposed MOVEit Transfer application
- **Selected scope:** Catalogue entry
- **Placement reason:** Unauthenticated application exploitation enables bulk data theft. Retain SQL injection as a technique badge rather than losing the exfiltration lesson.
- **Evidence-only status:** placed (trench). Unauthenticated application exploitation enables bulk data theft. Retain SQL injection as a technique badge rather than losing the exfiltration lesson.
- **Subtypes/tags:** exploit; SQL injection; web shell; bulk-data theft
- **Historical confidence:** high · **Original label:** exploit, SEV1
- **Sources:** [1](https://nvd.nist.gov/vuln/detail/CVE-2023-34362) · [2](https://www.cisa.gov/news-events/cybersecurity-advisories/aa23-158a) · [3](https://www.emsisoft.com/en/blog/44123/unpacking-the-moveit-breach-statistics-and-analysis/)

#### AT&T (third-party cloud workspace) (2024)

- **ID:** `att-2024` · **Family:** Theft & Surveillance · **Basis:** editorial
- **Victim:** AT&T cloud-workspace victim
- **Selected scope:** Editorial deep placement for the cloud-workspace exfiltration story
- **Placement reason:** The curated sources do not establish initial access. Deep is a workspace-compromise layout choice, not a proven no-action attack or a claim that a particular password attack occurred.
- **Required badge:** Entry route unconfirmed — editorial placement
- **Evidence-only status:** unknown. Exfiltration from the workspace is documented, but the cited record does not establish how initial access was obtained.
- **Subtypes/tags:** theft; third-party cloud workspace; metadata theft
- **Historical confidence:** high · **Original label:** theft, SEV1
- **Sources:** [1](https://www.reuters.com/technology/cybersecurity/att-says-data-around-109-mln-us-customer-accounts-illegally-downloaded-2024-07-12/) · [2](https://www.sec.gov/Archives/edgar/data/732717/000073271724000046/t-20240506.htm) · [3](https://www.blumenthal.senate.gov/imo/media/doc/2024-07-16_snowflake_breach_att.pdf)

#### National Public Data / Infobroker (2024)

- **ID:** `npd-2024` · **Family:** Theft & Surveillance · **Basis:** editorial
- **Victim:** National Public Data organisation
- **Selected scope:** Editorial deep placement for the alleged data-broker breach
- **Placement reason:** The initial entry mechanism remains unconfirmed. The menu position reflects the organisation-level data-theft story and must carry that uncertainty badge.
- **Required badge:** Entry route unconfirmed — editorial placement
- **Evidence-only status:** unknown. The public record cited in the catalogue does not establish a specific entry mechanism; do not equate an alleged data release with no-action access.
- **Subtypes/tags:** theft; data broker; alleged data release
- **Historical confidence:** medium · **Original label:** theft, SEV1
- **Sources:** [1](https://www.nytimes.com/2024/08/15/business/social-security-numbers-stolen-hack.html) · [2](https://oversight.house.gov/wp-content/uploads/2024/08/NPD-Breach-Letter-08222024.pdf) · [3](https://oag.maryland.gov/resources-info/SBN%20Documents/2024/ITU-375412.pdf)

#### Stuxnet (2010)

- **ID:** `stuxnet-2010` · **Family:** Extortion & Destruction · **Basis:** scenario
- **Victim:** Owner of a host reached through network-service propagation
- **Selected scope:** Remote-service network-propagation variant, not first entry into the industrial target
- **Placement reason:** The selected network-service propagation route does not require a fresh response from the receiving host owner. Do not present this as the known first entry into Natanz.
- **Required badge:** Selected scenario — other routes may differ
- **Evidence-only status:** unknown. Industrial process manipulation is the dominant lesson. USB/network propagation does not establish the initial compromise path into the selected industrial victim.
- **Subtypes/tags:** supply-chain; industrial sabotage; USB propagation; network propagation; signed malware
- **Historical confidence:** high · **Original label:** supply-chain, SEV1
- **Sources:** [1](https://www.cisa.gov/news-events/ics-advisories/icsa-10-272-01) · [2](https://www.cisa.gov/news-events/ics-advisories/icsa-10-201-01c) · [3](https://www.enisa.europa.eu/news/enisa-news/stuxnet-analysis) · [4](https://nsarchive2.gwu.edu/NSAEBB/NSAEBB424/docs/Cyber-044.pdf) · [5](https://learn.microsoft.com/en-us/security-updates/securitybulletins/2010/ms10-061)

#### Shamoon (Disttrack) (2012)

- **ID:** `shamoon-2012` · **Family:** Extortion & Destruction · **Basis:** editorial
- **Victim:** Saudi Aramco corporate-network victim
- **Selected scope:** Editorial deep placement for an established destructive incident
- **Placement reason:** Initial access is unresolved. Trench is a menu-layout fallback for the system-level destructive story, not evidence that the victim did nothing.
- **Required badge:** Entry route unconfirmed — editorial placement
- **Evidence-only status:** unknown. The cited description establishes wiping and disruption, not the decisive initial-access interaction. Destruction is not proof of no-action entry.
- **Subtypes/tags:** wiper; service disruption
- **Historical confidence:** high · **Original label:** wiper, SEV1
- **Sources:** [1](https://www.nytimes.com/2012/10/24/business/global/cyberattack-on-saudi-oil-firm-disquiets-us.html) · [2](https://archive.nytimes.com/bits.blogs.nytimes.com/2012/08/27/connecting-the-dots-after-cyberattack-on-saudi-aramco/) · [3](https://www.cisa.gov/sites/default/files/Monitors/ICS-CERT_Monitor_Sep2012.pdf)

#### Sony Pictures (2014)

- **ID:** `sony-2014` · **Family:** Extortion & Destruction · **Basis:** editorial
- **Victim:** Sony Pictures organisation
- **Selected scope:** Editorial deep placement for the destructive/data-theft incident
- **Placement reason:** The public source does not establish initial access. This position must carry an entry-route-unconfirmed badge and must not be described as proven zero-action entry.
- **Required badge:** Entry route unconfirmed — editorial placement
- **Evidence-only status:** unknown. Observed destruction, theft and threats make destructive/extortion impact primary. The FBI statement does not establish initial access.
- **Subtypes/tags:** espionage; data theft; destructive malware; threats
- **Historical confidence:** medium · **Original label:** espionage, SEV1
- **Sources:** [1](https://www.fbi.gov/news/press-releases/update-on-sony-investigation) · [2](https://www.cisa.gov/news-events/alerts/2014/12/19/targeted-destructive-malware)

#### WannaCry (WanaCrypt0r) (2017)

- **ID:** `wannacry-2017` · **Family:** Extortion & Destruction · **Basis:** documented
- **Victim:** Operator of a vulnerable SMB service
- **Selected scope:** Catalogue entry
- **Placement reason:** Wormable service exploitation enables encryption without a victim click, password submission or file launch.
- **Evidence-only status:** placed (trench). Wormable service exploitation enables encryption without a victim click, password submission or file launch.
- **Subtypes/tags:** ransomware; network worm; unpatched service
- **Historical confidence:** high · **Original label:** ransomware, SEV1
- **Sources:** [1](https://www.england.nhs.uk/wp-content/uploads/2018/02/lessons-learned-review-wannacry-ransomware-cyber-attack-cio-review.pdf) · [2](https://www.cisa.gov/news-events/alerts/2017/05/12/indicators-associated-wannacry-ransomware) · [3](https://www.microsoft.com/en-us/security/blog/2017/05/12/wannacrypt-ransomware-worm-targets-out-of-date-systems/)

#### Colonial Pipeline (2021)

- **ID:** `colonial-2021` · **Family:** Extortion & Destruction · **Basis:** scenario
- **Victim:** Colonial organisation at the VPN-access boundary
- **Selected scope:** Documented attacker access through the legacy single-factor VPN account
- **Placement reason:** This organisation-side access boundary uses already-compromised credentials and does not require fresh victim approval. How the credentials were originally acquired remains unknown.
- **Required badge:** Selected scenario — other routes may differ
- **Evidence-only status:** unknown. Use of the legacy single-factor VPN account is known; credential acquisition was still under investigation. No-MFA does not prove how the victim identity was first compromised.
- **Subtypes/tags:** ransomware; valid-account abuse; no MFA
- **Historical confidence:** high · **Original label:** ransomware, SEV1
- **Sources:** [1](https://www.hsgac.senate.gov/wp-content/uploads/imo/media/doc/Testimony-Blount-2021-06-08.pdf) · [2](https://www.govinfo.gov/content/pkg/CHRG-117shrg46569/html/CHRG-117shrg46569.htm) · [3](https://www.hsgac.senate.gov/media/reps/portman-presses-president-and-ceo-of-colonial-pipeline-on-gaps-in-cybersecurity-practices/) · [4](https://www.energy.gov/ceser/articles/ceser-2021-emergency-response-recap) · [5](https://www.colpipe.com/news-insights/media-resources/post/media-statement-update-colonial-pipeline-system-disruption/) · [6](https://www.phmsa.dot.gov/sites/phmsa.dot.gov/files/2022-05/32022026_Colonial_Pipeline_NOPV_PCP_PCO_05052022.pdf)

#### Viasat KA-SAT disruption (2022) (2022)

- **ID:** `ukraine-2022` · **Family:** Extortion & Destruction · **Basis:** documented
- **Victim:** Viasat KA-SAT network operator
- **Selected scope:** Catalogue entry
- **Placement reason:** The documented VPN-appliance misconfiguration enables entry into the trusted management segment without victim response; subsequent modem disruption is the outcome.
- **Evidence-only status:** placed (trench). The documented VPN-appliance misconfiguration enables entry into the trusted management segment without victim response; subsequent modem disruption is the outcome.
- **Subtypes/tags:** exploit; network misconfiguration; management-plane abuse; service disruption
- **Historical confidence:** high · **Original label:** exploit, SEV1
- **Sources:** [1](https://www.viasat.com/perspectives/corporate/2022/ka-sat-network-cyber-attack-overview/)

#### Change Healthcare (Citrix portal, no MFA) (2024)

- **ID:** `changehealth-2024` · **Family:** Extortion & Destruction · **Basis:** scenario
- **Victim:** Change Healthcare organisation at the Citrix-access boundary
- **Selected scope:** Documented attacker access through the Citrix portal without MFA
- **Placement reason:** At this organisation-side portal boundary the attacker uses already-compromised credentials without fresh victim MFA approval. Credential acquisition is still not reconstructed.
- **Required badge:** Selected scenario — other routes may differ
- **Evidence-only status:** unknown. Ransomware, extortion and service disruption are primary. Use of compromised credentials without MFA does not establish how those credentials were acquired.
- **Subtypes/tags:** theft; ransomware; data theft; valid-account abuse; no MFA
- **Historical confidence:** high · **Original label:** theft, SEV1
- **Sources:** [1](https://www.reuters.com/technology/cybersecurity/unitedhealth-hackers-took-advantage-citrix-vulnerabilty-break-ceo-says-2024-04-29/) · [2](https://www.finance.senate.gov/imo/media/doc/0501_witty_testimony.pdf) · [3](https://www.finance.senate.gov/hearings/hacking-americas-health-care-assessing-the-change-healthcare-cyber-attack-and-whats-next) · [4](https://www.congress.gov/118/meeting/house/117242/witnesses/HHRG-118-IF02-Wstate-WittyS-20240501-U5.pdf) · [5](https://nationalcioreview.com/articles-insights/extra-bytes/unitedhealth-ceo-testifies-before-congress-regarding-massive-security-breach/)

## Integration boundary

Use `data/ocean-menu-taxonomy.json` for the complete menu projection, joined by original ID. All 50 have a depth. Keep `uncertaintyBadge`, `depthBasis` and `classificationScope` visible when integrating it. Original root/local-ocean data, the live renderer and sandbox scenarios have not been migrated or rebuilt.
