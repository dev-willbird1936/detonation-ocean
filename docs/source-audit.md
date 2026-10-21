# Claim-level historical source audit

**Scope:** all 50 current records in `data/attacks.json`. Each current `summary` was compared against the linked historical source material or an accessible primary/credible alternative. The notes below point to the material facts the sources support and call out where the record deliberately limits a claim. See the [source-passage appendix](source-audit-excerpts.md) for extracted evidence snippets by record.

**Method:** sourceCheck returned `unclear` for many records because its semantic assessor was unavailable; those automated verdicts were not treated as fact checks. The source passages and source-specific findings were manually reviewed. Every record retains clickable `source_urls` in the JSON and the timeline drawer. This is an internal review ledger, not independent expert certification; readers should use the linked source pages for full context.

**Safety:** the review used historical reports and advisories only. No malware samples, payloads, exploit code, or real vulnerable software were downloaded or executed.

## pccyborg-1989 — PC Cyborg (AIDS Trojan) (1989)

**Review status:** Cross-checked
**Current claim:** An early ransomware Trojan, distributed on mailed AIDS-information floppy disks. After roughly ninety boots it hid directories, scrambled file names rather than file contents, and demanded $189 or $378 for a license renewal to a P.O. Box in Panama.
**Cross-check note:** WatchGuard’s technical history supports the 90-reboot trigger, hiding of directories, filename encryption rather than file-content encryption, and the $189/$378 renewal demand. The record avoids saying files were encrypted.
**Sources:** <https://www.watchguard.com/wgrd-security-hub/ransomware-tracker/aids-trojan>

## melissa-1999 — Melissa (1999)

**Review status:** Cross-checked
**Current claim:** An infected Word document triggered a macro worm that used Outlook to send infected copies to the first fifty addresses in the Outlook Address Book. The resulting wave overwhelmed enterprise email systems.
**Cross-check note:** Microsoft’s 2009 Security Intelligence Report directly describes the Word 97 macro trigger, Outlook mass-mailing to the first 50 addresses, and the resulting email-system disruption. SEI/CERT discusses possible incidental document exposure; the entry does not characterize Melissa as an attacker-directed data-theft operation.
**Sources:** <https://www.fbi.gov/news/stories/melissa-virus-20th-anniversary-032519> · <https://news.microsoft.com/source/1999/03/30/alert-on-macro-virus-issues/> · <https://www.microsoft.com/en-us/wdsi/threats/malware-encyclopedia-description?Name=Virus%3AW97M%2FMelissa.A> · <https://www.sei.cmu.edu/documents/2648/1999_102_001_413932.pdf> · <https://commdocs.house.gov/committees/science/hsy131170.000/hsy131170_1.HTM> · <https://www.justice.gov/archive/criminal/cybercrime/press-releases/2002/melissaSent.htm> · <https://cdn-dynmedia-1.microsoft.com/is/content/microsoftcorp/microsoft/final/en-us/microsoft-brand/documents/Microsoft_Security_Intelligence_Report_volume_7_Jan-Jun2009.pdf>

## iloveyou-2000 — ILOVEYOU (Love Bug) (2000)

**Review status:** Cross-checked
**Current claim:** A VBScript mass-mailing worm spread as an email attachment and through IRC. Microsoft's retrospective says it infected millions of computers in 2000 and could download, overwrite, delete, infect, and run files.
**Cross-check note:** Microsoft’s 2009 Security Intelligence Report identifies the 2000 LoveLetter worm, its `ILOVEYOU` mail subject, email-attachment and IRC spread, and file operations. The current summary omits the weaker early infection-count estimates and the more specific file-shadowing narrative.
**Sources:** <https://www.microsoft.com/en-us/wdsi/threats/malware-encyclopedia-description?Name=Virus%3AVBS%2FLoveLetter&threatId=-2147428236> · <https://web.archive.org/web/20001204063700/http://www.cert.org/advisories/CA-2000-04.html> · <https://www.virusbulletin.com/virusbulletin/2015/05/throwback-thursday-when-love-came-town-june-2000> · <https://commdocs.house.gov/committees/science/hsy131170.000/hsy131170_1.HTM> · <https://cdn-dynmedia-1.microsoft.com/is/content/microsoftcorp/microsoft/final/en-us/microsoft-brand/documents/Microsoft_Security_Intelligence_Report_volume_7_Jan-Jun2009.pdf>

## blaster-2003 — Blaster (MSBlast) (2003)

**Review status:** Cross-checked
**Current claim:** MSBlast exploited the Windows RPC/DCOM vulnerability addressed by MS03-026 and spread over open RPC ports without user action.
**Cross-check note:** Microsoft’s MS03-026 bulletin identifies the RPC/DCOM vulnerability; Microsoft’s Blaster alert says the worm spread over open RPC ports and defines worms as spreading without user action. The former summary’s shutdown-countdown detail was removed because it was not needed for this claim.
**Sources:** <https://learn.microsoft.com/en-us/security-updates/securitybulletins/2003/ms03-026> · <https://learn.microsoft.com/en-us/troubleshoot/windows-server/security-and-malware/blaster-worm-virus-alert>

## slammer-2003 — SQL Slammer (2003)

**Review status:** Cross-checked
**Current claim:** Memory-resident worm propagated over UDP port 1434 and spread worldwide in roughly ten minutes. It carried no destructive payload; the damage came from scanning congestion and resulting outages.
**Cross-check note:** Microsoft’s MS02-039 bulletin identifies the SQL Server Resolution Service on UDP port 1434; CAIDA says the vulnerability was exploitable with a single UDP 1434 packet, measured worldwide spread in about ten minutes and reports no destructive payload.
**Sources:** <https://www.caida.org/archive/sapphire/> · <https://learn.microsoft.com/en-us/security-updates/securitybulletins/2002/ms02-039>

