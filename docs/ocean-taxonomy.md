# Revised ocean catalogue — all 50 entries

**Six visual families; five victim-interaction depths. This is a classification projection, not a renderer or sandbox migration.**

Accounted for: **50**. Placed: **31**. Unknown/mixed entry interaction: **16**. Not applicable: **3**.

Occupied artwork slots: **12/30**, excluding unplaced/reference records. This replaces the earlier arithmetic grouping of legacy labels; it is not a claim that only these combinations exist in the real world.

## Family/depth matrix

| Family | Sunlight | Twilight | Midnight | Abyss | Trench | Unknown | N/A | Total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Deception & Impersonation | 0 | 0 | 2 | 4 | 1 | 1 | 1 | 9 |
| Intrusion & Weaknesses | 0 | 0 | 0 | 0 | 6 | 0 | 0 | 6 |
| Coordinated & Automated Abuse | 4 | 0 | 0 | 0 | 5 | 1 | 0 | 10 |
| Trusted-Source Compromise | 1 | 0 | 0 | 0 | 2 | 1 | 0 | 4 |
| Theft & Surveillance | 1 | 0 | 0 | 0 | 2 | 7 | 2 | 12 |
| Extortion & Destruction | 1 | 0 | 0 | 0 | 2 | 6 | 0 | 9 |

## Important corrections

- SIM swapping is Trench for the subscriber in the carrier-impersonation variant: the carrier is deceived, and the subscriber does not supply the OTP. The earlier assertion that no-action deception cannot exist was too broad.
- Wallet-approval drainers are Abyss in the approval-only variant. A wallet signature is not automatically an MFA code or recovery-secret disclosure.
- Smishing and quishing are Midnight for the described credential-entry variants; opening a spoofed login page alone does not disclose credentials.
- Zeus banking-form entry occurs after endpoint infection; it does not establish the initial malware installation gate.
- Anthem's indictment distinguishes clicking, download and execution without establishing separate victim execution. Ukraine 2015's CISA report leaves BlackEnergy's role in initial access under evaluation.
- Unknown credential provenance, unspecified entry routes and combined multi-route campaigns are not treated as no-action attacks.
- Vault 7 and Collection #1 are disclosures. The IDN/homograph record describes a standalone display risk rather than a completed compromise. These three remain reference entries, not depth-placed attacks.
- Worms such as Melissa, ILOVEYOU, Mydoom and Emotet move to coordinated/automated abuse, while their phishing delivery remains a badge.
- RSA is classified on its authentication-supplier trust lesson; no particular token-seed scope or universal downstream compromise is asserted.

## Placement rules

- **depthIsSeverity:** false
- **categoriesAre:** Visual browsing families, not mutually exclusive CWE classes
- **boundary:** Required victim interaction at the documented scenario boundary: initial access for intrusion cases; authorisation/transaction for fraud-only techniques
- **actorRule:** Never transfer an upstream supplier or carrier employee action to the displayed downstream victim
- **unknownRule:** Missing or mixed entry evidence is unplaced, not Trench
- **subtypeRule:** Keep original subtype, technique and outcome facts as secondary tags
- **scopeRule:** Selected malware/technique variants are explicit; a whole multi-route campaign may remain unplaced
- **applicability:** Disclosures and standalone display-risk references stay outside the five-depth placement
- **evidenceScope:** Curated catalogue descriptions and inherited citations, with focused source checks for SIM swapping, Anthem, Ukraine 2015, VPNFilter and LastPass; not a new independent historical audit of every source
- **integration:** Projection only: original root/local-ocean catalogues, embedded renderers and sandbox scenarios are unchanged

Depth is not impact or attacker sophistication. The original 50 records and historical confidence values are preserved; placement confidence is separate.

## Complete sorted catalogue

### Sunlight — Clean (7)

#### Melissa (1999)

