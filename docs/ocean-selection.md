# The 60 main scenarios

> Generated from `data/ocean-selection.json` by `node tools/generate-ocean-selection-doc.mjs`. Edit the JSON, not this file.

This is the main vulnerability list: 12 scenarios per depth, six forced family anchors and six free picks.

## Rules

- **12 per depth, 60 in total.** Depth is the harm tier the attack reached, not historical severity.
- **30 anchors.** Each depth has one forced anchor per vulnerability family. Each anchor is the scenario its creature profile shows (6 families × 5 depths = 30 creature variants).
- **30 free picks.** Six per depth, chosen as the most iconic or well-known for that depth, with no family requirement.
- Entries are incidents, malware families and documented technique variants, not 60 separate CVEs. Family placement of an anchor is an editorial browsing choice; sources establish the victim action.
- Playable scenes are original, fictional reconstructions inspired by these entries. They contain no real payloads, credentials, brands or host effects.

## Evidence status

- **sourced** — a source for the victim action was fetched and read; the link is listed.
- **partial** — the scenario and part of the victim action are sourced; the gap is stated in the note.
- **unsupported** — research found no evidence for this depth or placement (see note). Not yet reclassified.
- **needs-sources** / **provisional** — named but not yet evaluated.

## Sunlight — Clean

### Anchors