## mydoom-2004 — Mydoom (2004)

**Review status:** Cross-checked
**Current claim:** Mydoom was a mass-mailing worm; some variants spread through peer-to-peer networks, acted as backdoors, and could launch denial-of-service attacks. Its email lures varied by version.
**Cross-check note:** Microsoft’s Security Intelligence Report describes Mydoom as a mass-mailing worm, notes peer-to-peer spread in some variants, and lists backdoor and denial-of-service behavior. F-Secure’s Mydoom.M analysis supports the narrower variant-specific lure used in the reconstructed front-end.
**Sources:** <https://www.microsoft.com/en-us/wdsi/threats/malware-encyclopedia-description?Name=Win32%2FMydoom> · <https://www.f-secure.com/v-descs/mydoom-m> · <https://cdn-dynmedia-1.microsoft.com/is/content/microsoftcorp/microsoft/final/en-us/microsoft-brand/documents/Microsoft_Security_Intelligence_Report_volume_7_Jan-Jun2009.pdf>

## sasser-2004 — Sasser worm (2004)

**Review status:** Cross-checked
**Current claim:** Sasser was a network worm that exploited an LSASS vulnerability and spread by randomly scanning IP addresses for vulnerable machines.
**Cross-check note:** Microsoft’s Security Intelligence Report describes Sasser as exploiting the vulnerability addressed by MS04-011 and scanning random IP addresses for vulnerable machines. This replaces earlier TCP-port/FTP details that were not retained in the claim-level excerpt set.
**Sources:** <https://www.microsoft.com/en-us/wdsi/threats/malware-encyclopedia-description?name=Win32%2FSasser> · <https://cdn-dynmedia-1.microsoft.com/is/content/microsoftcorp/microsoft/final/en-us/microsoft-brand/documents/Microsoft_Security_Intelligence_Report_volume_7_Jan-Jun2009.pdf> · <https://learn.microsoft.com/en-us/security-updates/securitybulletins/2004/ms04-011>

## zeus-2007 — Zeus (Zbot) (2007)

**Review status:** Cross-checked
**Current claim:** First identified in 2007 and designed primarily to steal banking data. Zeus became known for browser form grabbing, web injects that changed genuine bank pages, and keylogging; users could be on the real bank site while the browser altered what it displayed.
**Cross-check note:** Sophos and Securelist describe Zbot/Zeus as a banking-data stealer, with browser-based theft and web-injection behavior; Securelist dates variants to 2007. The browser effects are synthetic in this project.
**Sources:** <https://digital.nhs.uk/cyber-alerts/2017/cc-1138> · <https://www.sophos.com/en-us/threat-detection-library/mal/zbot> · <https://securelist.com/zeus-on-the-hunt/36289/>

## tjx-2007 — TJX (T.J. Maxx / Marshalls) (2007)

**Review status:** Cross-checked
**Current claim:** The Canadian Privacy Commissioner’s report records TJX’s view that intruders first accessed its system through wireless LANs at two U.S. stores. The breach exposed payment-card data; the source describes the initial wireless route cautiously.
**Cross-check note:** The Canadian Privacy Commissioner’s report says TJX believed the intruder initially entered through wireless LANs at two U.S. stores. The summary preserves that attribution as TJX’s view rather than an independently established route.
**Sources:** <https://www.priv.gc.ca/en/opc-actions-and-decisions/investigations/investigations-into-businesses/2007/tjx_rep_070925/>

## conficker-2008 — Conficker (2008)

**Review status:** Cross-checked
**Current claim:** Worm that spread via the MS08-067 vulnerability, network shares, and removable media, then used domain generation to keep finding command and control. It proved that a patch existed and was not applied.
**Cross-check note:** CISA and Microsoft document MS08-067, removable-media and share propagation, and the available patch. SRI/USENIX analysis describes the domain-generation/rendezvous mechanism used to seek updates.
**Sources:** <https://www.cisa.gov/news-events/alerts/2009/03/29/conficker-worm-targets-microsoft-windows-systems> · <https://learn.microsoft.com/en-us/security-updates/securitybulletins/2008/ms08-067> · <https://www.usenix.org/event/leet09/tech/full_papers/porras/porras_html>

## stuxnet-2010 — Stuxnet (2010)

**Review status:** Cross-checked
**Current claim:** One of the first widely documented cyberweapons. It propagated through infected USB media and network shares, targeted Siemens STEP7 and WinCC environments, altered PLC logic, and concealed those changes from operators.
**Cross-check note:** CISA documents infected USB/network-share propagation and interaction with Siemens STEP 7/WinCC. The Symantec Stuxnet Dossier documents PLC-payload manipulation and concealment of the altered process state from operators; ENISA describes rootkit concealment on infected WinCC systems. The summary says “one of the first widely documented” cyberweapons, not the first malware ever.
**Sources:** <https://www.cisa.gov/news-events/ics-advisories/icsa-10-272-01> · <https://www.cisa.gov/news-events/ics-advisories/icsa-10-201-01c> · <https://www.enisa.europa.eu/news/enisa-news/stuxnet-analysis> · <https://nsarchive2.gwu.edu/NSAEBB/NSAEBB424/docs/Cyber-044.pdf>

## rsa-2011 — RSA SecurID (2011)