- **ID:** `melissa-1999` · **Family:** Coordinated & Automated Abuse · **Placement confidence:** high
- **Victim perspective:** Employee opening the infected Word document
- **Scope:** Catalogue entry
- **Reason:** Attachment-driven macro execution enables automated mass mailing; propagation is the dominant lesson.
- **Badges:** phishing; phishing delivery; macro worm; email disruption
- **Legacy:** phishing, SEV5; retained, not used as proof of this placement.
- **Sources:** [1](https://www.fbi.gov/news/stories/melissa-virus-20th-anniversary-032519) · [2](https://news.microsoft.com/source/1999/03/30/alert-on-macro-virus-issues/) · [3](https://www.microsoft.com/en-us/wdsi/threats/malware-encyclopedia-description?Name=Virus%3AW97M%2FMelissa.A) · [4](https://www.sei.cmu.edu/documents/2648/1999_102_001_413932.pdf) · [5](https://commdocs.house.gov/committees/science/hsy131170.000/hsy131170_1.HTM) · [6](https://www.justice.gov/archive/criminal/cybercrime/press-releases/2002/melissaSent.htm) · [7](https://cdn-dynmedia-1.microsoft.com/is/content/microsoftcorp/microsoft/final/en-us/microsoft-brand/documents/Microsoft_Security_Intelligence_Report_volume_7_Jan-Jun2009.pdf)

#### ILOVEYOU (Love Bug) (2000)

- **ID:** `iloveyou-2000` · **Family:** Coordinated & Automated Abuse · **Placement confidence:** high
- **Victim perspective:** Recipient opening the script attachment
- **Scope:** Catalogue entry
- **Reason:** User execution starts the mass-mailing worm; overwriting and credential theft remain secondary consequences.
- **Badges:** phishing; phishing delivery; script execution; destructive malware
- **Legacy:** phishing, SEV5; retained, not used as proof of this placement.
- **Sources:** [1](https://www.microsoft.com/en-us/wdsi/threats/malware-encyclopedia-description?Name=Virus%3AVBS%2FLoveLetter&threatId=-2147428236) · [2](https://web.archive.org/web/20001204063700/http://www.cert.org/advisories/CA-2000-04.html) · [3](https://www.virusbulletin.com/virusbulletin/2015/05/throwback-thursday-when-love-came-town-june-2000) · [4](https://commdocs.house.gov/committees/science/hsy131170.000/hsy131170_1.HTM) · [5](https://cdn-dynmedia-1.microsoft.com/is/content/microsoftcorp/microsoft/final/en-us/microsoft-brand/documents/Microsoft_Security_Intelligence_Report_volume_7_Jan-Jun2009.pdf)

#### Mydoom (2004)

- **ID:** `mydoom-2004` · **Family:** Coordinated & Automated Abuse · **Placement confidence:** high
- **Victim perspective:** Recipient executing the email-delivered worm
- **Scope:** Email-attachment variant
- **Reason:** Classified on the documented email-attachment execution route, not every peer-to-peer variant.
- **Badges:** phishing; phishing delivery; mass mailing; denial of service
- **Legacy:** phishing, SEV5; retained, not used as proof of this placement.
- **Sources:** [1](https://www.microsoft.com/en-us/wdsi/threats/malware-encyclopedia-description?Name=Win32%2FMydoom) · [2](https://www.f-secure.com/v-descs/mydoom-m) · [3](https://cdn-dynmedia-1.microsoft.com/is/content/microsoftcorp/microsoft/final/en-us/microsoft-brand/documents/Microsoft_Security_Intelligence_Report_volume_7_Jan-Jun2009.pdf)

#### Emotet (2014)

- **ID:** `emotet-2014` · **Family:** Coordinated & Automated Abuse · **Placement confidence:** high
- **Victim perspective:** Recipient opening a malicious attachment
- **Scope:** Malicious-attachment variant
- **Reason:** Classified on the sourced malicious-file execution variant. Its coordinated delivery platform is primary; do not imply every Emotet link causes one-click execution.
- **Badges:** phishing; phishing delivery; botnet; malware delivery
- **Legacy:** phishing, SEV5; retained, not used as proof of this placement.
- **Sources:** [1](https://www.cisa.gov/news-events/cybersecurity-advisories/aa20-280a) · [2](https://www.cisa.gov/news-events/alerts/2018/07/20/emotet-malware) · [3](https://www.microsoft.com/en-us/wdsi/threats/malware-encyclopedia-description?Name=Win32%2FEmotet)

#### RSA SecurID (2011)

- **ID:** `rsa-2011` · **Family:** Trusted-Source Compromise · **Placement confidence:** medium
- **Victim perspective:** RSA employee targeted at the authentication supplier
- **Scope:** Reported RSA employee attachment route
- **Reason:** Reporting describes an Excel attachment with an embedded exploit. The supplier-trust lesson is primary; do not claim a precise token-seed scope or every downstream customer compromised.
- **Badges:** phishing; spearphishing; document exploitation; authentication-supplier compromise
- **Legacy:** phishing, SEV5; retained, not used as proof of this placement.
- **Sources:** [1](https://arstechnica.com/information-technology/2011/04/spearphishing-0-day-rsa-hack-not-extremely-sophisticated/) · [2](https://www.sec.gov/Archives/edgar/data/790070/000119312511070159/dex991.htm) · [3](https://www.sec.gov/Archives/edgar/data/790070/000119312511070159/dex992.htm)

#### Carbanak (Anunak) (2015)

- **ID:** `carbanak-2015` · **Family:** Theft & Surveillance · **Placement confidence:** high
- **Victim perspective:** Bank employee targeted by a malicious attachment
- **Scope:** Catalogue entry
- **Reason:** The described attachment route enables later banking and ATM theft; the theft operation is the dominant story.
- **Badges:** phishing; spearphishing; malware; financial theft
- **Legacy:** phishing, SEV5; retained, not used as proof of this placement.
- **Sources:** [1](https://securelist.com/the-great-bank-robbery-the-carbanak-apt/68732/)

#### PC Cyborg (AIDS Trojan) (1989)

- **ID:** `pccyborg-1989` · **Family:** Extortion & Destruction · **Placement confidence:** high
- **Victim perspective:** Recipient running the AIDS-information disk program
- **Scope:** Catalogue entry
- **Reason:** Running the delivered program is required; later reboot counting and ransom demands are consequences.
- **Badges:** ransomware; mailed media
- **Legacy:** ransomware, SEV5; retained, not used as proof of this placement.
- **Sources:** [1](https://www.watchguard.com/wgrd-security-hub/ransomware-tracker/aids-trojan)

### Twilight — Risky or inconclusive (0)

No current entry has a verified placement in this tier under these rules.

### Midnight — Steals (2)

#### Smishing / parcel lure (2010s) (2016)

- **ID:** `smishing-2016` · **Family:** Deception & Impersonation · **Placement confidence:** medium
- **Victim perspective:** SMS recipient entering credentials at the spoofed site
- **Scope:** Credential-entry variant, not malware-download variants
- **Reason:** For the credential-page variant described in the entry, following the link alone does not disclose credentials; submission is the decisive action.
- **Badges:** phishing; SMS phishing; credential capture
- **Legacy:** phishing, SEV2; retained, not used as proof of this placement.
- **Sources:** [1](https://consumer.ftc.gov/consumer-alerts/2023/12/fake-shipping-notification-emails-text-messages-what-you-need-know-holiday-season)

#### Quishing (QR-code phishing) (2024)

- **ID:** `quishing-2024` · **Family:** Deception & Impersonation · **Placement confidence:** medium
- **Victim perspective:** QR-code recipient submitting credentials to the spoofed site
- **Scope:** Credential-entry variant, not malware-download variants
- **Reason:** For the described credential-stealing-site variant, scanning/navigation alone is not credential theft. Classify credential submission, not the preliminary QR scan.
- **Badges:** phishing; QR phishing; credential capture
- **Legacy:** phishing, SEV2; retained, not used as proof of this placement.
- **Sources:** [1](https://consumer.ftc.gov/consumer-alerts/2023/12/scammers-hide-harmful-links-qr-codes-steal-your-information)

### Abyss — Takes control (4)

#### Crypto drainer kits (wallet-approval phishing) (2022)

- **ID:** `drainer-2022` · **Family:** Deception & Impersonation · **Placement confidence:** high
- **Victim perspective:** Wallet holder signing the malicious approval
- **Scope:** Approval-only wallet-drainer variant
- **Reason:** The described gate is a wallet authorisation/signature, not supplying an OTP or recovery secret. Keep the high financial impact separate from depth.
- **Badges:** phishing; wallet-approval phishing; financial theft
- **Legacy:** phishing, SEV4; retained, not used as proof of this placement.
- **Sources:** [1](https://www.chainalysis.com/blog/crypto-drainers/)

#### OAuth consent phishing (AiTM precursor, category) (2023)

- **ID:** `oauth-2023` · **Family:** Deception & Impersonation · **Placement confidence:** high
- **Victim perspective:** User granting the malicious connected app access
- **Scope:** Consent-only variant
- **Reason:** The consent-only variant grants access without a fake login, password capture, extra authentication-factor disclosure or downloaded-file execution.
- **Badges:** phishing; OAuth consent; permission abuse
- **Legacy:** phishing, SEV2; retained, not used as proof of this placement.
- **Sources:** [1](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/protect-against-consent-phishing)

#### Business Email Compromise (invoice thread) (2024)

- **ID:** `bec-2024` · **Family:** Deception & Impersonation · **Placement confidence:** medium
- **Victim perspective:** Finance recipient persuaded to authorise a fraudulent payment
- **Scope:** Finance-victim transaction boundary, not mailbox initial access
- **Reason:** Classify the entry's invoice/payment authorisation boundary, not an invented initial compromise of the existing email thread. No attacker-directed credential disclosure or file execution is specified.
- **Badges:** bec; invoice-thread impersonation; payment-authorisation fraud
- **Legacy:** bec, SEV2; retained, not used as proof of this placement.
- **Sources:** [1](https://www.fbi.gov/news/stories/business-e-mail-compromise-on-the-rise) · [2](https://www.ic3.gov/PSA/2024/PSA240911) · [3](https://www.microsoft.com/en-us/security/blog/2022/07/12/from-cookie-theft-to-bec-attackers-use-aitm-phishing-sites-as-entry-point-to-further-financial-fraud/)

#### Salesforce / UNC6040 vishing (2025)

- **ID:** `salesforce-2025` · **Family:** Deception & Impersonation · **Placement confidence:** high
- **Victim perspective:** Employee approving the malicious connected app
- **Scope:** Catalogue entry
- **Reason:** Voice persuasion leads to application authorisation without password theft; data export follows the consent boundary.
- **Badges:** social; vishing; connected-app consent; data theft
- **Legacy:** social, SEV2; retained, not used as proof of this placement.
- **Sources:** [1](https://cloud.google.com/blog/topics/threat-intelligence/voice-phishing-data-extortion)

### Trench — Destroys (18)

#### SIM swap / SMS OTP interception (2020)

- **ID:** `simswap-2020` · **Family:** Deception & Impersonation · **Placement confidence:** high
- **Victim perspective:** Subscriber whose number is reassigned
- **Scope:** Subscriber perspective; carrier-social-engineering variant
- **Reason:** In the selected carrier-impersonation variant, the attacker persuades carrier staff and receives redirected codes. The subscriber does not provide the code or approve MFA. Carrier employees are a different perspective.
- **Badges:** social; carrier impersonation; account recovery abuse; OTP interception
- **Legacy:** social, SEV4; retained, not used as proof of this placement.
- **Sources:** [1](https://www.ic3.gov/PSA/2022/PSA220208)

#### Heartbleed (2014)

- **ID:** `heartbleed-2014` · **Family:** Intrusion & Weaknesses · **Placement confidence:** high
- **Victim perspective:** Operator of the vulnerable TLS service
- **Scope:** Catalogue entry
- **Reason:** Remote heartbeat handling can expose process memory without a victim response.
- **Badges:** vulnerability; software vulnerability; memory disclosure
- **Legacy:** vulnerability, SEV1; retained, not used as proof of this placement.
- **Sources:** [1](https://www.cisa.gov/news-events/alerts/2014/04/08/openssl-heartbleed-vulnerability-cve-2014-0160) · [2](https://www.netcraft.com/blog/half-a-million-widely-trusted-websites-vulnerable-to-heartbleed-bug)

#### Yahoo forged cookies 2015–16 (2016)

- **ID:** `yahoo-cookies-2016` · **Family:** Intrusion & Weaknesses · **Placement confidence:** high
- **Victim perspective:** Yahoo account holder targeted by a forged session
- **Scope:** Catalogue entry
- **Reason:** Forged cookies allow attacker access without the account holder supplying a password or responding.
- **Badges:** exploit; session forgery; authentication bypass
- **Legacy:** exploit, SEV1; retained, not used as proof of this placement.
- **Sources:** [1](https://www.sec.gov/Archives/edgar/data/1011006/000119312517065791/d293630d10k.htm) · [2](https://www.sec.gov/Archives/edgar/data/1011006/000119312516793106/d305610dex991.htm) · [3](https://ca.finance.yahoo.com/news/yahoo-says-32-million-accounts-233322849.html)

#### Equifax (2017)

- **ID:** `equifax-2017` · **Family:** Intrusion & Weaknesses · **Placement confidence:** high
- **Victim perspective:** Operator of the exposed Equifax web application
- **Scope:** Catalogue entry
- **Reason:** Server-side exploitation of the unpatched application needs no victim response; data theft is a secondary outcome.
- **Badges:** exploit; unpatched application; data theft
- **Legacy:** exploit, SEV1; retained, not used as proof of this placement.
- **Sources:** [1](https://www.gao.gov/products/gao-18-559) · [2](https://www.ftc.gov/system/files/documents/cases/172_3203_equifax_complaint_7-22-19.pdf)

#### Capital One (WAF misconfiguration, SSRF) (2019)

- **ID:** `capitalone-2019` · **Family:** Intrusion & Weaknesses · **Placement confidence:** high
- **Victim perspective:** Capital One cloud-environment operator
- **Scope:** Catalogue entry
- **Reason:** The documented server-side request/misconfiguration route needs no victim response; exposed credentials are obtained by the attacker, not typed by the victim.
- **Badges:** exploit; misconfiguration; SSRF; cloud-data theft
- **Legacy:** exploit, SEV1; retained, not used as proof of this placement.
- **Sources:** [1](https://www.justice.gov/usao-wdwa/united-states-v-paige-thompson) · [2](https://www.justice.gov/usao-wdwa/press-release/file/1188626/dl)

#### Log4Shell (CVE-2021-44228) (2021)

- **ID:** `log4shell-2021` · **Family:** Intrusion & Weaknesses · **Placement confidence:** high
- **Victim perspective:** Operator of an application evaluating attacker-controlled logged input
- **Scope:** Catalogue entry
- **Reason:** The server-side lookup flaw can be triggered by attacker input without a victim response.
- **Badges:** vulnerability; software vulnerability; unsafe lookup; remote code execution
- **Legacy:** vulnerability, SEV1; retained, not used as proof of this placement.
- **Sources:** [1](https://www.cisa.gov/news-events/cybersecurity-advisories/aa21-356a)

#### SharePoint ToolShell (CVE-2025-53770) (2025)

- **ID:** `sharepoint-2025` · **Family:** Intrusion & Weaknesses · **Placement confidence:** high
- **Victim perspective:** Operator of the exposed on-premises SharePoint server
- **Scope:** Catalogue entry
- **Reason:** Unauthenticated requests trigger server-side exploitation without a victim response; key theft is a consequence, not a user credential submission.
- **Badges:** exploit; deserialisation; unauthenticated exploitation; signing-key theft
- **Legacy:** exploit, SEV1; retained, not used as proof of this placement.
- **Sources:** [1](https://msrc.microsoft.com/update-guide/vulnerability/CVE-2025-53770) · [2](https://www.microsoft.com/en-us/msrc/blog/2025/07/customer-guidance-for-sharepoint-vulnerability-cve-2025-53770)

#### Blaster (MSBlast) (2003)

- **ID:** `blaster-2003` · **Family:** Coordinated & Automated Abuse · **Placement confidence:** high
- **Victim perspective:** Owner of an exposed Windows host
- **Scope:** Catalogue entry
- **Reason:** Remote service exploitation propagates without a victim click or file execution.
- **Badges:** botnet; network worm; remote service exploitation
- **Legacy:** botnet, SEV1; retained, not used as proof of this placement.
- **Sources:** [1](https://learn.microsoft.com/en-us/security-updates/securitybulletins/2003/ms03-026) · [2](https://learn.microsoft.com/en-us/troubleshoot/windows-server/security-and-malware/blaster-worm-virus-alert)

#### SQL Slammer (2003)

- **ID:** `slammer-2003` · **Family:** Coordinated & Automated Abuse · **Placement confidence:** high
- **Victim perspective:** Operator of a vulnerable SQL Server
- **Scope:** Catalogue entry
- **Reason:** The network-service worm needs no victim response; scanning congestion is the outcome.
- **Badges:** botnet; network worm; service disruption
- **Legacy:** botnet, SEV1; retained, not used as proof of this placement.
- **Sources:** [1](https://www.caida.org/archive/sapphire/) · [2](https://learn.microsoft.com/en-us/security-updates/securitybulletins/2002/ms02-039)

#### Sasser worm (2004)

- **ID:** `sasser-2004` · **Family:** Coordinated & Automated Abuse · **Placement confidence:** high
- **Victim perspective:** Owner of an exposed Windows host
- **Scope:** Catalogue entry
- **Reason:** LSASS exploitation and network scanning do not require a victim response.
- **Badges:** botnet; network worm; remote service exploitation
- **Legacy:** botnet, SEV1; retained, not used as proof of this placement.
- **Sources:** [1](https://www.microsoft.com/en-us/wdsi/threats/malware-encyclopedia-description?name=Win32%2FSasser) · [2](https://cdn-dynmedia-1.microsoft.com/is/content/microsoftcorp/microsoft/final/en-us/microsoft-brand/documents/Microsoft_Security_Intelligence_Report_volume_7_Jan-Jun2009.pdf) · [3](https://learn.microsoft.com/en-us/security-updates/securitybulletins/2004/ms04-011)

#### Conficker (2008)

- **ID:** `conficker-2008` · **Family:** Coordinated & Automated Abuse · **Placement confidence:** high
- **Victim perspective:** Owner of a vulnerable Windows network host
- **Scope:** MS08-067 network-service variant
- **Reason:** The selected MS08-067 network-service propagation route requires no victim response; removable-media and share variants are not silently assigned this depth.
- **Badges:** botnet; network worm; unpatched service; removable-media alternatives
- **Legacy:** botnet, SEV1; retained, not used as proof of this placement.
- **Sources:** [1](https://www.cisa.gov/news-events/alerts/2009/03/29/conficker-worm-targets-microsoft-windows-systems) · [2](https://learn.microsoft.com/en-us/security-updates/securitybulletins/2008/ms08-067) · [3](https://www.usenix.org/event/leet09/tech/full_papers/porras/porras_html)

#### Mirai (2016)

- **ID:** `mirai-2016` · **Family:** Coordinated & Automated Abuse · **Placement confidence:** high
- **Victim perspective:** Owner of an internet-connected device
- **Scope:** Catalogue entry
- **Reason:** The selected self-propagating IoT botnet route does not require its owner to submit a password or respond to a lure.
- **Badges:** botnet; IoT botnet; denial of service
- **Legacy:** botnet, SEV1; retained, not used as proof of this placement.
- **Sources:** [1](https://www.cisa.gov/news-events/alerts/2016/10/14/heightened-ddos-threat-posed-mirai-and-other-botnets)

#### NotPetya (M.E.Doc updater) (2017)

- **ID:** `notpetya-2017` · **Family:** Trusted-Source Compromise · **Placement confidence:** medium
- **Victim perspective:** Organisation receiving the compromised M.E.Doc updater payload
- **Scope:** Compromised updater mechanism
- **Reason:** Classified on the updater-delivery mechanism, not a fictitious tax-document lure. It does not generalise no-action entry to every manually installed package.
- **Badges:** supply-chain; compromised update; wiper; network propagation
- **Legacy:** supply-chain, SEV1; retained, not used as proof of this placement.
- **Sources:** [1](https://www.microsoft.com/en-us/security/blog/2017/06/27/new-ransomware-old-techniques-petya-adds-worm-capabilities/) · [2](https://blog.talosintelligence.com/the-medoc-connection/)

#### SolarWinds / SUNBURST (2020)

- **ID:** `solarwinds-2020` · **Family:** Trusted-Source Compromise · **Placement confidence:** medium
- **Victim perspective:** Downstream Orion customer organisation
- **Scope:** Downstream signed-update mechanism
- **Reason:** The signed build/update channel carries the payload. Classify the downstream updater/runtime compromise, not an invented human deception step at the supplier.
- **Badges:** supply-chain; build-process compromise; signed update; espionage
- **Legacy:** supply-chain, SEV1; retained, not used as proof of this placement.
- **Sources:** [1](https://www.cisa.gov/news-events/analysis-reports/ar21-039a) · [2](https://www.solarwinds.com/blog/an-investigative-update-of-the-cyberattack) · [3](https://www.cisa.gov/sites/default/files/publications/Supply_Chain_Compromise_Detecting_APT_Activity_from_known_TTPs.pdf)

#### TJX (T.J. Maxx / Marshalls) (2007)

- **ID:** `tjx-2007` · **Family:** Theft & Surveillance · **Placement confidence:** medium
- **Victim perspective:** TJX store and corporate-network operators
- **Scope:** Reported wireless-entry route
- **Reason:** Classified on the reported external wireless-entry route; no employee response is required by that route. Reporting describes the route cautiously.
- **Badges:** card-fraud; payment-card theft; wireless access
- **Legacy:** card-fraud, SEV1; retained, not used as proof of this placement.
- **Sources:** [1](https://www.priv.gc.ca/en/opc-actions-and-decisions/investigations/investigations-into-businesses/2007/tjx_rep_070925/)

#### MOVEit / Cl0p (CVE-2023-34362) (2023)

- **ID:** `moveit-2023` · **Family:** Theft & Surveillance · **Placement confidence:** high
- **Victim perspective:** Operator of the exposed MOVEit Transfer application
- **Scope:** Catalogue entry
- **Reason:** Unauthenticated application exploitation enables bulk data theft. Retain SQL injection as a technique badge rather than losing the exfiltration lesson.
- **Badges:** exploit; SQL injection; web shell; bulk-data theft
- **Legacy:** exploit, SEV1; retained, not used as proof of this placement.
- **Sources:** [1](https://nvd.nist.gov/vuln/detail/CVE-2023-34362) · [2](https://www.cisa.gov/news-events/cybersecurity-advisories/aa23-158a) · [3](https://www.emsisoft.com/en/blog/44123/unpacking-the-moveit-breach-statistics-and-analysis/)

#### WannaCry (WanaCrypt0r) (2017)

- **ID:** `wannacry-2017` · **Family:** Extortion & Destruction · **Placement confidence:** high
- **Victim perspective:** Operator of a vulnerable SMB service
- **Scope:** Catalogue entry
- **Reason:** Wormable service exploitation enables encryption without a victim click, password submission or file launch.
- **Badges:** ransomware; network worm; unpatched service
- **Legacy:** ransomware, SEV1; retained, not used as proof of this placement.
- **Sources:** [1](https://www.england.nhs.uk/wp-content/uploads/2018/02/lessons-learned-review-wannacry-ransomware-cyber-attack-cio-review.pdf) · [2](https://www.cisa.gov/news-events/alerts/2017/05/12/indicators-associated-wannacry-ransomware) · [3](https://www.microsoft.com/en-us/security/blog/2017/05/12/wannacrypt-ransomware-worm-targets-out-of-date-systems/)

#### Viasat KA-SAT disruption (2022) (2022)

- **ID:** `ukraine-2022` · **Family:** Extortion & Destruction · **Placement confidence:** high
- **Victim perspective:** Viasat KA-SAT network operator
- **Scope:** Catalogue entry
- **Reason:** The documented VPN-appliance misconfiguration enables entry into the trusted management segment without victim response; subsequent modem disruption is the outcome.
- **Badges:** exploit; network misconfiguration; management-plane abuse; service disruption
- **Legacy:** exploit, SEV1; retained, not used as proof of this placement.
- **Sources:** [1](https://www.viasat.com/perspectives/corporate/2022/ka-sat-network-cyber-attack-overview/)

### Unplaced — unknown or mixed entry interaction (16)

#### LAPSUS$ (Okta / Microsoft / T-Mobile / Uber) (2022)

- **ID:** `lapsus-2022` · **Family:** Deception & Impersonation · **Placement confidence:** mixed
- **Victim perspective:** Victims across the named LAPSUS$ campaign
- **Scope:** Whole multi-route campaign; no single variant selected
- **Reason:** The entry combines MFA fatigue, help-desk deception, SIM swapping and purchased credentials. No single required action is established for the whole combined campaign.
- **Badges:** social; MFA fatigue; help-desk impersonation; SIM swapping; purchased credentials
- **Legacy:** social, SEV2; retained, not used as proof of this placement.
- **Sources:** [1](https://www.microsoft.com/en-us/security/blog/2022/03/22/dev-0537-criminal-actor-targeting-organizations-for-data-exfiltration-and-destruction/)

#### VPNFilter (2018)

- **ID:** `vpnfilter-2018` · **Family:** Coordinated & Automated Abuse · **Placement confidence:** unknown
- **Victim perspective:** Owner of the compromised router or NAS
- **Scope:** Whole implant campaign
- **Reason:** Talos states it was unsure of the particular exploit used in any given case. Known exploits and default credentials are possibilities, not a proven interaction classification.
- **Badges:** botnet; router implant; coordinated infrastructure; traffic surveillance
- **Legacy:** botnet, SEV1; retained, not used as proof of this placement.
- **Sources:** [1](https://blog.talosintelligence.com/vpnfilter/) · [2](https://www.cisa.gov/news-events/alerts/2018/05/25/cyber-actors-target-home-and-office-routers-and-networked-devices-worldwide)

#### Target (2013)

- **ID:** `target-2013` · **Family:** Trusted-Source Compromise · **Placement confidence:** unknown
- **Victim perspective:** Target as downstream customer of Fazio Mechanical
- **Scope:** Target downstream compromise, not supplier phishing
- **Reason:** Vendor credential theft and downstream POS theft are established; the curated record leaves the access path partly unresolved. Do not assign the vendor employee's email action to Target.
- **Badges:** supply-chain; supplier credentials; POS malware; payment-card theft
- **Legacy:** supply-chain, SEV2; retained, not used as proof of this placement.
- **Sources:** [1](https://krebsonsecurity.com/2014/02/target-hackers-broke-in-via-hvac-company/) · [2](https://krebsonsecurity.com/2014/02/email-attack-on-vendor-set-up-breach-at-target/) · [3](https://krebsonsecurity.com/2014/01/a-first-look-at-the-target-intrusion-malware/)

#### Zeus (Zbot) (2007)

- **ID:** `zeus-2007` · **Family:** Theft & Surveillance · **Placement confidence:** unknown
- **Victim perspective:** Banking user whose endpoint or browser becomes infected
- **Scope:** Whole malware-family entry
- **Reason:** Typing a banking password after infection is not initial access. The broad malware entry does not establish one required installation route.
- **Badges:** phishing; banking Trojan; form grabbing; keylogging
- **Legacy:** phishing, SEV3; retained, not used as proof of this placement.
- **Sources:** [1](https://digital.nhs.uk/cyber-alerts/2017/cc-1138) · [2](https://www.sophos.com/en-us/threat-detection-library/mal/zbot) · [3](https://securelist.com/zeus-on-the-hunt/36289/)

#### Anthem (2015)

- **ID:** `anthem-2015` · **Family:** Theft & Surveillance · **Placement confidence:** unknown
- **Victim perspective:** Employee of the affected Anthem subsidiary
- **Scope:** Indictment paragraph 14(a) initial delivery
- **Reason:** The indictment distinguishes clicking a hyperlink, downloading a file and executing it. It does not establish whether the victim separately ran the file; one-click-only and manual-file execution are both unproven.
- **Badges:** espionage; spearphishing; backdoor; data exfiltration
- **Legacy:** espionage, SEV2; retained, not used as proof of this placement.
- **Sources:** [1](https://www.justice.gov/d9/press-releases/attachments/2019/05/09/anthem_indictment_0.pdf) · [2](https://www.justice.gov/archives/opa/pr/member-sophisticated-china-based-hacking-group-indicted-series-computer-intrusions-including)

#### US Office of Personnel Management (2015)

- **ID:** `opm-2015` · **Family:** Theft & Surveillance · **Placement confidence:** unknown
- **Victim perspective:** OPM organisation and the compromised delegated identity
- **Scope:** Initial compromised-identity provenance
- **Reason:** The KeyPoint credential was compromised, but how it was obtained was not determined. A compromised credential is neither proof of victim password submission nor proof of no victim action.
- **Badges:** espionage; contractor identity; sensitive-record theft
- **Legacy:** espionage, SEV1; retained, not used as proof of this placement.
- **Sources:** [1](https://oversight.house.gov/report/opm-data-breach-government-jeopardized-national-security-generation/) · [2](https://docs.house.gov/meetings/GO/GO00/20150624/103684/HHRG-114-GO00-Transcript-20150624.pdf) · [3](https://oversight.house.gov/wp-content/uploads/2015/06/2015-06-24-FC-OPM-DATA-BREACH-PART-II.GO175001.pdf) · [4](https://www.gao.gov/products/gao-17-614)

#### Marriott / Starwood (2018)

- **ID:** `marriott-2018` · **Family:** Theft & Surveillance · **Placement confidence:** unknown
- **Victim perspective:** Marriott/Starwood organisation
- **Scope:** Initial web-shell placement
- **Reason:** The source explicitly leaves installation of the initial web shell undetermined; later tools and stolen data do not establish the entry interaction.
- **Badges:** theft; web shell; credential harvesting; long dwell
- **Legacy:** theft, SEV1; retained, not used as proof of this placement.
- **Sources:** [1](https://www.priv.gc.ca/en/opc-actions-and-decisions/investigations/investigations-into-businesses/2022/pipeda-2022-005/)

#### LastPass (2022) (2022)

- **ID:** `lastpass-2022` · **Family:** Theft & Surveillance · **Placement confidence:** mixed
- **Victim perspective:** LastPass staff and backup environments across two incidents
- **Scope:** Combined two-incident entry
- **Reason:** The entry combines two compromises. Third-party exploitation and later secret access are documented, but this combined record does not establish one decisive victim-action gate. Do not place later authentication at initial access.
- **Badges:** exploit; third-party vulnerability; privileged endpoint; backup-data theft
- **Legacy:** exploit, SEV1; retained, not used as proof of this placement.
- **Sources:** [1](https://blog.lastpass.com/posts/security-incident-update-recommended-actions)

#### AT&T (third-party cloud workspace) (2024)

- **ID:** `att-2024` · **Family:** Theft & Surveillance · **Placement confidence:** unknown
- **Victim perspective:** AT&T cloud-workspace victim
- **Scope:** Initial workspace entry
- **Reason:** Exfiltration from the workspace is documented, but the cited record does not establish how initial access was obtained.
- **Badges:** theft; third-party cloud workspace; metadata theft
- **Legacy:** theft, SEV1; retained, not used as proof of this placement.
- **Sources:** [1](https://www.reuters.com/technology/cybersecurity/att-says-data-around-109-mln-us-customer-accounts-illegally-downloaded-2024-07-12/) · [2](https://www.sec.gov/Archives/edgar/data/732717/000073271724000046/t-20240506.htm) · [3](https://www.blumenthal.senate.gov/imo/media/doc/2024-07-16_snowflake_breach_att.pdf)

#### National Public Data / Infobroker (2024)

- **ID:** `npd-2024` · **Family:** Theft & Surveillance · **Placement confidence:** unknown
- **Victim perspective:** National Public Data organisation
- **Scope:** Initial organisation compromise
- **Reason:** The public record cited in the catalogue does not establish a specific entry mechanism; do not equate an alleged data release with no-action access.
- **Badges:** theft; data broker; alleged data release
- **Legacy:** theft, SEV1; retained, not used as proof of this placement.
- **Sources:** [1](https://www.nytimes.com/2024/08/15/business/social-security-numbers-stolen-hack.html) · [2](https://oversight.house.gov/wp-content/uploads/2024/08/NPD-Breach-Letter-08222024.pdf) · [3](https://oag.maryland.gov/resources-info/SBN%20Documents/2024/ITU-375412.pdf)

#### Stuxnet (2010)

- **ID:** `stuxnet-2010` · **Family:** Extortion & Destruction · **Placement confidence:** unknown
- **Victim perspective:** Operator of the targeted industrial-control environment
- **Scope:** Initial industrial-victim compromise
- **Reason:** Industrial process manipulation is the dominant lesson. USB/network propagation does not establish the initial compromise path into the selected industrial victim.
- **Badges:** supply-chain; industrial sabotage; USB propagation; network propagation; signed malware
- **Legacy:** supply-chain, SEV1; retained, not used as proof of this placement.
- **Sources:** [1](https://www.cisa.gov/news-events/ics-advisories/icsa-10-272-01) · [2](https://www.cisa.gov/news-events/ics-advisories/icsa-10-201-01c) · [3](https://www.enisa.europa.eu/news/enisa-news/stuxnet-analysis) · [4](https://nsarchive2.gwu.edu/NSAEBB/NSAEBB424/docs/Cyber-044.pdf)

#### Shamoon (Disttrack) (2012)

- **ID:** `shamoon-2012` · **Family:** Extortion & Destruction · **Placement confidence:** unknown
- **Victim perspective:** Saudi Aramco corporate-network victim
- **Scope:** 2012 incident entry
- **Reason:** The cited description establishes wiping and disruption, not the decisive initial-access interaction. Destruction is not proof of no-action entry.
- **Badges:** wiper; service disruption
- **Legacy:** wiper, SEV1; retained, not used as proof of this placement.
- **Sources:** [1](https://www.nytimes.com/2012/10/24/business/global/cyberattack-on-saudi-oil-firm-disquiets-us.html) · [2](https://archive.nytimes.com/bits.blogs.nytimes.com/2012/08/27/connecting-the-dots-after-cyberattack-on-saudi-aramco/) · [3](https://www.cisa.gov/sites/default/files/Monitors/ICS-CERT_Monitor_Sep2012.pdf)

#### Sony Pictures (2014)

- **ID:** `sony-2014` · **Family:** Extortion & Destruction · **Placement confidence:** unknown
- **Victim perspective:** Sony Pictures organisation
- **Scope:** Organisation incident entry
- **Reason:** Observed destruction, theft and threats make destructive/extortion impact primary. The FBI statement does not establish initial access.
- **Badges:** espionage; data theft; destructive malware; threats
- **Legacy:** espionage, SEV1; retained, not used as proof of this placement.
- **Sources:** [1](https://www.fbi.gov/news/press-releases/update-on-sony-investigation) · [2](https://www.cisa.gov/news-events/alerts/2014/12/19/targeted-destructive-malware)

#### Ukrainian power grid (2015)

- **ID:** `ukraine-2015` · **Family:** Extortion & Destruction · **Placement confidence:** unknown
- **Victim perspective:** Affected Ukrainian power-grid operator
- **Scope:** Initial entry leading to the grid incident
- **Reason:** CISA confirms remote breaker operation and disruption but says BlackEnergy's initial-access role was still under evaluation. Do not convert a reported attachment infection into a proven outage-entry gate.
- **Badges:** phishing; industrial disruption; remote administration; reported spearphishing; KillDisk
- **Legacy:** phishing, SEV2; retained, not used as proof of this placement.
- **Sources:** [1](https://attack.mitre.org/campaigns/C0028/) · [2](https://www.cisa.gov/news-events/ics-alerts/ir-alert-h-16-056-01) · [3](https://cdn.selinc.com/assets/Literature/Publications/Technical%20Papers/6774_UkraineCyber_DEW_20170130_Web7.pdf?v=20181015-210831)

#### Colonial Pipeline (2021)

- **ID:** `colonial-2021` · **Family:** Extortion & Destruction · **Placement confidence:** unknown
- **Victim perspective:** Colonial organisation and the compromised VPN identity
- **Scope:** Compromised-identity provenance
- **Reason:** Use of the legacy single-factor VPN account is known; credential acquisition was still under investigation. No-MFA does not prove how the victim identity was first compromised.
- **Badges:** ransomware; valid-account abuse; no MFA
- **Legacy:** ransomware, SEV1; retained, not used as proof of this placement.
- **Sources:** [1](https://www.hsgac.senate.gov/wp-content/uploads/imo/media/doc/Testimony-Blount-2021-06-08.pdf) · [2](https://www.govinfo.gov/content/pkg/CHRG-117shrg46569/html/CHRG-117shrg46569.htm) · [3](https://www.hsgac.senate.gov/media/reps/portman-presses-president-and-ceo-of-colonial-pipeline-on-gaps-in-cybersecurity-practices/) · [4](https://www.energy.gov/ceser/articles/ceser-2021-emergency-response-recap) · [5](https://www.colpipe.com/news-insights/media-resources/post/media-statement-update-colonial-pipeline-system-disruption/) · [6](https://www.phmsa.dot.gov/sites/phmsa.dot.gov/files/2022-05/32022026_Colonial_Pipeline_NOPV_PCP_PCO_05052022.pdf)

#### Change Healthcare (Citrix portal, no MFA) (2024)

- **ID:** `changehealth-2024` · **Family:** Extortion & Destruction · **Placement confidence:** unknown
- **Victim perspective:** Change Healthcare organisation and the compromised Citrix identity
- **Scope:** Compromised-identity provenance
- **Reason:** Ransomware, extortion and service disruption are primary. Use of compromised credentials without MFA does not establish how those credentials were acquired.
- **Badges:** theft; ransomware; data theft; valid-account abuse; no MFA
- **Legacy:** theft, SEV1; retained, not used as proof of this placement.
- **Sources:** [1](https://www.reuters.com/technology/cybersecurity/unitedhealth-hackers-took-advantage-citrix-vulnerabilty-break-ceo-says-2024-04-29/) · [2](https://www.finance.senate.gov/imo/media/doc/0501_witty_testimony.pdf) · [3](https://www.finance.senate.gov/hearings/hacking-americas-health-care-assessing-the-change-healthcare-cyber-attack-and-whats-next) · [4](https://www.congress.gov/118/meeting/house/117242/witnesses/HHRG-118-IF02-Wstate-WittyS-20240501-U5.pdf) · [5](https://nationalcioreview.com/articles-insights/extra-bytes/unitedhealth-ceo-testifies-before-congress-regarding-massive-security-breach/)

### Reference entries — no applicable compromise depth (3)

#### Lookalike / IDN homograph domains (2005)

- **ID:** `lookalike-2005` · **Family:** Deception & Impersonation · **Placement confidence:** high
- **Victim perspective:** Browser user inspecting an apparent origin
- **Scope:** Standalone display-risk technique
- **Reason:** This standalone record describes an address-bar spoofing risk, not a completed credential leak or a single compromise gate. Keep it in reference material rather than inventing a breach depth.
- **Badges:** phishing; IDN homograph; origin-display spoofing
- **Legacy:** phishing, SEV2; retained, not used as proof of this placement.
- **Sources:** [1](https://www.mozilla.org/en-US/security/advisories/mfsa2005-29/) · [2](https://bugzilla.mozilla.org/show_bug.cgi?id=281831)

#### Vault 7 (2017)

- **ID:** `vault7-2017` · **Family:** Theft & Surveillance · **Placement confidence:** high
- **Victim perspective:** No conventional victim compromise represented by this entry
- **Scope:** Catalogue entry
- **Reason:** A published inventory/disclosure is not a documented initial-access event. Its historical placement must not become a no-action attack.
- **Badges:** espionage; disclosure; capability inventory
- **Legacy:** espionage, SEV1; retained, not used as proof of this placement.
- **Sources:** [1](https://www.washingtonpost.com/world/national-security/wikileaks-says-it-has-obtained-trove-of-cia-hacking-tools/2017/03/07/c8c50c5c-0345-11e7-b1e9-a05d3c21f7cf_story.html) · [2](https://www.bbc.com/news/technology-39193008)

#### Collection #1 (credential compilation) (2019)

- **ID:** `collection1-2019` · **Family:** Theft & Surveillance · **Placement confidence:** high
- **Victim perspective:** No single newly compromised victim represented by the compilation
- **Scope:** Catalogue entry
- **Reason:** A compilation of previously exposed credentials is a disclosure, not a fresh intrusion with an established interaction gate.
- **Badges:** theft; credential compilation; disclosure; credential-reuse risk
- **Legacy:** theft, SEV1; retained, not used as proof of this placement.
- **Sources:** [1](https://www.troyhunt.com/the-773-million-record-collection-1-data-reach/)

## Integration boundary

The machine-readable classification is `data/ocean-taxonomy.json`, joined to original records by ID. The original `data/attacks.json` and `local-ocean/data/attacks.json` are unchanged. The current renderer and training scenarios still use their legacy embedded categories/SEV; they do not yet consume this projection. In particular, an unplaced row must not be silently rendered using its old SEV during a future migration.