| Family · creature | Scenario | Victim action | Status | Sources | Note |
|---|---|---|---|---|---|
| Deception · Anglerfish | **MacDefender (2011)** | Install a fake antivirus | sourced | [1](https://appleinsider.com/articles/11/05/24/apple_posts_instructions_on_how_to_remove_mac_defender_malware) | — |
| Intrusion · Viperfish | **Follina (2022)** | Open a malicious document (document-opening variant only; preview routes are separate) | sourced | [1](https://www.huntress.com/threat-library/vulnerabilities/cve-2022-30190) | — |
| Coordinated abuse · Siphonophore | **Mydoom (2004)** | Run an email attachment | sourced | [1](https://seclists.org/cert/2004/3) [2](https://lists.openwall.net/bugtraq/2004/01/27/27) | — |
| Trusted-source compromise · Isopod host fish | **KeRanger (2016)** | Run the compromised Transmission application | sourced | [1](https://unit42.paloaltonetworks.com/new-os-x-ransomware-keranger-infected-transmission-bittorrent-client-installer/) | — |
| Theft / surveillance · Cookiecutter shark | **Carbanak (2015)** | A bank employee opens a malicious attachment | sourced | [1](https://media.kasperskycontenthub.com/wp-content/uploads/sites/63/2015/02/21032217/Carbanak_APT_eng.pdf) | — |
| Extortion / destruction · Octopus / kraken | **PC Cyborg / AIDS Trojan (1989)** | Load and run a mailed 'AIDS Information' diskette | partial | — | Primary source is the US DOE CIAC bulletin A-10 (19 Dec 1989), served only over plain HTTP so it is not linked as a source: http://ftp.cerias.purdue.edu/pub/advisories/ciac/a-fy90/a-10.ciac-cyborg-trojan-horse . It states the trojan arrived on a mailed "AIDS Information Introductory Diskette" and asks anyone who ran the disk to call CIAC. Delivery was physical post, not email. An HTTPS source has not been found yet. |

### Free picks

| Scenario | Victim action | Status | Sources | Note |
|---|---|---|---|---|
| Melissa (1999) | Open an email attachment | sourced | [1](https://www.justice.gov/archive/criminal/cybercrime/press-releases/2002/melissaSent.htm) | — |
| ILOVEYOU (2000) | Open an email attachment | sourced | [1](https://commdocs.house.gov/committees/science/hsy131170.000/hsy131170_1.HTM) | — |
| Emotet (attachment route) | Open a malicious Word attachment and enable its macros | sourced | [1](https://www.cisa.gov/news-events/alerts/2018/07/20/emotet-malware) [2](https://unit42.paloaltonetworks.com/attack-chain-overview-emotet-in-december-2020-and-january-2021/) | — |
| RSA SecurID (Excel attachment) (2011) | Retrieve a phishing email from the junk folder and open its Excel attachment | sourced | [1](https://threatpost.com/rsa-securid-attack-was-phishing-excel-spreadsheet-040111/75099/) | — |
| CryptoLocker (email-attachment route) (2013) | Open a zipped email attachment and run the executable inside | partial | [1](https://www.cisa.gov/news-events/alerts/2013/11/05/cryptolocker-ransomware-infections) [2](https://www.sophos.com/research/cryptolocker-ransomware) | Email-attachment delivery is established; neither source states the user-opening step explicitly (CISA only advises 'use caution when opening email attachments'). SecureWorks says Gameover Zeus (Upatre ZIP attachment), not direct spam, became the primary distribution route from Oct 2013. The 'email-attachment route' label is fair for early versions. |
| Locky (macro-document route) (2016) | Open a macro-enabled document | sourced | [1](https://www.proofpoint.com/us/threat-insight/post/Dridex-Actors-Get-In-the-Ransomware-Game-With-Locky) [2](https://arstechnica.com/information-technology/2016/02/locky-crypto-ransomware-rides-in-on-malicious-word-document-macro/) | — |

## Twilight — Risky or inconclusive

### Anchors

| Family · creature | Scenario | Victim action | Status | Sources | Note |
|---|---|---|---|---|---|
| Deception · Anglerfish | **0ktapus (2022)** | Enter credentials and authentication codes on a phishing site | sourced | [1](https://www.group-ib.com/blog/0ktapus/) | — |
| Intrusion · Viperfish | **Uber (2022)** | A contractor accepts an attacker-induced MFA request | sourced | [1](https://www.uber.com/newsroom/security-update/) | — |
| Coordinated abuse · Siphonophore | **Tycoon2FA (2023)** | Complete MFA through the mass-phishing campaign's interception branch | sourced | [1](https://www.microsoft.com/en-us/security/blog/2026/03/04/inside-tycoon2fa-how-a-leading-aitm-phishing-kit-operated-at-scale/) | — |
| Trusted-source compromise · Isopod host fish | **Retool (2023)** | A provider employee discloses MFA codes, enabling downstream account takeovers | sourced | [1](https://retool.com/blog/mfa-isnt-mfa) | — |
| Theft / surveillance · Cookiecutter shark | **Dropbox (2022)** | An employee supplies an OTP to a fake CircleCI login page | sourced | [1](https://dropbox.tech/security/a-recent-phishing-campaign-targeting-dropbox) | — |
| Extortion / destruction · Octopus / kraken | **Scattered Spider** | Disclose an OTP or approve an MFA push (no single universal entry route) | sourced | [1](https://www.cisa.gov/news-events/cybersecurity-advisories/aa23-320a) | — |

### Free picks

| Scenario | Victim action | Status | Sources | Note |
|---|---|---|---|---|
| Twitter (2020 employee MFA compromise) (2020) | Employees enter credentials on a vishing-linked phishing site and some approve the resulting MFA request | sourced | [1](https://www.dfs.ny.gov/reports-and-publications/other-reports/Twitter_Report) | — |
| Cisco (2022 MFA approval) (2022) | Accept an attacker-initiated MFA push after vishing calls | sourced | [1](https://blog.talosintelligence.com/recent-cyber-attack/) | — |
| LAPSUS$ (MFA-fatigue variant) (2022) | Approve repeated MFA prompts | sourced | [1](https://www.microsoft.com/en-us/security/blog/2022/03/22/dev-0537-criminal-actor-targeting-organizations-for-data-exfiltration-and-destruction/) | — |
| Reddit (second-factor phishing) (2023) | Enter credentials (and a second-factor token) on a cloned intranet login page | partial | [1](https://www.theregister.com/security/2023/02/10/reddit-reveals-security-incident/303308) [2](https://techcrunch.com/2023/02/10/reddit-says-hackers-accessed-internal-data-following-employee-phishing-attack/) | Reddit's own post (reddit.com) returned a JS challenge and could not be read; redditinc.com summary only says 'obtaining one employee's credentials' with no second-factor detail. Second factor was the attacker's stated aim; Register adds the phished employee had MFA enabled, implying a token was relayed, but no source explicitly says the employee typed a token. Year 2023 confirmed (5 Feb 2023). |
| EvilProxy (MFA-phishing campaigns) (2022) | Sign in (including MFA) on a reverse-proxy phishing page that relays to the real login | sourced | [1](https://www.proofpoint.com/us/blog/email-and-cloud-threats/cloud-account-takeover-campaign-leveraging-evilproxy-targets-top-level) [2](https://www.resecurity.com/blog/article/evilproxy-phishing-as-a-service-with-mfa-bypass-emerged-in-dark-web) | — |
| Midnight Blizzard (Teams-induced MFA approvals) (2023) | Enter an attacker-supplied number-matching code into Microsoft Authenticator after a Teams lure | partial | [1](https://www.microsoft.com/en-us/security/blog/2023/08/02/midnight-blizzard-conducts-targeted-social-engineering-over-microsoft-teams/) | Occurred and Teams lure confirmed. But the detailed flow is code-entry (number matching), not a plain approve-tap: the attacker shows a code, the user types it into Authenticator. Microsoft's summary line says 'approval of MFA prompts', so the original string is loosely supported; the corrected string is more precise. Campaign affected fewer than 40 organisations. |

## Midnight — Steals

### Anchors

| Family · creature | Scenario | Victim action | Status | Sources | Note |
|---|---|---|---|---|---|
| Deception · Anglerfish | **John Podesta (2016)** | Submit a password on a password-reset phishing page | sourced | [1](https://www.justice.gov/usdoj-media/sco-durham/media/1126686/dl?inline) [2](https://www.vox.com/policy-and-politics/2016/10/28/13456368/how-john-podesta-email-got-hacked) [3](https://www.vice.com/en/article/how-hackers-broke-into-john-podesta-and-colin-powells-gmail-accounts/) | — |
| Intrusion · Viperfish | **The Onion (2013)** | Submit credentials to a phishing page | sourced | [1](https://theonion.github.io/blog/2013/05/08/how-the-syrian-electronic-army-hacked-the-onion/) | — |
| Coordinated abuse · Siphonophore | **Twitter "Stalkers app" scam (2011)** | Submit a password to a fake app, so accounts can be used for further promotion and spam | sourced | [1](https://www.theregister.com/security/2011/08/12/twitter-stalker-app-just-a-phishing-scam/940583) | — |
| Trusted-source compromise · Isopod host fish | **PyPI / JuiceLedger (2022)** | A maintainer submits a password (scope: only accounts without additional MFA) | sourced | [1](https://www.sentinelone.com/labs/pypi-phishing-campaign-juiceledger-threat-actor-pivots-from-fake-apps-to-supply-chain-attacks/) | — |
| Theft / surveillance · Cookiecutter shark | **Ryan Collins Apple / Google phishing (2014)** | Submit a password, giving access to private accounts | partial | [1](https://www.theguardian.com/technology/2016/oct/27/nude-celebrity-photos-hacker-prison-sentence-ryan-collins) | Occurrence and password submission are established (>=50 iCloud and 72 Gmail accounts; Nov 2012-Sep 2014). No fetched source says whether victim accounts had two-step verification, so password-ONLY is unestablished, not disproved. DOJ press releases and the sentencing memo could not be extracted (blocked or empty), so none are cited. Keep Midnight placement only with that caveat or find the memo text. |
| Extortion / destruction · Octopus / kraken | **Instagram account-ransom campaign (2021)** | Submit a password; the account is taken over and a payment demanded for its return | sourced | [1](https://www.sophos.com/en-us/blog/ransoms-demanded-for-hijacked-instagram-accounts) | — |

### Free picks

| Scenario | Victim action | Status | Sources | Note |
|---|---|---|---|---|
| Associated Press phishing (2013) | Staff are lured to a fake login page asking for corporate network credentials; AP Twitter accounts were then hijacked (public reporting does not document how the Twitter password itself was obtained) | partial | [1](https://techcrunch.com/2013/04/23/ap-twitter-hack-preceded-by-a-phishing-attempt-news-org-says/) [2](https://arstechnica.com/information-technology/2013/05/twitter-launches-two-factor-authentication-too-late-to-save-the-onion/) | AP confirmed the hack was preceded by phishing on its corporate network, but the quoted internal memo only warns staff ('If you have already ... entered your logon credentials, contact the help desk'); no source confirms a victim submitted a password or that the Twitter password was the credential taken. Twitter had no 2FA until 22 May 2013 (after the 23 Apr hack), so Twitter-side password-only is plausible (researcher inference). AP's own article returned HTTP 403, so not cited. |
| Guardian phishing (2013) | Click a phishing email link to a fake login page and submit a password (Guardian Twitter accounts then hijacked) | partial | [1](https://www.bbc.co.uk/news/uk-22348334) [2](https://www.theguardian.com/technology/2013/apr/29/hacking-guardian-syria-background) | Occurrence and phishing method are established, but the sources describe the SEA's general method; none documents which Guardian staff entered what, or that no extra factor applied. Twitter offered no 2FA until 22 May 2013 (Ars, see AP entry), after this April 2013 incident, so password-only for the Twitter accounts is a reasonable inference, not stated reporting. |
| Financial Times phishing (2013) | Submit a corporate Google Apps password on a fake login page (Twitter and blog access followed from the compromised email accounts) | sourced | [1](https://web.archive.org/web/2013/https://labs.ft.com/2013/05/a-sobering-day/) | — |
| Colin Powell phishing (2016) | Click a spoofed Google security-alert link (the same Bit.ly campaign that hit Podesta); password submission and absence of 2FA are not documented | partial | [1](https://www.vice.com/en/article/how-hackers-broke-into-john-podesta-and-colin-powells-gmail-accounts/) [2](https://arstechnica.com/information-technology/2016/10/russia-linked-phishing-campaign-behind-the-dnc-breach-also-hit-podesta-powell/) [3](https://grahamcluley.com/email-gmail-security-advice-colin-powell/) | Phishing is established by researchers (SecureWorks Bit.ly trail). No source confirms Powell typed a password or lacked 2FA; Cluley's 2FA remark is speculation written before the Bit.ly link was found. Do not claim password-only without extra evidence; consider dropping or labelling provisional. |
| Password-only smishing | Submit a password after a text-message lure | unsupported | — | Documented real smishing campaigns (Smishing Triad toll/USPS lures) harvest card data plus an OTP, i.e. an extra factor, so they belong at Twilight, not Midnight. I found no read-and-confirmed campaign where a victim gave only a password after a text lure. A McAfee 2017 US banking-smishing post surfaced in search but its page timed out and was not read, so it is an unverified lead only. Recommend reclassifying to Twilight or dropping. |
| Password-only quishing | Submit a password after a QR-code lure (no attachment) | unsupported | — | Real quishing campaigns I could read (Sophos incident, Cyble Scanception) are adversary-in-the-middle and capture MFA, so they are Twilight. No documented password-only quishing case found. Recommend reclassifying to Twilight or dropping. The AT&T SOC quishing post returned HTTP 503 and was not read. |

## Abyss — Takes control

### Anchors

| Family · creature | Scenario | Victim action | Status | Sources | Note |
|---|---|---|---|---|---|
| Deception · Anglerfish | **Business email compromise** | Authorise a fraudulent payment | sourced | [1](https://www.ic3.gov/PSA/2017/PSA170504) [2](https://www.ic3.gov/PSA/2024/PSA240911) | — |
| Intrusion · Viperfish | **Operation Aurora (IE vulnerability) (2010)** | Visit a malicious web page (link delivery route not publicly determined) | sourced | [1](https://www.wired.com/2010/01/operation-aurora/) | — |
| Trusted-source compromise · Isopod host fish | **Polyfill.io (2024)** | Load a website containing the compromised third-party script | sourced | [1](https://www.sonatype.com/blog/polyfill.io-supply-chain-attack-hits-100000-websites-all-you-need-to-know) | — |
| Theft / surveillance · Cookiecutter shark | **Cambridge Analytica (2018)** | A quiz participant authorises a Facebook app to access profile data (friends' data was taken without their action) | sourced | [1](https://www.ftc.gov/news-events/news/press-releases/2019/07/ftc-sues-cambridge-analytica-settles-former-ceo-app-developer) | — |
| Extortion / destruction · Octopus / kraken | **UNC6040 / UNC6240 Salesforce campaigns (2025)** | Approve a malicious connected app, followed by data theft and extortion | sourced | [1](https://cloud.google.com/blog/topics/threat-intelligence/voice-phishing-data-extortion) | — |
| Coordinated abuse · Siphonophore | **Google Docs OAuth worm (2017)** | Grant an email-access permission | sourced | [1](https://www.cisa.gov/news-events/alerts/2017/05/04/google-docs-phishing-campaign) | — |

### Free picks

| Scenario | Victim action | Status | Sources | Note |
|---|---|---|---|---|
| Great Cannon (2015) | Visit a page that recruits the browser into DDoS traffic (browser-owner perspective; GitHub, the target, is separate) | sourced | [1](https://citizenlab.ca/research/chinas-great-cannon/) | — |
| Approval-only wallet drainers (2022) | Sign a malicious token-approval transaction on a fake dApp page (no seed phrase disclosed) | sourced | [1](https://www.chainalysis.com/blog/approval-phishing-cryptocurrency-scams-2023/) | — |
| Pegasus / Trident (link-delivered variant) (2016) | Tap a link in a text message (single-click exploit chain; the documented target, Ahmed Mansoor, did not click, so no victim click is documented in this case) | partial | [1](https://citizenlab.ca/research/million-dollar-dissident-iphone-zero-day-nso-group-uae/) | The exploit is link-delivered and needs one click, but Citizen Lab's own test, not a victim, triggered infection. The same report notes WAP Push can open a link with no click. The 2016 case documents a delivery attempt, not a victim action. Keep only with wording that makes this clear, or move to an incident with a confirmed click. |
| Ledger Connect Kit (2023) | Sign a malicious draining transaction (no recovery phrase disclosed) | sourced | [1](https://www.ledger.com/blog/security-incident-report) | — |
| Facebook likejacking (2010) | Click a disguised like button | sourced | [1](https://web.archive.org/web/20130202061513/http://nakedsecurity.sophos.com/2011/03/30/facebook-adds-speed-bump-to-slow-down-likejackers/) [2](https://isc.sans.edu/diary/8893) | — |
| LockBit 3.0 (drive-by-compromise variant) (2022) | Visit a compromised website (technique-level only; no named LockBit 3.0 incident is documented) | partial | [1](https://www.cisa.gov/news-events/cybersecurity-advisories/aa23-165a) | CISA lists drive-by compromise (T1189) as one affiliate initial-access technique among RDP, phishing, valid accounts and exploitation. This is a generic technique table: no incident, no detail on whether the drive-by needed further user interaction. Year 2022 is not stated in the page I read. Thin evidence for a main-list entry. |

## Trench — Destroys

### Anchors

| Family · creature | Scenario | Victim action | Status | Sources | Note |
|---|---|---|---|---|---|
| Deception · Anglerfish | **SIM swapping** | None by the subscriber; the carrier is deceived, bribed or breached instead (subscriber perspective; the carrier employee is the deceived party) | partial | [1](https://www.ic3.gov/PSA/2022/PSA220208) [2](https://www.govinfo.gov/content/pkg/FR-2023-12-08/html/2023-26338.htm) | Subscriber-side no-response holds only for the impersonation, insider and carrier-phishing variants; the carrier employee is the one deceived (IC3 lists all three). Sources do not rule out that the attacker first harvested the subscriber's personal data by other means, so keep the 'subscriber perspective' label. No single year: FBI data covers 2018-2021 and the FCC rule is 2023. |
| Intrusion · Viperfish | **Heartbleed (2014)** | None; the service's OpenSSL library discloses memory to any remote requester (users' credentials leak without their involvement) | sourced | [1](https://www.cisa.gov/news-events/alerts/2014/04/08/openssl-heartbleed-vulnerability-cve-2014-0160) [2](https://heartbleed.com/) | — |
| Coordinated abuse · Siphonophore | **Mirai (2016)** | None; internet-facing devices still on default credentials are infected by automated scanning, with no action by the owner | sourced | [1](https://www.cisa.gov/news-events/alerts/2016/10/14/heightened-ddos-threat-posed-mirai-and-other-botnets) [2](https://www.usenix.org/conference/usenixsecurity17/technical-sessions/presentation/antonakakis) | — |
| Trusted-source compromise · Isopod host fish | **ASUS ShadowHammer (2019)** | None by the user; the backdoored update was delivered by the vendor's own automatic updater (the compromised vendor is the primary victim) | partial | [1](https://securelist.com/operation-shadowhammer/89992/) [2](https://cert.europa.eu/publications/security-advisories/2019-007/) | Two perspectives: the user took no fresh action (CERT-EU: software 'automatically updated'), but the real victim is ASUS, whose servers and signing certificates were abused (Securelist: malicious updaters 'hosted on the official' ASUS update servers). Securelist says 'downloaded and installed' and does not state whether a prompt appeared, so 'no prompt' is my inference. Attack ran Jun-Nov 2018; it was found Jan 2019 and disclosed Mar 2019, so 2019 works as the incident year. ASUS's own statement page did not load content, so it is not cited. |
| Theft / surveillance · Cookiecutter shark | **MOVEit Transfer (2023)** | None; the file-transfer server was exploited through an unauthenticated web flaw and its data stolen (organisation and data-subject perspectives) | sourced | [1](https://www.cisa.gov/news-events/cybersecurity-advisories/aa23-158a) | — |
| Extortion / destruction · Octopus / kraken | **WannaCry (2017)** | None; the worm spreads between unpatched Windows machines over SMBv1 (first-infection route not confirmed) | sourced | [1](https://www.microsoft.com/en-us/security/blog/2017/05/12/wannacrypt-ransomware-worm-targets-out-of-date-systems/) [2](https://www.cisa.gov/news-events/alerts/2017/05/12/indicators-associated-wannacry-ransomware) | — |

### Free picks

| Scenario | Victim action | Status | Sources | Note |
|---|---|---|---|---|
| SQL Slammer (2003) | None; a single UDP packet to an exposed SQL Server infects it, with no response needed from the victim | sourced | [1](https://www.caida.org/catalog/papers/2003_sapphire/) | — |
| Blaster (2003) | None; the worm exploits the Windows RPC/DCOM service and spreads without user action | sourced | [1](https://learn.microsoft.com/en-us/troubleshoot/windows-server/security-and-malware/blaster-worm-virus-alert) [2](https://seclists.org/cert/2003/22) | — |
| Sasser (2004) | None; the worm scans for and exploits the Windows LSASS flaw (MS04-011) on its own | sourced | [1](https://www.microsoft.com/en-us/wdsi/threats/malware-encyclopedia-description?name=Win32%2FSasser) [2](https://isc.sans.edu/diary/181) | — |
| Conficker (network-service variant) (2008) | None (network-service variant only); unpatched Windows Server-service hosts are exploited remotely. USB and share routes are separate | sourced | [1](https://www.cisa.gov/news-events/alerts/2009/03/29/conficker-worm-targets-microsoft-windows-systems) | — |
| Equifax (Struts exploitation) (2017) | None by the affected individuals; Equifax's internet-facing dispute portal was breached through a known Apache Struts flaw (the company's patching failure, not a response to a lure) | partial | [1](https://investor.equifax.com/news-events/press-releases/detail/237/equifax-releases-details-on-cybersecurity-incident) [2](https://www.gao.gov/products/gao-18-559) | Individuals (at least 145.5M per GAO) did nothing, so this holds from their view. From Equifax's view it was a missed patch: the same press release says Equifax's Security organization 'was aware of this vulnerability' in March 2017. That is organisational omission, not a fresh response to a lure. No exploit-chain document was fetched beyond these; the Senate and House reports were seen in search results only and are not cited. |
| Log4Shell (server-side exploitation) (2021) | None; a crafted request to a vulnerable server makes it run attacker code | sourced | [1](https://www.cisa.gov/news-events/cybersecurity-advisories/aa21-356a) | — |

## Status totals

- sourced: 45
- partial: 13
- unsupported: 2