**Review status:** Cross-checked
**Current claim:** RSA disclosed that attackers extracted information related to its SecurID products. Reporting described a spearphishing email with an Excel attachment containing an embedded Flash exploit. RSA warned the information could weaken affected token deployments; its cited company notice did not specify the exact token-seed scope.
**Cross-check note:** RSA’s SEC-filed letter confirms SecurID-related information was extracted and could weaken affected deployments. Ars Technica reports the spear-phishing Excel/Flash chain; the summary no longer claims a precise seed-data scope or share-price effect.
**Sources:** <https://arstechnica.com/information-technology/2011/04/spearphishing-0-day-rsa-hack-not-extremely-sophisticated/> · <https://www.sec.gov/Archives/edgar/data/790070/000119312511070159/dex991.htm> · <https://www.sec.gov/Archives/edgar/data/790070/000119312511070159/dex992.htm>

## shamoon-2012 — Shamoon (Disttrack) (2012)

**Review status:** Cross-checked
**Current claim:** Contemporaneous reporting said a 2012 wiper replaced data on three-quarters of Saudi Aramco's corporate PCs with a burning U.S. flag image. The company said about 30,000 workstations were affected and its main internal network services had been restored.
**Cross-check note:** The August 27, 2012 NYT Bits post reports Saudi Aramco’s chief executive saying a malicious virus from external sources affected about 30,000 workstations and main internal network services were restored; the October 2012 Bits post supplies the three-quarters-of-corporate-PCs and burning-flag image description. No initial-access method is asserted.
**Sources:** <https://www.nytimes.com/2012/10/24/business/global/cyberattack-on-saudi-oil-firm-disquiets-us.html> · <https://archive.nytimes.com/bits.blogs.nytimes.com/2012/08/27/connecting-the-dots-after-cyberattack-on-saudi-aramco/> · <https://www.cisa.gov/sites/default/files/Monitors/ICS-CERT_Monitor_Sep2012.pdf>

## target-2013 — Target (2013)

**Review status:** Cross-checked
**Current claim:** Investigative reporting attributed the intrusion to credentials stolen in an email malware attack at HVAC vendor Fazio Mechanical. Attackers reached Target point-of-sale systems and scraped card data; the precise path from vendor access to POS remained partly unresolved.
**Cross-check note:** Krebs reporting attributes stolen Fazio Mechanical vendor credentials to a malware-laced phishing email and reports subsequent POS card theft. Because the exact route from vendor access to POS was not fully established in the cited reporting, the summary says so.
**Sources:** <https://krebsonsecurity.com/2014/02/target-hackers-broke-in-via-hvac-company/> · <https://krebsonsecurity.com/2014/02/email-attack-on-vendor-set-up-breach-at-target/> · <https://krebsonsecurity.com/2014/01/a-first-look-at-the-target-intrusion-malware/>

## emotet-2014 — Emotet (2014)

**Review status:** Cross-checked
**Current claim:** CISA described Emotet as a modular banking Trojan that could download or drop other malware. It spread through malicious email attachments and links.
**Cross-check note:** CISA’s 2018 advisory describes Emotet as a modular banking Trojan/downloader and malspam delivery. The summary omits claims about specific follow-on families and the first-seen date that are not reproduced in the retained passage excerpt.
**Sources:** <https://www.cisa.gov/news-events/cybersecurity-advisories/aa20-280a> · <https://www.cisa.gov/news-events/alerts/2018/07/20/emotet-malware> · <https://www.microsoft.com/en-us/wdsi/threats/malware-encyclopedia-description?Name=Win32%2FEmotet>

## heartbleed-2014 — Heartbleed (2014)

**Review status:** Cross-checked
**Current claim:** A flaw in OpenSSL's TLS heartbeat handling allowed a remote peer to expose sensitive process memory, potentially including authentication credentials and secret keys.
**Cross-check note:** CISA describes incorrect memory handling in the TLS heartbeat extension and the potential exposure of sensitive data, including credentials and secret keys. The summary omits the numeric memory limit and prevalence/version-history claims.
**Sources:** <https://www.cisa.gov/news-events/alerts/2014/04/08/openssl-heartbleed-vulnerability-cve-2014-0160> · <https://www.netcraft.com/blog/half-a-million-widely-trusted-websites-vulnerable-to-heartbleed-bug>

## sony-2014 — Sony Pictures (2014)

**Review status:** Qualified — medium confidence
**Current claim:** The FBI described system destruction, large-scale theft of personal and commercial data, and threats by the Guardians of Peace; it attributed the intrusion to North Korea. The cited public statement does not establish the initial access route, so none is reconstructed here.
**Cross-check note:** The FBI update attributes the attack to North Korea and describes destroyed systems, stolen personal/commercial data, and Guardians of Peace threats; CISA describes the destructive wiper. The cited public record does not establish initial access, so confidence stays medium and no route is reconstructed.
**Sources:** <https://www.fbi.gov/news/press-releases/update-on-sony-investigation> · <https://www.cisa.gov/news-events/alerts/2014/12/19/targeted-destructive-malware>

## anthem-2015 — Anthem (2015)

**Review status:** Cross-checked
**Current claim:** The Department of Justice alleged that tailored spearphishing emails with hyperlinks downloaded a backdoor, followed by lateral movement and access to Anthem’s enterprise data warehouse. Intruders remained for months before January 2015 exfiltration affecting roughly 78.8 million people.
**Cross-check note:** DOJ’s 2019 announcement describes tailored spearphishing links; the indictment details the backdoor, lateral movement, warehouse access and January 2015 exfiltration. The affected figure is approximately 78.8 million people, not records. These are DOJ allegations in an indictment, not a finding that substitutes for the presumption of innocence.
**Sources:** <https://www.justice.gov/d9/press-releases/attachments/2019/05/09/anthem_indictment_0.pdf> · <https://www.justice.gov/archives/opa/pr/member-sophisticated-china-based-hacking-group-indicted-series-computer-intrusions-including>

## carbanak-2015 — Carbanak (Anunak) (2015)

**Review status:** Cross-checked
**Current claim:** Kaspersky reported spearphishing attachments against bank employees, followed by lateral movement and direct manipulation of banking and ATM systems to transfer funds over time.
**Cross-check note:** Kaspersky Securelist documents spear-phishing attachments against bank employees, lateral movement, and direct manipulation of banking/ATM systems over months. The untraceable anecdotal naming quote was removed.
**Sources:** <https://securelist.com/the-great-bank-robbery-the-carbanak-apt/68732/>

## lookalike-2005 — Lookalike / IDN homograph domains (2005)

**Review status:** Cross-checked
**Current claim:** Mozilla’s February 2005 advisory documented IDN spoofing: some internationalized domain names could resemble trusted names in the address bar. This was a browser-display risk, not a credential leak by itself.
**Date/uncertainty note:** 2005 is the advisory's publication year; the IDN homograph technique predates it.
**Cross-check note:** Mozilla’s February 2005 advisory and Bugzilla record describe IDN homograph spoofing via visually similar internationalized domain names. The date note distinguishes the advisory date from the older technique.
**Sources:** <https://www.mozilla.org/en-US/security/advisories/mfsa2005-29/> · <https://bugzilla.mozilla.org/show_bug.cgi?id=281831>

## opm-2015 — US Office of Personnel Management (2015)

**Review status:** Cross-checked
**Current claim:** The breach exposed personnel and security-clearance records, including background-investigation files. Congressional reporting identifies a compromised KeyPoint user credential, while OPM could not determine how it was initially obtained. No weak-password story is reconstructed here.
**Cross-check note:** House Oversight reporting identifies a compromised KeyPoint user credential; OPM Director testimony confirms background-investigation and security-clearance information was affected and says investigators did not know how the employee’s credentials were compromised. The summary makes no weak-password claim. GAO-17-614 is post-breach oversight context, not the primary credential evidence.
**Sources:** <https://oversight.house.gov/report/opm-data-breach-government-jeopardized-national-security-generation/> · <https://docs.house.gov/meetings/GO/GO00/20150624/103684/HHRG-114-GO00-Transcript-20150624.pdf> · <https://oversight.house.gov/wp-content/uploads/2015/06/2015-06-24-FC-OPM-DATA-BREACH-PART-II.GO175001.pdf> · <https://www.gao.gov/products/gao-17-614>

## ukraine-2015 — Ukrainian power grid (2015)

**Review status:** Cross-checked
**Current claim:** CISA reported malicious Office attachments and said BlackEnergy’s possible role in obtaining legitimate credentials remained under evaluation. It attributed outages to remote cyber intrusions affecting about 225,000 customers; operators restored power manually.
**Cross-check note:** CISA records spearphishing as reported and says BlackEnergy’s possible initial-access role was still being evaluated. It attributes outages to remote intrusions affecting approximately 225,000 customers; the SEL analysis describes unauthorized breaker operations and manual restoration. No confirmed initial-access route is asserted.
**Sources:** <https://attack.mitre.org/campaigns/C0028/> · <https://www.cisa.gov/news-events/ics-alerts/ir-alert-h-16-056-01> · <https://cdn.selinc.com/assets/Literature/Publications/Technical%20Papers/6774_UkraineCyber_DEW_20170130_Web7.pdf?v=20181015-210831>

## mirai-2016 — Mirai (2016)

**Review status:** Cross-checked
**Current claim:** CISA described Mirai as part of a self-propagating botnet built from internet-connected IoT devices and reported that its source code was published online in September 2016, enabling wider use for DDoS attacks.
**Cross-check note:** The retained CISA passage supports the IoT-botnet/DDoS description and the public source-code release. The summary no longer asserts a specific credential-scanning mechanism that is not present in the retained passage.
**Sources:** <https://www.cisa.gov/news-events/alerts/2016/10/14/heightened-ddos-threat-posed-mirai-and-other-botnets>

## smishing-2016 — Smishing / parcel lure (2010s) (2016)

**Review status:** Scoped — technique family/representative date
**Current claim:** This is a technique family rather than one canonical 2016 incident. An SMS carrying a link to a spoofed credential page, delivered because parcel notifications are a real, expected text.
**Date/uncertainty note:** Technique family; “2010s” is the period, not a discrete 2016 incident.
**Cross-check note:** FTC consumer guidance documents fake parcel texts linking to spoofed tracking pages. The date note scopes this as a 2010s technique family rather than a canonical 2016 incident.
**Sources:** <https://consumer.ftc.gov/consumer-alerts/2023/12/fake-shipping-notification-emails-text-messages-what-you-need-know-holiday-season>

## yahoo-cookies-2016 — Yahoo forged cookies 2015–16 (2016)

**Review status:** Cross-checked
**Current claim:** Yahoo disclosed that investigators were examining forged cookies that could let an intruder access accounts without a password. This activity was separate from the 2013 breach affecting more than one billion accounts; the cited notice did not say user passwords were stolen.
**Cross-check note:** Yahoo’s SEC disclosure directly describes forged cookies that could allow password-free account access and separately identifies the 2013 one-billion-account breach. The roughly 32-million estimate from Reuters is omitted from the current summary because the retained SEC passages do not support that figure.
**Sources:** <https://www.sec.gov/Archives/edgar/data/1011006/000119312517065791/d293630d10k.htm> · <https://www.sec.gov/Archives/edgar/data/1011006/000119312516793106/d305610dex991.htm> · <https://ca.finance.yahoo.com/news/yahoo-says-32-million-accounts-233322849.html>

## equifax-2017 — Equifax (2017)

**Review status:** Cross-checked
**Current claim:** Exploitation of an unpatched Apache Struts vulnerability. The patch had been available since March 2017. The certificate on the exposed web service had been expired for nearly ten months.
**Cross-check note:** GAO-18-559 documents the March 2017 Struts alert and reports the inspection certificate had expired about ten months before the breach. The summary ties the certificate to missed encrypted-traffic inspection rather than presenting it as the entry vector.
**Sources:** <https://www.gao.gov/products/gao-18-559> · <https://www.ftc.gov/system/files/documents/cases/172_3203_equifax_complaint_7-22-19.pdf>

## notpetya-2017 — NotPetya (M.E.Doc updater) (2017)

**Review status:** Cross-checked
**Current claim:** Not the "tax forms" document lure. It was delivered through a compromised M.E.Doc software-update mechanism, initially reaching organizations that installed the tainted update; it then spread through affected networks. The update channel was the attack.
**Cross-check note:** Microsoft and Cisco Talos describe the compromised M.E.Doc update channel and subsequent network spread. The summary no longer claims that every organization with M.E.Doc was affected.
**Sources:** <https://www.microsoft.com/en-us/security/blog/2017/06/27/new-ransomware-old-techniques-petya-adds-worm-capabilities/> · <https://blog.talosintelligence.com/the-medoc-connection/>

## vault7-2017 — Vault 7 (2017)

**Review status:** Cross-checked
**Current claim:** A disclosure of CIA cyber-tool material, not a conventional victim compromise. What was published was an inventory: tools, exploits and the targeting categories they supported.
**Cross-check note:** BBC coverage of the March 2017 WikiLeaks disclosure describes alleged CIA hacking-tool documents across consumer platforms. This is categorized as a disclosure, not a conventional victim compromise; no tool files were downloaded.
**Sources:** <https://www.washingtonpost.com/world/national-security/wikileaks-says-it-has-obtained-trove-of-cia-hacking-tools/2017/03/07/c8c50c5c-0345-11e7-b1e9-a05d3c21f7cf_story.html> · <https://www.bbc.com/news/technology-39193008>

## wannacry-2017 — WannaCry (WanaCrypt0r) (2017)

**Review status:** Cross-checked
**Current claim:** A wormable ransomware that spread through unpatched SMBv1 systems using MS17-010. Registering the malware's hard-coded domain interrupted propagation for that strain; Microsoft had released a patch in March 2017. Unpatched NHS systems amplified service disruption.
**Cross-check note:** CISA and Microsoft describe SMBv1 exploitation using MS17-010 and the domain check that curtailed propagation for that strain; NHS reporting documents service disruption. The summary does not say that registering one domain stopped all variants.
**Sources:** <https://www.england.nhs.uk/wp-content/uploads/2018/02/lessons-learned-review-wannacry-ransomware-cyber-attack-cio-review.pdf> · <https://www.cisa.gov/news-events/alerts/2017/05/12/indicators-associated-wannacry-ransomware> · <https://www.microsoft.com/en-us/security/blog/2017/05/12/wannacrypt-ransomware-worm-targets-out-of-date-systems/>

## marriott-2018 — Marriott / Starwood (2018)

**Review status:** Cross-checked
**Current claim:** Investigators found a web shell, remote access tools and credential harvesting, and a long dwell period. The method by which the initial web shell was installed was not determined, and no single old encryption key is presented as the answer here.
**Cross-check note:** The Canadian Privacy Commissioner’s investigation documents a web shell, remote-access tools, credential harvesting, and prolonged access. It explicitly says the initial method for installing the web shell was not determined.
**Sources:** <https://www.priv.gc.ca/en/opc-actions-and-decisions/investigations/investigations-into-businesses/2022/pipeda-2022-005/>

## vpnfilter-2018 — VPNFilter (2018)

**Review status:** Cross-checked
**Current claim:** CISA described a multi-stage implant targeting some routers and network-attached storage devices. It could collect network traffic, including website credentials, and monitor Modbus/SCADA traffic.
**Cross-check note:** CISA’s alert documents collection of network traffic and website credentials and monitoring of Modbus/SCADA protocols on compromised devices. The summary does not imply that every router was affected or that the record proves reboot persistence.
**Sources:** <https://blog.talosintelligence.com/vpnfilter/> · <https://www.cisa.gov/news-events/alerts/2018/05/25/cyber-actors-target-home-and-office-routers-and-networked-devices-worldwide>

## capitalone-2019 — Capital One (WAF misconfiguration, SSRF) (2019)

**Review status:** Cross-checked
**Current claim:** A misconfigured web application firewall allowed a server-side request to reach the cloud instance metadata service and retrieve credentials, which were then used to list and copy object storage. Over a hundred million customers affected.
**Cross-check note:** The DOJ complaint and case materials describe a misconfigured WAF, role credentials obtained through the cloud metadata path, listing/copying storage buckets, and about 100 million affected applicants. The record does not use the complaint to claim a novel AWS infrastructure breach.
**Sources:** <https://www.justice.gov/usao-wdwa/united-states-v-paige-thompson> · <https://www.justice.gov/usao-wdwa/press-release/file/1188626/dl>

## collection1-2019 — Collection #1 (credential compilation) (2019)

**Review status:** Cross-checked
**Current claim:** A compiled collection of roughly 773 million email and password pairs, not itself an intrusion. Its danger is that attackers take each password offline and spray it at every service where the same person has an account.
**Cross-check note:** Troy Hunt’s Collection #1 analysis reports roughly 773 million email addresses and explains credential stuffing as reusing breached username/password pairs elsewhere. The summary treats the compilation as exposure data, not a new intrusion.
**Sources:** <https://www.troyhunt.com/the-773-million-record-collection-1-data-reach/>

## simswap-2020 — SIM swap / SMS OTP interception (2020)

**Review status:** Scoped — technique family/representative date
**Current claim:** A technique rather than a single named incident. Social-engineering a carrier rep transfers a number to another SIM, so the one-time codes the victim expects arrive somewhere else. Carrier-side social engineering is the technique itself.
**Date/uncertainty note:** Technique family; the displayed year is a representative reporting year, not one incident.
**Cross-check note:** FBI IC3 guidance describes social engineering a carrier to transfer a victim’s number to a criminal-controlled SIM. This is a technique entry, not a single named 2020 incident.
**Sources:** <https://www.ic3.gov/PSA/2022/PSA220208>

## solarwinds-2020 — SolarWinds / SUNBURST (2020)

**Review status:** Cross-checked
**Current claim:** SolarWinds said SUNBURST was inserted during the Orion build process, not in its source repository, and shipped in a signed update. CISA describes the malicious code as inserted into the Orion software lifecycle while remaining signed by SolarWinds. SolarWinds reported that up to 18,000 customers could potentially have been vulnerable, based on downloads of the affected versions, and later estimated that fewer than 100 were actually hacked.
**Cross-check note:** SolarWinds’ incident account distinguishes its source repository from the Orion build environment, and says up to 18,000 downloads could have been vulnerable but fewer than 100 customers were actually hacked; CISA documents the software-lifecycle injection and code-signing preservation. The earlier claim that 18,000 customers installed affected updates overstated the SolarWinds passage and was corrected; the prior dwell-time sentence was also removed.
**Sources:** <https://www.cisa.gov/news-events/analysis-reports/ar21-039a> · <https://www.solarwinds.com/blog/an-investigative-update-of-the-cyberattack> · <https://www.cisa.gov/sites/default/files/publications/Supply_Chain_Compromise_Detecting_APT_Activity_from_known_TTPs.pdf>

## colonial-2021 — Colonial Pipeline (2021)

**Review status:** Cross-checked
**Current claim:** Colonial said it believed attackers exploited a legacy VPN profile that was not intended to be active; it used single-factor authentication. Investigators were still determining how the credentials were compromised. Colonial proactively halted operations on May 7, 2021, and PHMSA recorded that a full restart was initiated five days later.
**Cross-check note:** Senate testimony supports the cautiously attributed legacy-profile route and says the credential source remained under investigation; HSGAC’s hearing account records that the profile lacked MFA. DOE records the May 7 halt and PHMSA records that the full restart was initiated in five days. The earlier 5 p.m. ET and “several more days” details were removed because the retained passages do not state them.
**Sources:** <https://www.hsgac.senate.gov/wp-content/uploads/imo/media/doc/Testimony-Blount-2021-06-08.pdf> · <https://www.govinfo.gov/content/pkg/CHRG-117shrg46569/html/CHRG-117shrg46569.htm> · <https://www.hsgac.senate.gov/media/reps/portman-presses-president-and-ceo-of-colonial-pipeline-on-gaps-in-cybersecurity-practices/> · <https://www.energy.gov/ceser/articles/ceser-2021-emergency-response-recap> · <https://www.colpipe.com/news-insights/media-resources/post/media-statement-update-colonial-pipeline-system-disruption/> · <https://www.phmsa.dot.gov/sites/phmsa.dot.gov/files/2022-05/32022026_Colonial_Pipeline_NOPV_PCP_PCO_05052022.pdf>

## log4shell-2021 — Log4Shell (CVE-2021-44228) (2021)

**Review status:** Cross-checked
**Current claim:** A JNDI lookup flaw in Log4j 2 could enable remote code execution when attacker-controlled text was logged and evaluated. The vulnerability was disclosed in December 2021.
**Cross-check note:** CISA describes Log4j’s JNDI/message-lookup flaw and the risk from adversary-controlled lookup endpoints. The summary now omits an unverified specific header example and limits itself to the documented logged-input behavior.
**Sources:** <https://www.cisa.gov/news-events/cybersecurity-advisories/aa21-356a>

## drainer-2022 — Crypto drainer kits (wallet-approval phishing) (2022)

**Review status:** Scoped — technique family/representative date
**Current claim:** Drainer kits masquerade as Web3 projects and abuse wallet approval requests to move assets out. A family of kits, not one breach. The cost to the attacker is a landing page and a signing prompt.
**Date/uncertainty note:** Technique family; 2022 is a representative reporting year, not a single incident.
**Cross-check note:** Chainalysis describes drainer operators posing as Web3 projects and inducing users to approve wallet transactions that grant control of funds. The entry is explicitly a family of approval-phishing kits, not one breach.
**Sources:** <https://www.chainalysis.com/blog/crypto-drainers/>

## lapsus-2022 — LAPSUS$ (Okta / Microsoft / T-Mobile / Uber) (2022)

**Review status:** Cross-checked
**Current claim:** A campaign rather than a single intrusion. Microsoft documents the combination of multi-factor prompt spam, help-desk social engineering, SIM swapping and purchased credentials.
**Cross-check note:** Microsoft documents MFA prompt spamming, help-desk social engineering, SIM swapping, and paid access to credentials/MFA approvals. The unsupported demographic claim was removed.
**Sources:** <https://www.microsoft.com/en-us/security/blog/2022/03/22/dev-0537-criminal-actor-targeting-organizations-for-data-exfiltration-and-destruction/>

## lastpass-2022 — LastPass (2022) (2022)

**Review status:** Cross-checked
**Current claim:** Two incidents. In the first, an engineer’s corporate laptop was compromised and development source code and internal secrets were accessed; LastPass says no customer vault data was in that environment. In the second, the attacker targeted a senior DevOps engineer using vulnerable third-party software and reached cloud backups containing customer vault data, most of it encrypted. The public account does not say that local vault files were copied from the endpoint.
**Cross-check note:** LastPass’s incident notices distinguish the August development-environment compromise from the later cloud-storage incident; they say customer data was not accessed in the first event and describe source-code theft and credentials/keys used against storage volumes later.
**Sources:** <https://blog.lastpass.com/posts/security-incident-update-recommended-actions>

## ukraine-2022 — Viasat KA-SAT disruption (2022) (2022)

**Review status:** Cross-checked
**Current claim:** Viasat says the February 2022 KA-SAT attack exploited a VPN-appliance misconfiguration to reach the trusted management segment, then used legitimate management commands to overwrite modem flash and take tens of thousands of terminals offline. Kyivstar was a separate incident in December 2023 and is not included here.
**Cross-check note:** Viasat’s incident report identifies a VPN-appliance misconfiguration, access to the trusted management segment, lateral movement, and legitimate management commands that overwrote modem flash. It explicitly distinguishes the separate December 2023 Kyivstar incident.
**Sources:** <https://www.viasat.com/perspectives/corporate/2022/ka-sat-network-cyber-attack-overview/>

## moveit-2023 — MOVEit / Cl0p (CVE-2023-34362) (2023)

**Review status:** Cross-checked
**Current claim:** CISA and the FBI said the CL0P group began exploiting a previously unknown SQL injection vulnerability, CVE-2023-34362, in Progress Software's MOVEit Transfer on May 27, 2023, installing the LEMURLOOT web shell to steal data from MOVEit databases. Emsisoft's June 2024 tally of public disclosures counted 2,773 organizations and 95,788,491 individuals affected.
**Cross-check note:** CISA/FBI advisory AA23-158A retains the May 27, 2023 start, the previously unknown SQL injection, LEMURLOOT web shell and data theft from MOVEit databases. Emsisoft’s page retains the 2,773-organization and 95,788,491-individual tally as of June 28, 2024, sourced from public disclosures. The earlier “no authentication or user interaction” sentence was removed because the retained passages do not state it.
**Sources:** <https://nvd.nist.gov/vuln/detail/CVE-2023-34362> · <https://www.cisa.gov/news-events/cybersecurity-advisories/aa23-158a> · <https://www.emsisoft.com/en/blog/44123/unpacking-the-moveit-breach-statistics-and-analysis/>

## oauth-2023 — OAuth consent phishing (AiTM precursor, category) (2023)

**Review status:** Scoped — technique family/representative date
**Current claim:** A technique family, not one breach. The user approves a consent screen that names an application and lists scopes, and grants access without being sent to a fake login at all.
**Date/uncertainty note:** Technique family, not a single 2023 incident.
**Cross-check note:** Microsoft Entra guidance defines consent phishing as tricking a user into granting permissions to a malicious cloud app. The synthetic walkthrough demonstrates the consent mechanism without a fake login or real account.
**Sources:** <https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/protect-against-consent-phishing>

## att-2024 — AT&T (third-party cloud workspace) (2024)

**Review status:** Cross-checked
**Current claim:** AT&T told the SEC that threat actors accessed an AT&T workspace on a third-party cloud platform and, between April 14 and 25, 2024, exfiltrated files of customer call and text records from 2022 and one day in 2023, not call or text content. Reuters reported AT&T's estimate of about 109 million customer accounts. The cited public sources do not establish how access was first obtained.
**Cross-check note:** AT&T’s Form 8-K (retrieved from SEC EDGAR) retains the third-party cloud workspace, April 14–25, 2024 exfiltration window, call/text records (not content) and 2022/2023 record dates. Reuters supplies the roughly 109-million-account estimate (search-result extract; page returned HTTP 401). The Snowflake attribution was dropped from the claim because no retained passage states it; the Senate letter returned HTTP 403.
**Sources:** <https://www.reuters.com/technology/cybersecurity/att-says-data-around-109-mln-us-customer-accounts-illegally-downloaded-2024-07-12/> · <https://www.sec.gov/Archives/edgar/data/732717/000073271724000046/t-20240506.htm> · <https://www.blumenthal.senate.gov/imo/media/doc/2024-07-16_snowflake_breach_att.pdf>

## bec-2024 — Business Email Compromise (invoice thread) (2024)

**Review status:** Scoped — technique family/representative date
**Current claim:** A technique family, not a single 2024 incident. The attacker enters an existing conversation rather than starting a new one, so the thread already looks legitimate and the payment is already urgent.
**Date/uncertainty note:** Technique family, not a single 2024 incident.
**Cross-check note:** FBI guidance describes criminals gaining access to legitimate email threads about billing and invoices; Microsoft documents attackers replying to ongoing payment threads after mailbox compromise. The record is a technique family, not a canonical 2024 incident.
**Sources:** <https://www.fbi.gov/news/stories/business-e-mail-compromise-on-the-rise> · <https://www.ic3.gov/PSA/2024/PSA240911> · <https://www.microsoft.com/en-us/security/blog/2022/07/12/from-cookie-theft-to-bec-attackers-use-aitm-phishing-sites-as-entry-point-to-further-financial-fraud/>

## changehealth-2024 — Change Healthcare (Citrix portal, no MFA) (2024)

**Review status:** Cross-checked
**Current claim:** UnitedHealth CEO Andrew Witty testified that attackers used compromised credentials to access a Change Healthcare Citrix portal without MFA, exfiltrated data, and deployed ransomware nine days later. The outage disrupted claims, pharmacy, and provider-payment services; Witty confirmed at a Senate Finance hearing that UnitedHealth paid a $22 million ransom.
**Cross-check note:** The May 1, 2024 House Energy and Commerce prepared testimony—not the Senate Finance statement—specifies that compromised credentials accessed the Citrix portal without MFA, data was exfiltrated, and ransomware followed nine days later. The $22 million ransom payment, confirmed by Witty at the Senate Finance hearing, is supported by a secondary summary (National CIO Review); the Senate statement and Reuters pages returned HTTP 403/401 and were not retained.
**Sources:** <https://www.reuters.com/technology/cybersecurity/unitedhealth-hackers-took-advantage-citrix-vulnerabilty-break-ceo-says-2024-04-29/> · <https://www.finance.senate.gov/imo/media/doc/0501_witty_testimony.pdf> · <https://www.finance.senate.gov/hearings/hacking-americas-health-care-assessing-the-change-healthcare-cyber-attack-and-whats-next> · <https://www.congress.gov/118/meeting/house/117242/witnesses/HHRG-118-IF02-Wstate-WittyS-20240501-U5.pdf> · <https://nationalcioreview.com/articles-insights/extra-bytes/unitedhealth-ceo-testifies-before-congress-regarding-massive-security-breach/>

## npd-2024 — National Public Data / Infobroker (2024)

**Review status:** Qualified — medium confidence
**Current claim:** Public reporting described an alleged release of billions of records from a background-check data broker; the number of unique people remains unconfirmed. The company's notice said a third party attempted to access its data in late December 2023, but the public record cited here does not establish a specific entry mechanism.
**Date/uncertainty note:** Public disclosure/reporting year; the company's notice said attempted access began in late December 2023.
**Cross-check note:** The House inquiry, Maryland notification, and public reporting support the alleged large record release and late-December-2023 attempted access. The number of unique people and the initial access route remain unconfirmed, so the record retains medium confidence.
**Sources:** <https://www.nytimes.com/2024/08/15/business/social-security-numbers-stolen-hack.html> · <https://oversight.house.gov/wp-content/uploads/2024/08/NPD-Breach-Letter-08222024.pdf> · <https://oag.maryland.gov/resources-info/SBN%20Documents/2024/ITU-375412.pdf>

## quishing-2024 — Quishing (QR-code phishing) (2024)

**Review status:** Scoped — technique family/representative date
**Current claim:** A technique family, not one breach. The Federal Trade Commission documents QR codes on physical media redirecting to spoofed credential-stealing sites, and notes that unlike a link in an email, the destination cannot be read before following it.
**Date/uncertainty note:** Technique family, not a single 2024 incident.
**Cross-check note:** FTC guidance says QR codes can conceal harmful links and lead to spoofed sites. This is a technique family, not a single incident.
**Sources:** <https://consumer.ftc.gov/consumer-alerts/2023/12/scammers-hide-harmful-links-qr-codes-steal-your-information>

## salesforce-2025 — Salesforce / UNC6040 vishing (2025)

**Review status:** Cross-checked
**Current claim:** A campaign, not one incident. Google documents a pattern of voice-phishing callers leading employees to approve a malicious connected application, followed by data being exported with an attacker-controlled tool. Figures circulating about this campaign should be sourced per-campaign rather than merged.
**Cross-check note:** Google Threat Intelligence documents voice-phishing calls that led employees to approve a malicious Salesforce Data Loader connected app and enabled data theft. The entry keeps campaign-specific figures separate.
**Sources:** <https://cloud.google.com/blog/topics/threat-intelligence/voice-phishing-data-extortion>

## sharepoint-2025 — SharePoint ToolShell (CVE-2025-53770) (2025)

**Review status:** Cross-checked
**Current claim:** Microsoft observed exploitation of a deserialisation flaw in the SharePoint ToolPane by unauthenticated requests, followed by web shells being written and the server MachineKey being read and stolen.
**Cross-check note:** Microsoft’s MSRC guidance describes unauthenticated ToolPane exploitation, web-shell activity, and MachineKey retrieval/theft in on-premises SharePoint attacks. The summary is restricted to the observed CVE-2025-53770 activity.
**Sources:** <https://msrc.microsoft.com/update-guide/vulnerability/CVE-2025-53770> · <https://www.microsoft.com/en-us/msrc/blog/2025/07/customer-guidance-for-sharepoint-vulnerability-cve-2025-53770>

## Residual qualifications

Two historical records remain medium confidence: Sony Pictures (attribution and event context are sourced, initial access is not) and National Public Data (alleged record scale is sourced, unique-person count and initial access are not). Technique-family entries are explicitly dated/scoped as categories. No record invents a specific initial-access method where the cited public record does not establish one.