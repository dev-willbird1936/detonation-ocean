# Source passage evidence by record

This companion to [the claim-level audit](source-audit.md) collects concise source excerpts where the source extractor retained clean passages, plus directly reviewed passages for historically important claims. For records without a clean extract, it provides the source-specific cross-check note and direct links to cited source pages. The notes, confidence qualifiers, and links cover all 50 records; excerpts are evidence aids, not a third-party expert attestation.

## pccyborg-1989 — PC Cyborg (AIDS Trojan) (1989)

**Current claim:** An early ransomware Trojan, distributed on mailed AIDS-information floppy disks. After roughly ninety boots it hid directories, scrambled file names rather than file contents, and demanded $189 or $378 for a license renewal to a P.O. Box in Panama.

**Data confidence:** high

**Cross-check note:** WatchGuard’s technical history supports the 90-reboot trigger, hiding of directories, filename encryption rather than file-content encryption, and the $189/$378 renewal demand. The record avoids saying files were encrypted.

**Record source URLs:** <https://www.watchguard.com/wgrd-security-hub/ransomware-tracker/aids-trojan>

**Source excerpts:**
- <https://www.watchguard.com/wgrd-security-hub/ransomware-tracker/aids-trojan> — “Once the counter reached 90, the program would prompt the user to renew a license to continue using the system.”
- <https://www.watchguard.com/wgrd-security-hub/ransomware-tracker/aids-trojan> — “A technical analysis by Jim Bates in the 1990 January issue of Virus Bulletin revealed that the program, written in QUICKBASIC 3.0, also encrypted file names (not the files themselves), hid directories, and dropped a ransom note (the license renewal).”
- <https://www.watchguard.com/wgrd-security-hub/ransomware-tracker/aids-trojan> — “The ransom note demanded victims send $189 for one year of the license, or $378 for lifetime access, to a P.O. Box in Panama.”

## melissa-1999 — Melissa (1999)

**Current claim:** An infected Word document triggered a macro worm that used Outlook to send infected copies to the first fifty addresses in the Outlook Address Book. The resulting wave overwhelmed enterprise email systems.

**Data confidence:** high

**Cross-check note:** Microsoft’s 2009 Security Intelligence Report directly describes the Word 97 macro trigger, Outlook mass-mailing to the first 50 addresses, and the resulting email-system disruption. SEI/CERT discusses possible incidental document exposure; the entry does not characterize Melissa as an attacker-directed data-theft operation.

**Record source URLs:** <https://www.fbi.gov/news/stories/melissa-virus-20th-anniversary-032519> · <https://news.microsoft.com/source/1999/03/30/alert-on-macro-virus-issues/> · <https://www.microsoft.com/en-us/wdsi/threats/malware-encyclopedia-description?Name=Virus%3AW97M%2FMelissa.A> · <https://www.sei.cmu.edu/documents/2648/1999_102_001_413932.pdf> · <https://commdocs.house.gov/committees/science/hsy131170.000/hsy131170_1.HTM> · <https://www.justice.gov/archive/criminal/cybercrime/press-releases/2002/melissaSent.htm> · <https://cdn-dynmedia-1.microsoft.com/is/content/microsoftcorp/microsoft/final/en-us/microsoft-brand/documents/Microsoft_Security_Intelligence_Report_volume_7_Jan-Jun2009.pdf>

**Source excerpts:**
- <https://cdn-dynmedia-1.microsoft.com/is/content/microsoftcorp/microsoft/final/en-us/microsoft-brand/documents/Microsoft_Security_Intelligence_Report_volume_7_Jan-Jun2009.pdf> — “When the infected document was opened in Word 97, W97M/Melissa copied itself to the Normal.dot template file that loads by default when Word is opened so that any subsequent documents created by the user would also be infected by the virus.”
- <https://cdn-dynmedia-1.microsoft.com/is/content/microsoftcorp/microsoft/final/en-us/microsoft-brand/documents/Microsoft_Security_Intelligence_Report_volume_7_Jan-Jun2009.pdf> — “used Outlook to send the infected document to the first 50 e-mail addresses in the Outlook Address Book”
- <https://cdn-dynmedia-1.microsoft.com/is/content/microsoftcorp/microsoft/final/en-us/microsoft-brand/documents/Microsoft_Security_Intelligence_Report_volume_7_Jan-Jun2009.pdf> — “The result was a torrent of messages that shut down enterprise e-mail systems around the world”
- <https://www.justice.gov/archive/criminal/cybercrime/press-releases/2002/melissaSent.htm> — “The virus was designed to send an infected email to the first 50 email addresses on the users’ mailing lists.”
- <https://www.sei.cmu.edu/library/frequently-asked-questions-about-the-melissa-virus/> — “It then used a macro to hijack their Microsoft Outlook email system and send messages to the first 50 addresses in their mailing lists.”

## iloveyou-2000 — ILOVEYOU (Love Bug) (2000)

**Current claim:** A VBScript mass-mailing worm spread as an email attachment and through IRC. Microsoft's retrospective says it infected millions of computers in 2000 and could download, overwrite, delete, infect, and run files.

**Data confidence:** high

**Cross-check note:** Microsoft’s 2009 Security Intelligence Report identifies the 2000 LoveLetter worm, its `ILOVEYOU` mail subject, email-attachment and IRC spread, and file operations. The current summary omits the weaker early infection-count estimates and the more specific file-shadowing narrative.

**Record source URLs:** <https://www.microsoft.com/en-us/wdsi/threats/malware-encyclopedia-description?Name=Virus%3AVBS%2FLoveLetter&threatId=-2147428236> · <https://web.archive.org/web/20001204063700/http://www.cert.org/advisories/CA-2000-04.html> · <https://www.virusbulletin.com/virusbulletin/2015/05/throwback-thursday-when-love-came-town-june-2000> · <https://commdocs.house.gov/committees/science/hsy131170.000/hsy131170_1.HTM> · <https://cdn-dynmedia-1.microsoft.com/is/content/microsoftcorp/microsoft/final/en-us/microsoft-brand/documents/Microsoft_Security_Intelligence_Report_volume_7_Jan-Jun2009.pdf>

**Source excerpts:**
- <https://www.microsoft.com/en-us/wdsi/threats/malware-encyclopedia-description?Name=Virus%3AVBS%2FLoveLetter&threatId=-2147428236> — “The worm can spread as an e-mail attachment and through an IRC channel.”
- <https://cdn-dynmedia-1.microsoft.com/is/content/microsoftcorp/microsoft/final/en-us/microsoft-brand/documents/Microsoft_Security_Intelligence_Report_volume_7_Jan-Jun2009.pdf> — “VBS/LoveLetter, which infected millions of computers in 2000, sent messages with the subject line ‘ILOVEYOU’.”
- <https://cdn-dynmedia-1.microsoft.com/is/content/microsoftcorp/microsoft/final/en-us/microsoft-brand/documents/Microsoft_Security_Intelligence_Report_volume_7_Jan-Jun2009.pdf> — “The worm can download, overwrite, delete, infect, and run files on the infected computer.”

## blaster-2003 — Blaster (MSBlast) (2003)

**Current claim:** MSBlast exploited the Windows RPC/DCOM vulnerability addressed by MS03-026 and spread over open RPC ports without user action.

**Data confidence:** high

**Cross-check note:** Microsoft’s MS03-026 bulletin identifies the RPC/DCOM vulnerability; Microsoft’s Blaster alert says the worm spread over open RPC ports and defines worms as spreading without user action. The former summary’s shutdown-countdown detail was removed because it was not needed for this claim.

**Record source URLs:** <https://learn.microsoft.com/en-us/security-updates/securitybulletins/2003/ms03-026> · <https://learn.microsoft.com/en-us/troubleshoot/windows-server/security-and-malware/blaster-worm-virus-alert>

**Source excerpts:**
- <https://learn.microsoft.com/en-us/troubleshoot/windows-server/security-and-malware/blaster-worm-virus-alert> — “Known as "Blaster," this new worm exploits the vulnerability that was addressed by Microsoft Security Bulletin MS03-026 (823980) to spread itself over networks by using open Remote Procedure Call (RPC) ports on computers that are running any of the products that are listed at the beginning of this article.”
- <https://learn.microsoft.com/en-us/troubleshoot/windows-server/security-and-malware/blaster-worm-virus-alert> — “A worm is a type of computer virus that generally spreads without user action and that distributes complete copies (possibly modified) of itself across networks (such as the Internet).”

## slammer-2003 — SQL Slammer (2003)

**Current claim:** Memory-resident worm propagated over UDP port 1434 and spread worldwide in roughly ten minutes. It carried no destructive payload; the damage came from scanning congestion and resulting outages.

**Data confidence:** high

**Cross-check note:** Microsoft’s MS02-039 bulletin identifies the SQL Server Resolution Service on UDP port 1434; CAIDA says the vulnerability was exploitable with a single UDP 1434 packet, measured worldwide spread in about ten minutes and reports no destructive payload.

**Record source URLs:** <https://www.caida.org/archive/sapphire/> · <https://learn.microsoft.com/en-us/security-updates/securitybulletins/2002/ms02-039>

**Source excerpts:**
- <https://www.caida.org/catalog/papers/2003_sapphire/> — “Although it did not contain a destructive payload, Sapphire spread worldwide in roughly 10 minutes causing significant disruption of financial, transportation, and government institutions.”
- <https://www.caida.org/catalog/papers/2003_sapphire/> — “The worm achieved its full scanning rate (over 55 million scans per second) after approximately three minutes, after which the rate of growth slowed down somewhat because significant portions of the network did not have enough bandwidth to allow it to operate unhindered.”
- <https://www.caida.org/catalog/papers/2003_sapphire/> — “Since the SQL Server vulnerability was exploitable using a single packet to UDP port 1434, the worm was able to send these scans without requiring a response from the potential victim.”
- <https://learn.microsoft.com/en-us/security-updates/securitybulletins/2002/ms02-039> — “The SQL Server Resolution Service, which operates on UDP port 1434, provides a way for clients to query for the appropriate network endpoints to use for a particular SQL Server instance.”

## mydoom-2004 — Mydoom (2004)

**Current claim:** Mydoom was a mass-mailing worm; some variants spread through peer-to-peer networks, acted as backdoors, and could launch denial-of-service attacks. Its email lures varied by version.

**Data confidence:** high

**Cross-check note:** Microsoft’s Security Intelligence Report describes Mydoom as a mass-mailing worm, notes peer-to-peer spread in some variants, and lists backdoor and denial-of-service behavior. F-Secure’s Mydoom.M analysis supports the narrower variant-specific lure used in the reconstructed front-end.

**Record source URLs:** <https://www.microsoft.com/en-us/wdsi/threats/malware-encyclopedia-description?Name=Win32%2FMydoom> · <https://www.f-secure.com/v-descs/mydoom-m> · <https://cdn-dynmedia-1.microsoft.com/is/content/microsoftcorp/microsoft/final/en-us/microsoft-brand/documents/Microsoft_Security_Intelligence_Report_volume_7_Jan-Jun2009.pdf>

**Source excerpts:**
- <https://www.microsoft.com/en-us/wdsi/threats/malware-encyclopedia-description?Name=Win32%2FMydoom> — “Some variants of Win32/Mydoom launch denial of service (DoS) attacks against specific Web sites.”
- <https://cdn-dynmedia-1.microsoft.com/is/content/microsoftcorp/microsoft/final/en-us/microsoft-brand/documents/Microsoft_Security_Intelligence_Report_volume_7_Jan-Jun2009.pdf> — “Win32/Mydoom: A family of mass-mailing worms that spread through e-mail. Some variants also spread through P2P networks. It acts as a backdoor trojan and can sometimes be used to launch DoS attacks against specific Web sites.”

## sasser-2004 — Sasser worm (2004)

**Current claim:** Sasser was a network worm that exploited an LSASS vulnerability and spread by randomly scanning IP addresses for vulnerable machines.

**Data confidence:** high

**Cross-check note:** Microsoft’s Security Intelligence Report describes Sasser as exploiting the vulnerability addressed by MS04-011 and scanning random IP addresses for vulnerable machines. This replaces earlier TCP-port/FTP details that were not retained in the claim-level excerpt set.

**Record source URLs:** <https://www.microsoft.com/en-us/wdsi/threats/malware-encyclopedia-description?name=Win32%2FSasser> · <https://cdn-dynmedia-1.microsoft.com/is/content/microsoftcorp/microsoft/final/en-us/microsoft-brand/documents/Microsoft_Security_Intelligence_Report_volume_7_Jan-Jun2009.pdf> · <https://learn.microsoft.com/en-us/security-updates/securitybulletins/2004/ms04-011>

**Source excerpts:**
- <https://cdn-dynmedia-1.microsoft.com/is/content/microsoftcorp/microsoft/final/en-us/microsoft-brand/documents/Microsoft_Security_Intelligence_Report_volume_7_Jan-Jun2009.pdf> — “Win32/Sasser: A family of network worms that exploit a vulnerability fixed by security bulletin MS04-011. The worm spreads by randomly scanning IP addresses for vulnerable machines and infecting any that are found.”

## zeus-2007 — Zeus (Zbot) (2007)

**Current claim:** First identified in 2007 and designed primarily to steal banking data. Zeus became known for browser form grabbing, web injects that changed genuine bank pages, and keylogging; users could be on the real bank site while the browser altered what it displayed.

**Data confidence:** high

**Cross-check note:** Sophos and Securelist describe Zbot/Zeus as a banking-data stealer, with browser-based theft and web-injection behavior; Securelist dates variants to 2007. The browser effects are synthetic in this project.

**Record source URLs:** <https://digital.nhs.uk/cyber-alerts/2017/cc-1138> · <https://www.sophos.com/en-us/threat-detection-library/mal/zbot> · <https://securelist.com/zeus-on-the-hunt/36289/>

**Source excerpts:**
- <https://www.sophos.com/en-us/threat-detection-library/mal/zbot> — “It is a widespread and old malware family that is designed primarily to steal banking data, including usernames, passwords, and the one-time access codes used in two-factor authentication.”

## tjx-2007 — TJX (T.J. Maxx / Marshalls) (2007)

**Current claim:** The Canadian Privacy Commissioner’s report records TJX’s view that intruders first accessed its system through wireless LANs at two U.S. stores. The breach exposed payment-card data; the source describes the initial wireless route cautiously.

**Data confidence:** high

**Cross-check note:** The Canadian Privacy Commissioner’s report says TJX believed the intruder initially entered through wireless LANs at two U.S. stores. The summary preserves that attribution as TJX’s view rather than an independently established route.

**Record source URLs:** <https://www.priv.gc.ca/en/opc-actions-and-decisions/investigations/investigations-into-businesses/2007/tjx_rep_070925/>

**Source excerpts:**
- <https://www.priv.gc.ca/en/opc-actions-and-decisions/investigations/investigations-into-businesses/2007/tjx_rep_070925> — “TJX is of the view that the intruder initially gained access to the system via the wireless local area networks (WLANS) at two stores in the United States.”
- <https://www.priv.gc.ca/en/opc-actions-and-decisions/investigations/investigations-into-businesses/2007/tjx_rep_070925> — “With respect to network security, excluding wireless security, some measures to restrict access to the network were in place at the time of the breach.”

## conficker-2008 — Conficker (2008)

**Current claim:** Worm that spread via the MS08-067 vulnerability, network shares, and removable media, then used domain generation to keep finding command and control. It proved that a patch existed and was not applied.

**Data confidence:** high

**Cross-check note:** CISA and Microsoft document MS08-067, removable-media and share propagation, and the available patch. SRI/USENIX analysis describes the domain-generation/rendezvous mechanism used to seek updates.

**Record source URLs:** <https://www.cisa.gov/news-events/alerts/2009/03/29/conficker-worm-targets-microsoft-windows-systems> · <https://learn.microsoft.com/en-us/security-updates/securitybulletins/2008/ms08-067> · <https://www.usenix.org/event/leet09/tech/full_papers/porras/porras_html>

**Source excerpts:**
- <https://www.cisa.gov/news-events/alerts/2009/03/29/conficker-worm-targets-microsoft-windows-systems> — “US-CERT is aware of public reports indicating a widespread infection of the Conficker/Downadup worm, which can infect a Microsoft Windows system from a thumb drive, a network share, or directly across a corporate network, if the network servers are not patched with the MS08-067 patch from Microsoft.”

## stuxnet-2010 — Stuxnet (2010)

**Current claim:** One of the first widely documented cyberweapons. It propagated through infected USB media and network shares, targeted Siemens STEP7 and WinCC environments, altered PLC logic, and concealed those changes from operators.

**Data confidence:** high

**Cross-check note:** CISA documents infected USB/network-share propagation and interaction with Siemens STEP 7/WinCC. The Symantec Stuxnet Dossier documents PLC-payload manipulation and concealment of the altered process state from operators; ENISA describes rootkit concealment on infected WinCC systems. The summary says “one of the first widely documented” cyberweapons, not the first malware ever.

**Record source URLs:** <https://www.cisa.gov/news-events/ics-advisories/icsa-10-272-01> · <https://www.cisa.gov/news-events/ics-advisories/icsa-10-201-01c> · <https://www.enisa.europa.eu/news/enisa-news/stuxnet-analysis> · <https://nsarchive2.gwu.edu/NSAEBB/NSAEBB424/docs/Cyber-044.pdf>

**Source excerpts:**
- <https://www.cisa.gov/news-events/ics-advisories/icsa-10-272-01> — “The known methods of propagation include infected USB devices, network shares, STEP 7 Project files, WinCC database files, and the print spooler vulnerability addressed by MS-10-061.”
- <https://nsarchive2.gwu.edu/NSAEBB/NSAEBB424/docs/Cyber-044.pdf> — “Stuxnet records the previous operating frequencies for the frequency controllers. This data is played back to WinCC during the sabotage routines. Thus, instead of the monitoring systems receiving the anomalous operating frequency data, the monitoring systems believe the frequency converters are operating as normal.”

## rsa-2011 — RSA SecurID (2011)

**Current claim:** RSA disclosed that attackers extracted information related to its SecurID products. Reporting described a spearphishing email with an Excel attachment containing an embedded Flash exploit. RSA warned the information could weaken affected token deployments; its cited company notice did not specify the exact token-seed scope.

**Data confidence:** high

**Cross-check note:** RSA’s SEC-filed letter confirms SecurID-related information was extracted and could weaken affected deployments. Ars Technica reports the spear-phishing Excel/Flash chain; the summary no longer claims a precise seed-data scope or share-price effect.

**Record source URLs:** <https://arstechnica.com/information-technology/2011/04/spearphishing-0-day-rsa-hack-not-extremely-sophisticated/> · <https://www.sec.gov/Archives/edgar/data/790070/000119312511070159/dex991.htm> · <https://www.sec.gov/Archives/edgar/data/790070/000119312511070159/dex992.htm>

**Source excerpts:**
- <https://arstechnica.com/tech-policy/2011/08/researchers-uncover-rsa-phishing-attack-hiding-in-plain-sight/> — “When the spreadsheet opened, Excel triggered the Flash exploit to activate, which then dropped the backdoor—in this case a backdoor known as Poison Ivy—onto the system.”
- <https://www.sec.gov/Archives/edgar/data/790070/000119312511070159/dex992.htm> — “This information could potentially be used to reduce the effectiveness of a current two-factor authentication implementation as part of a broader attack.”

## shamoon-2012 — Shamoon (Disttrack) (2012)

**Current claim:** Contemporaneous reporting said a 2012 wiper replaced data on three-quarters of Saudi Aramco's corporate PCs with a burning U.S. flag image. The company said about 30,000 workstations were affected and its main internal network services had been restored.

**Data confidence:** high

**Cross-check note:** The August 27, 2012 NYT Bits post reports Saudi Aramco’s chief executive saying a malicious virus from external sources affected about 30,000 workstations and main internal network services were restored; the October 2012 Bits post supplies the three-quarters-of-corporate-PCs and burning-flag image description. No initial-access method is asserted.

**Record source URLs:** <https://www.nytimes.com/2012/10/24/business/global/cyberattack-on-saudi-oil-firm-disquiets-us.html> · <https://archive.nytimes.com/bits.blogs.nytimes.com/2012/08/27/connecting-the-dots-after-cyberattack-on-saudi-aramco/> · <https://www.cisa.gov/sites/default/files/Monitors/ICS-CERT_Monitor_Sep2012.pdf>

**Source excerpts:**
- <https://archive.nytimes.com/bits.blogs.nytimes.com/2012/10/24/daily-report-how-aramco-got-hacked/> — “The virus erased data on three-quarters of Aramco’s corporate PCs — documents, spreadsheets, e-mail, files — replacing all of it with an image of a burning American flag.”
- <https://archive.nytimes.com/bits.blogs.nytimes.com/2012/10/24/daily-report-how-aramco-got-hacked/> — “15, more than 55,000 Saudi Aramco employees stayed home from work to prepare for one of Islam’s holiest nights of the year — Lailat al Qadr, or the Night of Power — celebrating the revelation of the Koran to Muhammad.”
- <https://archive.nytimes.com/bits.blogs.nytimes.com/2012/08/27/connecting-the-dots-after-cyberattack-on-saudi-aramco/> — “Aramco had restored its main internal network services after they were “impacted on Aug. 15, 2012, by a malicious virus that originated from external sources and affected about 30,000 workstations.””

## target-2013 — Target (2013)

**Current claim:** Investigative reporting attributed the intrusion to credentials stolen in an email malware attack at HVAC vendor Fazio Mechanical. Attackers reached Target point-of-sale systems and scraped card data; the precise path from vendor access to POS remained partly unresolved.

**Data confidence:** high

**Cross-check note:** Krebs reporting attributes stolen Fazio Mechanical vendor credentials to a malware-laced phishing email and reports subsequent POS card theft. Because the exact route from vendor access to POS was not fully established in the cited reporting, the summary says so.

**Record source URLs:** <https://krebsonsecurity.com/2014/02/target-hackers-broke-in-via-hvac-company/> · <https://krebsonsecurity.com/2014/02/email-attack-on-vendor-set-up-breach-at-target/> · <https://krebsonsecurity.com/2014/01/a-first-look-at-the-target-intrusion-malware/>

**Source excerpts:**
- <https://krebsonsecurity.com/2014/02/email-attack-on-vendor-set-up-breach-at-target/> — “Multiple sources close to the investigation now tell this reporter that those credentials were stolen in an email malware attack at Fazio that began at least two months before thieves started stealing card data from thousands of Target cash registers.”
- <https://krebsonsecurity.com/2014/02/email-attack-on-vendor-set-up-breach-at-target/> — “The former Target network expert has a theory: “I know that the Ariba system has a back end that Target administrators use to maintain the system and provide vendors with login credentials, \[and\] I would have to speculate that once a vendor logs into the portal they have active access to the server that runs the application,” the source said.”

## emotet-2014 — Emotet (2014)

**Current claim:** CISA described Emotet as a modular banking Trojan that could download or drop other malware. It spread through malicious email attachments and links.

**Data confidence:** high

**Cross-check note:** CISA’s 2018 advisory describes Emotet as a modular banking Trojan/downloader and malspam delivery. The summary omits claims about specific follow-on families and the first-seen date that are not reproduced in the retained passage excerpt.

**Record source URLs:** <https://www.cisa.gov/news-events/cybersecurity-advisories/aa20-280a> · <https://www.cisa.gov/news-events/alerts/2018/07/20/emotet-malware> · <https://www.microsoft.com/en-us/wdsi/threats/malware-encyclopedia-description?Name=Win32%2FEmotet>

**Source excerpts:**
- <https://www.cisa.gov/news-events/alerts/2018/07/20/emotet-malware> — “Emotet is an advanced, modular banking Trojan that primarily functions as a downloader or dropper of other banking Trojans.”
- <https://www.cisa.gov/news-events/alerts/2018/07/20/emotet-malware> — “Emotet is disseminated through malspam (emails containing malicious attachments or links) that uses branding familiar to the recipient; it has even been spread using the MS-ISAC name.”

## heartbleed-2014 — Heartbleed (2014)

**Current claim:** A flaw in OpenSSL's TLS heartbeat handling allowed a remote peer to expose sensitive process memory, potentially including authentication credentials and secret keys.

**Data confidence:** high

**Cross-check note:** CISA describes incorrect memory handling in the TLS heartbeat extension and the potential exposure of sensitive data, including credentials and secret keys. The summary omits the numeric memory limit and prevalence/version-history claims.

**Record source URLs:** <https://www.cisa.gov/news-events/alerts/2014/04/08/openssl-heartbleed-vulnerability-cve-2014-0160> · <https://www.netcraft.com/blog/half-a-million-widely-trusted-websites-vulnerable-to-heartbleed-bug>

**Source excerpts:**
- <https://www.cisa.gov/news-events/alerts/2014/04/08/openssl-heartbleed-vulnerability> — “A vulnerability in OpenSSL could allow a remote attacker to expose sensitive data, possibly including user authentication credentials and secret keys, through incorrect memory handling in the TLS heartbeat extension.”
- <https://www.cisa.gov/news-events/ics-alerts/ics-alert-14-099-01b> — “As a result, a malicious actor could send a specially crafted heartbeat request to the vulnerable server and obtain sensitive information stored in memory on the server.”

## sony-2014 — Sony Pictures (2014)

**Current claim:** The FBI described system destruction, large-scale theft of personal and commercial data, and threats by the Guardians of Peace; it attributed the intrusion to North Korea. The cited public statement does not establish the initial access route, so none is reconstructed here.

**Data confidence:** medium

**Cross-check note:** The FBI update attributes the attack to North Korea and describes destroyed systems, stolen personal/commercial data, and Guardians of Peace threats; CISA describes the destructive wiper. The cited public record does not establish initial access, so confidence stays medium and no route is reconstructed.

**Record source URLs:** <https://www.fbi.gov/news/press-releases/update-on-sony-investigation> · <https://www.cisa.gov/news-events/alerts/2014/12/19/targeted-destructive-malware>

**Source excerpts:**
- <https://www.cisa.gov/news-events/alerts/2014/12/19/targeted-destructive-malware> — “Based on the username/password provided in the configuration file and the hostname/IP address of target systems, the malware will access remote network shares in order to upload a copy of the wiper and begin the wiping process on these remote systems.”
- <https://www.cisa.gov/news-events/alerts/2014/12/19/targeted-destructive-malware> — “The malware uses several methods to access shares on the remote systems to begin wiping files.”

## anthem-2015 — Anthem (2015)

**Current claim:** The Department of Justice alleged that tailored spearphishing emails with hyperlinks downloaded a backdoor, followed by lateral movement and access to Anthem’s enterprise data warehouse. Intruders remained for months before January 2015 exfiltration affecting roughly 78.8 million people.

**Data confidence:** high

**Cross-check note:** DOJ’s 2019 announcement describes tailored spearphishing links; the indictment details the backdoor, lateral movement, warehouse access and January 2015 exfiltration. The affected figure is approximately 78.8 million people, not records. These are DOJ allegations in an indictment, not a finding that substitutes for the presumption of innocence.

**Record source URLs:** <https://www.justice.gov/d9/press-releases/attachments/2019/05/09/anthem_indictment_0.pdf> · <https://www.justice.gov/archives/opa/pr/member-sophisticated-china-based-hacking-group-indicted-series-computer-intrusions-including>

**Source excerpts:**
- <https://www.justice.gov/d9/press-releases/attachments/2019/05/09/anthem_indictment_0.pdf> — “These techniques included the sending of specially-tailored spearfishing emails with embedded hyperlinks to employees of the Victims. After a user accessed the hyperlink, a file was downloaded which, when executed, deployed malware that would compromise the user's computer system by, in pertinent part, installing a backdoor enabling remote access.”
- <https://www.justice.gov/d9/press-releases/attachments/2019/05/09/anthem_indictment_0.pdf> — “Defendants sometimes patiently waited months before taking further action, quietly maintaining access to the Victim's network.”
- <https://www.justice.gov/d9/press-releases/attachments/2019/05/09/anthem_indictment_0.pdf> — “In or about December 2014 and January 2015, on multiple occasions, Defendants accessed the computer network of Anthem, accessed Anthem's enterprise data warehouse, queried the enterprise data warehouse for personally identifiable information.”
- <https://www.justice.gov/d9/press-releases/attachments/2019/05/09/anthem_indictment_0.pdf> — “Defendants identified and ultimately stole data concerning approximately 78.8 million persons from Anthem’s computer network.”

## carbanak-2015 — Carbanak (Anunak) (2015)

**Current claim:** Kaspersky reported spearphishing attachments against bank employees, followed by lateral movement and direct manipulation of banking and ATM systems to transfer funds over time.

**Data confidence:** high

**Cross-check note:** Kaspersky Securelist documents spear-phishing attachments against bank employees, lateral movement, and direct manipulation of banking/ATM systems over months. The untraceable anecdotal naming quote was removed.

**Record source URLs:** <https://securelist.com/the-great-bank-robbery-the-carbanak-apt/68732/>

**Source excerpts:**
- <https://securelist.com/the-great-bank-robbery-the-carbanak-apt/68732/> — “Attackers used spear phishing emails with malicious attachments against employees of the targeted financial institutions, in some cases sending them to their personal email addresses.”
- <https://securelist.com/the-great-bank-robbery-the-carbanak-apt/68732/> — “pdf) The story of Carbanak began when a bank from Ukraine asked us to help with a forensic investigation.”

## lookalike-2005 — Lookalike / IDN homograph domains (2005)

**Current claim:** Mozilla’s February 2005 advisory documented IDN spoofing: some internationalized domain names could resemble trusted names in the address bar. This was a browser-display risk, not a credential leak by itself.

**Data confidence:** high

**Cross-check note:** Mozilla’s February 2005 advisory and Bugzilla record describe IDN homograph spoofing via visually similar internationalized domain names. The date note distinguishes the advisory date from the older technique.

**Record source URLs:** <https://www.mozilla.org/en-US/security/advisories/mfsa2005-29/> · <https://bugzilla.mozilla.org/show_bug.cgi?id=281831>

**Source excerpts:**
- <https://bugzilla.mozilla.org/show_bug.cgi?id=281831> — “This can be exploited by registering domain names with certain international characters that resembles other commonly used characters, thereby causing the user to believe they are on a trusted site.”
- <https://bugzilla.mozilla.org/show_bug.cgi?id=281831> — “The problem is caused due to an unintended result of the IDN (International Domain Name) implementation, which allows using international characters in domain names.”

## opm-2015 — US Office of Personnel Management (2015)

**Current claim:** The breach exposed personnel and security-clearance records, including background-investigation files. Congressional reporting identifies a compromised KeyPoint user credential, while OPM could not determine how it was initially obtained. No weak-password story is reconstructed here.

**Data confidence:** high

**Cross-check note:** House Oversight reporting identifies a compromised KeyPoint user credential; OPM Director testimony confirms background-investigation and security-clearance information was affected and says investigators did not know how the employee’s credentials were compromised. The summary makes no weak-password claim. GAO-17-614 is post-breach oversight context, not the primary credential evidence.

**Record source URLs:** <https://oversight.house.gov/report/opm-data-breach-government-jeopardized-national-security-generation/> · <https://docs.house.gov/meetings/GO/GO00/20150624/103684/HHRG-114-GO00-Transcript-20150624.pdf> · <https://oversight.house.gov/wp-content/uploads/2015/06/2015-06-24-FC-OPM-DATA-BREACH-PART-II.GO175001.pdf> · <https://www.gao.gov/products/gao-17-614>

**Source excerpts:**
- <https://oversight.house.gov/wp-content/uploads/2015/06/2015-06-24-FC-OPM-DATA-BREACH-PART-II.GO175001.pdf> — “The adversary leveraged a compromised KeyPoint user credential to gain access to OPM’s network.”
- <https://docs.house.gov/meetings/GO/GO00/20150624/103684/HHRG-114-GO00-Transcript-20150624.pdf> — “The type of information involved in the background investigations incident involves SF 86 data, as well as clearance adjudication information.”
- <https://docs.house.gov/meetings/GO/GO00/20150624/103684/HHRG-114-GO00-Transcript-20150624.pdf> — “We actually do not know how the employee’s credentials were compromised.”

## ukraine-2015 — Ukrainian power grid (2015)

**Current claim:** CISA reported malicious Office attachments and said BlackEnergy’s possible role in obtaining legitimate credentials remained under evaluation. It attributed outages to remote cyber intrusions affecting about 225,000 customers; operators restored power manually.

**Data confidence:** high

**Cross-check note:** CISA records spearphishing as reported and says BlackEnergy’s possible initial-access role was still being evaluated. It attributes outages to remote intrusions affecting approximately 225,000 customers; the SEL analysis describes unauthorized breaker operations and manual restoration. No confirmed initial-access route is asserted.

**Record source URLs:** <https://attack.mitre.org/campaigns/C0028/> · <https://www.cisa.gov/news-events/ics-alerts/ir-alert-h-16-056-01> · <https://cdn.selinc.com/assets/Literature/Publications/Technical%20Papers/6774_UkraineCyber_DEW_20170130_Web7.pdf?v=20181015-210831>

**Source excerpts:**
- <https://www.cisa.gov/news-events/ics-alerts/ir-alert-h-16-056-01> — “The malware was reportedly delivered via spear phishing emails with malicious Microsoft Office attachments. It is suspected that BlackEnergy may have been used as an initial access vector to acquire legitimate credentials; however, this information is still being evaluated.”
- <https://www.cisa.gov/news-events/ics-alerts/ir-alert-h-16-056-01> — “Through interviews with impacted entities, the team learned that power outages were caused by remote cyber intrusions at three regional electric power distribution companies impacting approximately 225,000 customers.”
- <https://cdn.selinc.com/assets/Literature/Publications/Technical%20Papers/6774_UkraineCyber_DEW_20170130_Web7.pdf?v=20181015-210831> — “After six hours and the loss of over 130 MW of load, operators restored power by sending technicians to the substations and manually controlling the power system.”

## mirai-2016 — Mirai (2016)

**Current claim:** CISA described Mirai as part of a self-propagating botnet built from internet-connected IoT devices and reported that its source code was published online in September 2016, enabling wider use for DDoS attacks.

**Data confidence:** high

**Cross-check note:** The retained CISA passage supports the IoT-botnet/DDoS description and the public source-code release. The summary no longer asserts a specific credential-scanning mechanism that is not present in the retained passage.

**Record source URLs:** <https://www.cisa.gov/news-events/alerts/2016/10/14/heightened-ddos-threat-posed-mirai-and-other-botnets>

**Source excerpts:**
- <https://www.cisa.gov/news-events/alerts/2016/10/14/heightened-ddos-threat-posed-mirai-and-other-botnets> — “Mirai malware source code was published online at the end of September, opening the door to more widespread use of the code to create other DDoS attacks.”
- <https://www.cisa.gov/news-events/alerts/2016/10/14/heightened-ddos-threat-posed-mirai-and-other-botnets> — “Recently, IoT devices have been used to create large-scale botnets—networks of devices infected with self-propagating malware—that can execute crippling distributed denial-of-service (DDoS) …”

## smishing-2016 — Smishing / parcel lure (2010s) (2016)

**Current claim:** This is a technique family rather than one canonical 2016 incident. An SMS carrying a link to a spoofed credential page, delivered because parcel notifications are a real, expected text.

**Data confidence:** high

**Cross-check note:** FTC consumer guidance documents fake parcel texts linking to spoofed tracking pages. The date note scopes this as a 2010s technique family rather than a canonical 2016 incident.

**Record source URLs:** <https://consumer.ftc.gov/consumer-alerts/2023/12/fake-shipping-notification-emails-text-messages-what-you-need-know-holiday-season>

**Source excerpts:**
- <https://consumer.ftc.gov/consumer-alerts/2023/12/fake-shipping-notification-emails-text-messages-what-you-need-know-holiday-season> — “The message might say that you missed a delivery attempt and ask you to click on a link to reschedule the delivery.”
- <https://consumer.ftc.gov/consumer-alerts/2023/12/fake-shipping-notification-emails-text-messages-what-you-need-know-holiday-season> — “They want you to click on the link without thinking about it and enter your personal or financial information. But the site is fake. A look-alike of a real website. And it’ll capture all the information you enter.”

## yahoo-cookies-2016 — Yahoo forged cookies 2015–16 (2016)

**Current claim:** Yahoo disclosed that investigators were examining forged cookies that could let an intruder access accounts without a password. This activity was separate from the 2013 breach affecting more than one billion accounts; the cited notice did not say user passwords were stolen.

**Data confidence:** high

**Cross-check note:** Yahoo’s SEC disclosure directly describes forged cookies that could allow password-free account access and separately identifies the 2013 one-billion-account breach. The roughly 32-million estimate from Reuters is omitted from the current summary because the retained SEC passages do not support that figure.

**Record source URLs:** <https://www.sec.gov/Archives/edgar/data/1011006/000119312517065791/d293630d10k.htm> · <https://www.sec.gov/Archives/edgar/data/1011006/000119312516793106/d305610dex991.htm> · <https://ca.finance.yahoo.com/news/yahoo-says-32-million-accounts-233322849.html>

**Source excerpts:**
- <https://www.sec.gov/Archives/edgar/data/1011006/000119312516793106/d305610dex991.htm> — “Separately, Yahoo previously disclosed that its outside forensic experts were investigating the creation of forged cookies that could allow an intruder to access users’ accounts without a password.”
- <https://www.sec.gov/Archives/edgar/data/1011006/000119312516793106/d305610dex991.htm> — “Based on further analysis of this data by the forensic experts, Yahoo believes an unauthorized third party, in August 2013, stole data associated with more than one billion user accounts.”

## equifax-2017 — Equifax (2017)

**Current claim:** Exploitation of an unpatched Apache Struts vulnerability. The patch had been available since March 2017. The certificate on the exposed web service had been expired for nearly ten months.

**Data confidence:** high

**Cross-check note:** GAO-18-559 documents the March 2017 Struts alert and reports the inspection certificate had expired about ten months before the breach. The summary ties the certificate to missed encrypted-traffic inspection rather than presenting it as the entry vector.

**Record source URLs:** <https://www.gao.gov/products/gao-18-559> · <https://www.ftc.gov/system/files/documents/cases/172_3203_equifax_complaint_7-22-19.pdf>

**Source excerpts:**
- <https://www.gao.gov/products/gao-18-559> — “On March 10, 2017, unidentified individuals scanned the company’s systems to determine if the systems were susceptible to a specific vulnerability that the United States Computer Emergency Readiness Team had publicly identified just 2 days earlier.”
- <https://www.gao.gov/products/gao-18-559> — “The certificate had expired about 10 months before the breach occurred, meaning that encrypted traffic was not being inspected throughout that period.”

## notpetya-2017 — NotPetya (M.E.Doc updater) (2017)

**Current claim:** Not the "tax forms" document lure. It was delivered through a compromised M.E.Doc software-update mechanism, initially reaching organizations that installed the tainted update; it then spread through affected networks. The update channel was the attack.

**Data confidence:** high

**Cross-check note:** Microsoft and Cisco Talos describe the compromised M.E.Doc update channel and subsequent network spread. The summary no longer claims that every organization with M.E.Doc was affected.

**Record source URLs:** <https://www.microsoft.com/en-us/security/blog/2017/06/27/new-ransomware-old-techniques-petya-adds-worm-capabilities/> · <https://blog.talosintelligence.com/the-medoc-connection/>

**Source excerpts:**
- <https://blog.talosintelligence.com/the-medoc-connection/> — “An organized attacker had the means to deliver arbitrary code to users of the most popular accounting software in Ukraine, and that includes multinational corporations that do business there.”

## vault7-2017 — Vault 7 (2017)

**Current claim:** A disclosure of CIA cyber-tool material, not a conventional victim compromise. What was published was an inventory: tools, exploits and the targeting categories they supported.

**Data confidence:** high

**Cross-check note:** BBC coverage of the March 2017 WikiLeaks disclosure describes alleged CIA hacking-tool documents across consumer platforms. This is categorized as a disclosure, not a conventional victim compromise; no tool files were downloaded.

**Record source URLs:** <https://www.washingtonpost.com/world/national-security/wikileaks-says-it-has-obtained-trove-of-cia-hacking-tools/2017/03/07/c8c50c5c-0345-11e7-b1e9-a05d3c21f7cf_story.html> · <https://www.bbc.com/news/technology-39193008>

**Source excerpts:**
- <https://www.bbc.com/news/technology-39193008> — “Wikileaks has published details of what it says are wide-ranging hacking tools used by the CIA.”
- <https://www.bbc.com/news/technology-39193008> — “Thousands of documents said to detail the CIA’s hacking tools were published by Wikileaks on Tuesday.”

## wannacry-2017 — WannaCry (WanaCrypt0r) (2017)

**Current claim:** A wormable ransomware that spread through unpatched SMBv1 systems using MS17-010. Registering the malware's hard-coded domain interrupted propagation for that strain; Microsoft had released a patch in March 2017. Unpatched NHS systems amplified service disruption.

**Data confidence:** high

**Cross-check note:** CISA and Microsoft describe SMBv1 exploitation using MS17-010 and the domain check that curtailed propagation for that strain; NHS reporting documents service disruption. The summary does not say that registering one domain stopped all variants.

**Record source URLs:** <https://www.england.nhs.uk/wp-content/uploads/2018/02/lessons-learned-review-wannacry-ransomware-cyber-attack-cio-review.pdf> · <https://www.cisa.gov/news-events/alerts/2017/05/12/indicators-associated-wannacry-ransomware> · <https://www.microsoft.com/en-us/security/blog/2017/05/12/wannacrypt-ransomware-worm-targets-out-of-date-systems/>

**Source excerpts:**
- <https://www.england.nhs.uk/wp-content/uploads/2018/02/lessons-learned-review-wannacry-ransomware-cyber-attack-cio-review.pdf> — “The WannaCry ransomware cryptoworm targeted computers running the Microsoft Windows operating system by encrypting data and demanding ransom payment in the Bitcoin cryptocurrency.”
- <https://www.england.nhs.uk/wp-content/uploads/2018/02/lessons-learned-review-wannacry-ransomware-cyber-attack-cio-review.pdf> — “The initial infection was likely through an exposed vulnerable internet-facing Server Message Block (SMB) port, rather than email phishing as initially assumed.”
- <https://www.england.nhs.uk/wp-content/uploads/2018/02/lessons-learned-review-wannacry-ransomware-cyber-attack-cio-review.pdf> — “A cybersecurity researcher, who activated a ‘kill-switch’ on the evening of Friday 12 May, had the effect of stopping WannaCry infecting further devices.”
- <https://www.england.nhs.uk/wp-content/uploads/2018/02/lessons-learned-review-wannacry-ransomware-cyber-attack-cio-review.pdf> — “Microsoft issued a patch to address this vulnerability on 14 March 2017.”
- <https://www.england.nhs.uk/wp-content/uploads/2018/02/lessons-learned-review-wannacry-ransomware-cyber-attack-cio-review.pdf> — “None of the 80 NHS organisations affected by WannaCry had applied the Microsoft update patch advised by NHS Digital’s CareCERT bulletin on 25 April 2017.”
- <https://www.microsoft.com/en-us/security/blog/2017/05/12/wannacrypt-ransomware-worm-targets-out-of-date-systems/> — “This vulnerability was fixed in security bulletin MS17-010, which was released on March 14, 2017.”
- <https://www.microsoft.com/en-us/security/blog/2017/05/12/wannacrypt-ransomware-worm-targets-out-of-date-systems/> — “If connection to the domains is successful, the dropper does not infect the system further with ransomware or try to exploit other systems to spread; it simply stops execution.”

## marriott-2018 — Marriott / Starwood (2018)

**Current claim:** Investigators found a web shell, remote access tools and credential harvesting, and a long dwell period. The method by which the initial web shell was installed was not determined, and no single old encryption key is presented as the answer here.

**Data confidence:** high

**Cross-check note:** The Canadian Privacy Commissioner’s investigation documents a web shell, remote-access tools, credential harvesting, and prolonged access. It explicitly says the initial method for installing the web shell was not determined.

**Record source URLs:** <https://www.priv.gc.ca/en/opc-actions-and-decisions/investigations/investigations-into-businesses/2022/pipeda-2022-005/>

**Source excerpts:**
- <https://www.priv.gc.ca/en/opc-actions-and-decisions/investigations/investigations-into-businesses/2022/pipeda-2022-005/?wbdisable=true> — “the web shell installed by the attacker, Remote Access Trojans, and a credential harvesting program).”
- <https://www.priv.gc.ca/en/opc-actions-and-decisions/investigations/investigations-into-businesses/2022/pipeda-2022-005/?wbdisable=true> — “Regardless of the method used, the web shell allowed the attacker to install malicious tools, enabling them to harvest legitimate credentials for Starwood’s system and remotely access the Starwood network.”

## vpnfilter-2018 — VPNFilter (2018)

**Current claim:** CISA described a multi-stage implant targeting some routers and network-attached storage devices. It could collect network traffic, including website credentials, and monitor Modbus/SCADA traffic.

**Data confidence:** high

**Cross-check note:** CISA’s alert documents collection of network traffic and website credentials and monitoring of Modbus/SCADA protocols on compromised devices. The summary does not imply that every router was affected or that the record proves reboot persistence.

**Record source URLs:** <https://blog.talosintelligence.com/vpnfilter/> · <https://www.cisa.gov/news-events/alerts/2018/05/25/cyber-actors-target-home-and-office-routers-and-networked-devices-worldwide>

**Source excerpts:**
- <https://www.cisa.gov/news-events/alerts/2018/05/23/vpnfilter-destructive-malware> — “Devices compromised by VPNFilter may be vulnerable to the collection of network traffic (including website credentials), as well as the monitoring of Modbus supervisory control and data acquisition (SCADA) protocols.”
- <https://www.cisa.gov/news-events/alerts/2018/05/23/vpnfilter-destructive-malware> — “Devices compromised by VPNFilter may be vulnerable to the collection of network traffic (including website credentials).”

## capitalone-2019 — Capital One (WAF misconfiguration, SSRF) (2019)

**Current claim:** A misconfigured web application firewall allowed a server-side request to reach the cloud instance metadata service and retrieve credentials, which were then used to list and copy object storage. Over a hundred million customers affected.

**Data confidence:** high

**Cross-check note:** The DOJ complaint and case materials describe a misconfigured WAF, role credentials obtained through the cloud metadata path, listing/copying storage buckets, and about 100 million affected applicants. The record does not use the complaint to claim a novel AWS infrastructure breach.

**Record source URLs:** <https://www.justice.gov/usao-wdwa/united-states-v-paige-thompson> · <https://www.justice.gov/usao-wdwa/press-release/file/1188626/dl>

**Source excerpts:**
- <https://www.justice.gov/usao-wdwa/united-states-v-paige-thompson> — “The intrusion occurred through a misconfigured web application firewall that enabled access to the data.”
- <https://www.justice.gov/usao-wdwa/united-states-v-paige-thompson> — “FBI agents executed a search warrant at Thompson’s residence and seized electronic storage devices containing a copy of the data.”

## collection1-2019 — Collection #1 (credential compilation) (2019)

**Current claim:** A compiled collection of roughly 773 million email and password pairs, not itself an intrusion. Its danger is that attackers take each password offline and spray it at every service where the same person has an account.

**Data confidence:** high

**Cross-check note:** Troy Hunt’s Collection #1 analysis reports roughly 773 million email addresses and explains credential stuffing as reusing breached username/password pairs elsewhere. The summary treats the compilation as exposure data, not a new intrusion.

**Record source URLs:** <https://www.troyhunt.com/the-773-million-record-collection-1-data-reach/>

**Source excerpts:**
- <https://www.troyhunt.com/the-773-million-record-collection-1-data-reach/> — “com): > Credential stuffing is the automated injection of breached username/password pairs in order to fraudulently gain access to user accounts.”
- <https://www.troyhunt.com/the-773-million-record-collection-1-data-reach/> — “If you found your password in Pwned Passwords and you're using that same one anywhere else, you want to change each and every one of those locations to something completely unique, which brings us to password managers.”

## simswap-2020 — SIM swap / SMS OTP interception (2020)

**Current claim:** A technique rather than a single named incident. Social-engineering a carrier rep transfers a number to another SIM, so the one-time codes the victim expects arrive somewhere else. Carrier-side social engineering is the technique itself.

**Data confidence:** high

**Cross-check note:** FBI IC3 guidance describes social engineering a carrier to transfer a victim’s number to a criminal-controlled SIM. This is a technique entry, not a single named 2020 incident.

**Record source URLs:** <https://www.ic3.gov/PSA/2022/PSA220208>

**Source excerpts:**
- <https://www.ic3.gov/PSA/2022/PSA220208> — “Social engineering involves a criminal actor impersonating a victim and tricking the mobile carrier into switching the victim's mobile number to a SIM card in the criminal's possession.”
- <https://www.ic3.gov/PSA/2022/PSA220208> — “Criminal actors primarily conduct SIM swap schemes using social engineering, insider threat, or phishing techniques.”

## solarwinds-2020 — SolarWinds / SUNBURST (2020)

**Current claim:** SolarWinds said SUNBURST was inserted during the Orion build process, not in its source repository, and shipped in a signed update. CISA describes the malicious code as inserted into the Orion software lifecycle while remaining signed by SolarWinds. SolarWinds reported that up to 18,000 customers could potentially have been vulnerable, based on downloads of the affected versions, and later estimated that fewer than 100 were actually hacked.

**Data confidence:** high

**Cross-check note:** SolarWinds’ incident account distinguishes its source repository from the Orion build environment, and says up to 18,000 downloads could have been vulnerable but fewer than 100 customers were actually hacked; CISA documents the software-lifecycle injection and code-signing preservation. The earlier claim that 18,000 customers installed affected updates overstated the SolarWinds passage and was corrected; the prior dwell-time sentence was also removed.

**Record source URLs:** <https://www.cisa.gov/news-events/analysis-reports/ar21-039a> · <https://www.solarwinds.com/blog/an-investigative-update-of-the-cyberattack> · <https://www.cisa.gov/sites/default/files/publications/Supply_Chain_Compromise_Detecting_APT_Activity_from_known_TTPs.pdf>

**Source excerpts:**
- <https://www.cisa.gov/sites/default/files/publications/Supply_Chain_Compromise_Detecting_APT_Activity_from_known_TTPs.pdf> — “The threat actor ensured Orion code containing SUNBURST was signed by SolarWinds code signing certificates by injecting the malware into the SolarWinds Orion software lifecycle.”
- <https://www.solarwinds.com/blog/an-investigative-update-of-the-cyberattack> — “The threat actor undertook a test run of its ability to inject code into builds of the Orion Software Platform software in October 2019, months prior to initiating the actual SUNBURST injection into builds of our Orion Software Platform released between March and June 2020.”
- <https://www.solarwinds.com/blog/an-investigative-update-of-the-cyberattack> — “At the earliest stages of our investigation, we reported up to 18,000 customers could potentially have been vulnerable to SUNBURST, based on our records of the total number of customer downloads of the specific, impacted versions of our Orion Platform products.”
- <https://www.solarwinds.com/blog/an-investigative-update-of-the-cyberattack> — “We now estimate that the actual number of customers who were hacked through SUNBURST to be fewer than 100.”

## colonial-2021 — Colonial Pipeline (2021)

**Current claim:** Colonial said it believed attackers exploited a legacy VPN profile that was not intended to be active; it used single-factor authentication. Investigators were still determining how the credentials were compromised. Colonial proactively halted operations on May 7, 2021, and PHMSA recorded that a full restart was initiated five days later.

**Data confidence:** high

**Cross-check note:** Senate testimony supports the cautiously attributed legacy-profile route and says the credential source remained under investigation; HSGAC’s hearing account records that the profile lacked MFA. DOE records the May 7 halt and PHMSA records that the full restart was initiated in five days. The earlier 5 p.m. ET and “several more days” details were removed because the retained passages do not state them.

**Record source URLs:** <https://www.hsgac.senate.gov/wp-content/uploads/imo/media/doc/Testimony-Blount-2021-06-08.pdf> · <https://www.govinfo.gov/content/pkg/CHRG-117shrg46569/html/CHRG-117shrg46569.htm> · <https://www.hsgac.senate.gov/media/reps/portman-presses-president-and-ceo-of-colonial-pipeline-on-gaps-in-cybersecurity-practices/> · <https://www.energy.gov/ceser/articles/ceser-2021-emergency-response-recap> · <https://www.colpipe.com/news-insights/media-resources/post/media-statement-update-colonial-pipeline-system-disruption/> · <https://www.phmsa.dot.gov/sites/phmsa.dot.gov/files/2022-05/32022026_Colonial_Pipeline_NOPV_PCP_PCO_05052022.pdf>

**Source excerpts:**
- <https://www.govinfo.gov/content/pkg/CHRG-117shrg46569/html/CHRG-117shrg46569.htm> — “Although the investigation is still ongoing, we believe the attacker exploited the legacy VPN profile that was not intended to be in use.”
- <https://www.energy.gov/ceser/articles/ceser-2021-emergency-response-recap> — “On May 7, 2021, the Colonial Pipeline Company proactively halted pipeline operations to contain the threat made by a ransomware attack on the company’s IT system.”
- <https://www.phmsa.dot.gov/sites/phmsa.dot.gov/files/2022-05/32022026_Colonial_Pipeline_NOPV_PCP_PCO_05052022.pdf> — “The full restart, which was followed by manual operations, was initiated in just five (5) days.”

## log4shell-2021 — Log4Shell (CVE-2021-44228) (2021)

**Current claim:** A JNDI lookup flaw in Log4j 2 could enable remote code execution when attacker-controlled text was logged and evaluated. The vulnerability was disclosed in December 2021.

**Data confidence:** high

**Cross-check note:** CISA describes Log4j’s JNDI/message-lookup flaw and the risk from adversary-controlled lookup endpoints. The summary now omits an unverified specific header example and limits itself to the documented logged-input behavior.

**Record source URLs:** <https://www.cisa.gov/news-events/cybersecurity-advisories/aa21-356a>

**Source excerpts:**
- <https://www.cisa.gov/news-events/cybersecurity-advisories/aa21-356a> — “Affected versions of Log4j contain JNDI features—such as message lookup substitution—that do not protect against adversary-controlled Lightweight Directory Access Protocol (LDAP), Domain Name System (DNS), and other JNDI related endpoints.”
- <https://www.cisa.gov/news-events/cybersecurity-advisories/aa21-356a> — “An adversary can exploit Log4Shell by submitting a specially crafted request to a vulnerable system that causes that system to execute arbitrary code.”

## drainer-2022 — Crypto drainer kits (wallet-approval phishing) (2022)

**Current claim:** Drainer kits masquerade as Web3 projects and abuse wallet approval requests to move assets out. A family of kits, not one breach. The cost to the attacker is a landing page and a signing prompt.

**Data confidence:** high

**Cross-check note:** Chainalysis describes drainer operators posing as Web3 projects and inducing users to approve wallet transactions that grant control of funds. The entry is explicitly a family of approval-phishing kits, not one breach.

**Record source URLs:** <https://www.chainalysis.com/blog/crypto-drainers/>

**Source excerpts:**
- <https://www.chainalysis.com/blog/crypto-drainers/> — “Instead of stealing the usernames and passwords of victims, the operators of drainers often masquerade as web3 projects, enticing victims into connecting their crypto wallets to the drainer and approving transaction proposals that grant the operator control of the funds inside the wallet.”


## lapsus-2022 — LAPSUS$ (Okta / Microsoft / T-Mobile / Uber) (2022)

**Current claim:** A campaign rather than a single intrusion. Microsoft documents the combination of multi-factor prompt spam, help-desk social engineering, SIM swapping and purchased credentials.

**Data confidence:** high

**Cross-check note:** Microsoft documents MFA prompt spamming, help-desk social engineering, SIM swapping, and paid access to credentials/MFA approvals. The unsupported demographic claim was removed.

**Record source URLs:** <https://www.microsoft.com/en-us/security/blog/2022/03/22/dev-0537-criminal-actor-targeting-organizations-for-data-exfiltration-and-destruction/>

**Source excerpts:**
- <https://www.microsoft.com/en-us/security/blog/2022/03/22/dev-0537-criminal-actor-targeting-organizations-for-data-exfiltration-and-destruction/> — “Examples of these social engineering tactics include spamming a target user with multifactor authentication (MFA) prompts and calling the organization’s help desk to reset a target’s credentials.”
- <https://www.microsoft.com/en-us/security/blog/2022/03/22/dev-0537-criminal-actor-targeting-organizations-for-data-exfiltration-and-destruction/> — “Their tactics include phone-based social engineering; SIM-swapping to facilitate account takeover; accessing personal email accounts of employees at target organizations; paying employees, suppliers, or business partners of target organizations for access to credentials and multifactor authentication (MFA) approval.”

## lastpass-2022 — LastPass (2022) (2022)

**Current claim:** Two incidents. In the first, an engineer’s corporate laptop was compromised and development source code and internal secrets were accessed; LastPass says no customer vault data was in that environment. In the second, the attacker targeted a senior DevOps engineer using vulnerable third-party software and reached cloud backups containing customer vault data, most of it encrypted. The public account does not say that local vault files were copied from the endpoint.

**Data confidence:** high

**Cross-check note:** LastPass’s incident notices distinguish the August development-environment compromise from the later cloud-storage incident; they say customer data was not accessed in the first event and describe source-code theft and credentials/keys used against storage volumes later.

**Record source URLs:** <https://blog.lastpass.com/posts/security-incident-update-recommended-actions>

**Source excerpts:**
- <https://blog.lastpass.com/posts/notice-of-security-incident> — “While no customer data was accessed during the August 2022 incident, some source code and technical information were stolen from our development environment and used to target another employee, obtaining credentials and keys which were used to access and decrypt some storage volumes within the cloud-based storage service.”
- <https://blog.lastpass.com/posts/notice-of-security-incident> — “We have determined that an unauthorized party gained access to portions of the LastPass development environment through a single compromised developer account and took portions of source code and some proprietary LastPass technical information.”

## ukraine-2022 — Viasat KA-SAT disruption (2022) (2022)

**Current claim:** Viasat says the February 2022 KA-SAT attack exploited a VPN-appliance misconfiguration to reach the trusted management segment, then used legitimate management commands to overwrite modem flash and take tens of thousands of terminals offline. Kyivstar was a separate incident in December 2023 and is not included here.

**Data confidence:** high

**Cross-check note:** Viasat’s incident report identifies a VPN-appliance misconfiguration, access to the trusted management segment, lateral movement, and legitimate management commands that overwrote modem flash. It explicitly distinguishes the separate December 2023 Kyivstar incident.

**Record source URLs:** <https://www.viasat.com/perspectives/corporate/2022/ka-sat-network-cyber-attack-overview/>

**Source excerpts:**
- <https://www.viasat.com/perspectives/corporate/2022/ka-sat-network-cyber-attack-overview/> — “The attacker moved laterally through this trusted management network to a specific network segment used to manage and operate the network, and then used this network access to execute legitimate, targeted management commands on a large number of residential modems simultaneously.”
- <https://www.viasat.com/perspectives/corporate/2022/ka-sat-network-cyber-attack-overview/> — “Subsequent investigation and forensic analysis identified a ground-based network intrusion by an attacker exploiting a misconfiguration in a VPN appliance to gain remote access to the trusted management segment of the KA-SAT network.”

## moveit-2023 — MOVEit / Cl0p (CVE-2023-34362) (2023)

**Current claim:** CISA and the FBI said the CL0P group began exploiting a previously unknown SQL injection vulnerability, CVE-2023-34362, in Progress Software's MOVEit Transfer on May 27, 2023, installing the LEMURLOOT web shell to steal data from MOVEit databases. Emsisoft's June 2024 tally of public disclosures counted 2,773 organizations and 95,788,491 individuals affected.

**Data confidence:** high

**Cross-check note:** CISA/FBI advisory AA23-158A retains the May 27, 2023 start, the previously unknown SQL injection, LEMURLOOT web shell and data theft from MOVEit databases. Emsisoft’s page retains the 2,773-organization and 95,788,491-individual tally as of June 28, 2024, sourced from public disclosures. The earlier “no authentication or user interaction” sentence was removed because the retained passages do not state it.

**Record source URLs:** <https://nvd.nist.gov/vuln/detail/CVE-2023-34362> · <https://www.cisa.gov/news-events/cybersecurity-advisories/aa23-158a> · <https://www.emsisoft.com/en/blog/44123/unpacking-the-moveit-breach-statistics-and-analysis/>

**Source excerpts:**
- <https://www.cisa.gov/news-events/cybersecurity-advisories/aa23-158a> — “According to open source information, beginning on May 27, 2023, CL0P Ransomware Gang, also known as TA505, began exploiting a previously unknown SQL injection vulnerability (CVE-2023-34362) in Progress Software's managed file transfer (MFT) solution known as MOVEit Transfer.”
- <https://www.cisa.gov/news-events/cybersecurity-advisories/aa23-158a> — “Internet-facing MOVEit Transfer web applications were infected with a web shell named LEMURLOOT, which was then used to steal data from underlying MOVEit Transfer databases.”
- <https://www.emsisoft.com/en/blog/44123/unpacking-the-moveit-breach-statistics-and-analysis/> — “The data is sourced from state breach notifications, SEC filings, other public disclosures, as well as Cl0p's website, and is current as of June 28th, 2024. Organizations: 2,773 Individuals: 95,788,491”

## oauth-2023 — OAuth consent phishing (AiTM precursor, category) (2023)

**Current claim:** A technique family, not one breach. The user approves a consent screen that names an application and lists scopes, and grants access without being sent to a fake login at all.

**Data confidence:** high

**Cross-check note:** Microsoft Entra guidance defines consent phishing as tricking a user into granting permissions to a malicious cloud app. The synthetic walkthrough demonstrates the consent mechanism without a fake login or real account.

**Record source URLs:** <https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/protect-against-consent-phishing>

**Source excerpts:**
- <https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/protect-against-consent-phishing> — “Consent phishing attacks trick users into granting permissions to malicious cloud applications.”
- <https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/protect-against-consent-phishing> — “png) ## Mitigating consent phishing attacks Administrators, users, or Microsoft security researchers might flag OAuth applications that appear to behave suspiciously.”

## att-2024 — AT&T (third-party cloud workspace) (2024)

**Current claim:** AT&T told the SEC that threat actors accessed an AT&T workspace on a third-party cloud platform and, between April 14 and 25, 2024, exfiltrated files of customer call and text records from 2022 and one day in 2023, not call or text content. Reuters reported AT&T's estimate of about 109 million customer accounts. The cited public sources do not establish how access was first obtained.

**Data confidence:** high

**Cross-check note:** AT&T’s Form 8-K (retrieved from SEC EDGAR) retains the third-party cloud workspace, April 14–25, 2024 exfiltration window, call/text records (not content) and 2022/2023 record dates. Reuters supplies the roughly 109-million-account estimate (search-result extract; page returned HTTP 401). The Snowflake attribution was dropped from the claim because no retained passage states it; the Senate letter returned HTTP 403.

**Record source URLs:** <https://www.reuters.com/technology/cybersecurity/att-says-data-around-109-mln-us-customer-accounts-illegally-downloaded-2024-07-12/> · <https://www.sec.gov/Archives/edgar/data/732717/000073271724000046/t-20240506.htm> · <https://www.blumenthal.senate.gov/imo/media/doc/2024-07-16_snowflake_breach_att.pdf>

**Search-result extract (Reuters page fetch returned HTTP 401):** “AT&T said on Friday the company suffered a massive hacking incident as data from about 109 million customer accounts containing records of calls and texts from 2022 was illegally downloaded in April.” The full source remains linked above.

**Source excerpts:**
- <https://www.sec.gov/Archives/edgar/data/732717/000073271724000046/t-20240506.htm> — “AT&T believes that threat actors unlawfully accessed an AT&T workspace on a third-party cloud platform and, between April 14 and April 25, 2024, exfiltrated files containing AT&T records of customer call and text interactions that occurred between approximately May 1 and October 31, 2022, as well as on January 2, 2023”

## bec-2024 — Business Email Compromise (invoice thread) (2024)

**Current claim:** A technique family, not a single 2024 incident. The attacker enters an existing conversation rather than starting a new one, so the thread already looks legitimate and the payment is already urgent.

**Data confidence:** high

**Cross-check note:** FBI guidance describes criminals gaining access to legitimate email threads about billing and invoices; Microsoft documents attackers replying to ongoing payment threads after mailbox compromise. The record is a technique family, not a canonical 2024 incident.

**Record source URLs:** <https://www.fbi.gov/news/stories/business-e-mail-compromise-on-the-rise> · <https://www.ic3.gov/PSA/2024/PSA240911> · <https://www.microsoft.com/en-us/security/blog/2022/07/12/from-cookie-theft-to-bec-attackers-use-aitm-phishing-sites-as-entry-point-to-further-financial-fraud/>

**Source excerpts:**
- <https://www.microsoft.com/en-us/security/blog/2022/07/12/from-cookie-theft-to-bec-attackers-use-aitm-phishing-sites-as-entry-point-to-further-financial-fraud/> — “Payment fraud is a scheme wherein an attacker tricks a fraud target into transferring payments to attacker-owned accounts. It can be achieved by hijacking and replying to ongoing finance-related email threads in the compromised account’s mailbox and luring the fraud target to send money through fake invoices, among others.”

## changehealth-2024 — Change Healthcare (Citrix portal, no MFA) (2024)

**Current claim:** UnitedHealth CEO Andrew Witty testified that attackers used compromised credentials to access a Change Healthcare Citrix portal without MFA, exfiltrated data, and deployed ransomware nine days later. The outage disrupted claims, pharmacy, and provider-payment services; Witty confirmed at a Senate Finance hearing that UnitedHealth paid a $22 million ransom.

**Data confidence:** high

**Cross-check note:** The May 1, 2024 House Energy and Commerce prepared testimony—not the Senate Finance statement—specifies that compromised credentials accessed the Citrix portal without MFA, data was exfiltrated, and ransomware followed nine days later. The $22 million ransom payment, confirmed by Witty at the Senate Finance hearing, is supported by a secondary summary (National CIO Review); the Senate statement and Reuters pages returned HTTP 403/401 and were not retained.

**Record source URLs:** <https://www.reuters.com/technology/cybersecurity/unitedhealth-hackers-took-advantage-citrix-vulnerabilty-break-ceo-says-2024-04-29/> · <https://www.finance.senate.gov/imo/media/doc/0501_witty_testimony.pdf> · <https://www.finance.senate.gov/hearings/hacking-americas-health-care-assessing-the-change-healthcare-cyber-attack-and-whats-next> · <https://www.congress.gov/118/meeting/house/117242/witnesses/HHRG-118-IF02-Wstate-WittyS-20240501-U5.pdf> · <https://nationalcioreview.com/articles-insights/extra-bytes/unitedhealth-ceo-testifies-before-congress-regarding-massive-security-breach/>

**Source excerpts:**
- <https://www.congress.gov/118/meeting/house/117242/witnesses/HHRG-118-IF02-Wstate-WittyS-20240501-U5.pdf> — “On February 12, criminals used compromised credentials to remotely access a Change Healthcare Citrix portal, an application used to enable remote access to desktops. The portal did not have multi-factor authentication.”
- <https://www.congress.gov/118/meeting/house/117242/witnesses/HHRG-118-IF02-Wstate-WittyS-20240501-U5.pdf> — “Once the threat actor gained access, they moved laterally within the systems in more sophisticated ways and exfiltrated data. Ransomware was deployed nine days later.”
- <https://www.congress.gov/118/meeting/house/117242/witnesses/HHRG-118-IF02-Wstate-WittyS-20240501-U5.pdf> — “From pharmacists having to manually submit claims to the rural family medicine practice struggling to make payroll – the impacts of an attack by organized criminals, no matter how temporary, were real.”
- <https://nationalcioreview.com/articles-insights/extra-bytes/unitedhealth-ceo-testifies-before-congress-regarding-massive-security-breach/> — “During Wednesday’s U.S. Senate Committee on Finance hearing, UnitedHealth Group CEO Andrew Witty confirmed the company paid a $22 million ransom following the cyberattack on its subsidiary, Change Healthcare.”

## npd-2024 — National Public Data / Infobroker (2024)

**Current claim:** Public reporting described an alleged release of billions of records from a background-check data broker; the number of unique people remains unconfirmed. The company's notice said a third party attempted to access its data in late December 2023, but the public record cited here does not establish a specific entry mechanism.

**Data confidence:** medium

**Cross-check note:** The House inquiry, Maryland notification, and public reporting support the alleged large record release and late-December-2023 attempted access. The number of unique people and the initial access route remain unconfirmed, so the record retains medium confidence.

**Record source URLs:** <https://www.nytimes.com/2024/08/15/business/social-security-numbers-stolen-hack.html> · <https://oversight.house.gov/wp-content/uploads/2024/08/NPD-Breach-Letter-08222024.pdf> · <https://oag.maryland.gov/resources-info/SBN%20Documents/2024/ITU-375412.pdf>

**Source excerpts:**
- <https://oversight.house.gov/wp-content/uploads/2024/08/NPD-Breach-Letter-08222024.pdf> — “It is reported that the personal information of nearly 3 billion people were compromised, with the stolen data including information such as Social Security numbers, phone numbers, email addresses, and mailing addresses.”
- <https://oversight.house.gov/wp-content/uploads/2024/08/NPD-Breach-Letter-08222024.pdf> — “It isn’t even clear whether the attack has impacted close to 3 billion records or individuals, as news reports have described it both ways.”
- <https://oag.maryland.gov/resources-info/SBN%20Documents/2024/ITU-375412.pdf> — “There appears to have been a data security incident that may have involved some of your personal information. The incident is believed to have involved a third-party bad actor that was trying to hack into data in late December 2023, with potential leaks of certain data in April 2024 and summer 2024.”

## quishing-2024 — Quishing (QR-code phishing) (2024)

**Current claim:** A technique family, not one breach. The Federal Trade Commission documents QR codes on physical media redirecting to spoofed credential-stealing sites, and notes that unlike a link in an email, the destination cannot be read before following it.

**Data confidence:** high

**Cross-check note:** FTC guidance says QR codes can conceal harmful links and lead to spoofed sites. This is a technique family, not a single incident.

**Record source URLs:** <https://consumer.ftc.gov/consumer-alerts/2023/12/scammers-hide-harmful-links-qr-codes-steal-your-information>

**Source excerpts:**
- <https://consumer.ftc.gov/consumer-alerts/2023/12/scammers-hide-harmful-links-qr-codes-steal-your-information> — “Unfortunately, scammers hide harmful links in QR codes to steal personal information.”
- <https://consumer.ftc.gov/consumer-alerts/2023/12/scammers-hide-harmful-links-qr-codes-steal-your-information> — “A scammer’s QR code could take you to a spoofed site that looks real but isn’t.”

## salesforce-2025 — Salesforce / UNC6040 vishing (2025)

**Current claim:** A campaign, not one incident. Google documents a pattern of voice-phishing callers leading employees to approve a malicious connected application, followed by data being exported with an attacker-controlled tool. Figures circulating about this campaign should be sourced per-campaign rather than merged.

**Data confidence:** high

**Cross-check note:** Google Threat Intelligence documents voice-phishing calls that led employees to approve a malicious Salesforce Data Loader connected app and enabled data theft. The entry keeps campaign-specific figures separate.

**Record source URLs:** <https://cloud.google.com/blog/topics/threat-intelligence/voice-phishing-data-extortion>

**Source excerpts:**
- <https://cloud.google.com/blog/topics/threat-intelligence/voice-phishing-data-extortion> — “During a vishing call, the actor guides the victim to visit Salesforce's connected app setup page to approve a version of the Data Loader app with a name or branding that differs from the legitimate version.”
- <https://cloud.google.com/blog/topics/threat-intelligence/voice-phishing-data-extortion> — “This approach has proven particularly effective in tricking employees, often within English-speaking branches of multinational corporations, into actions that grant the attackers access or lead to the sharing of sensitive credentials, ultimately facilitating the theft of organization’s Salesforce data.”

## sharepoint-2025 — SharePoint ToolShell (CVE-2025-53770) (2025)

**Current claim:** Microsoft observed exploitation of a deserialisation flaw in the SharePoint ToolPane by unauthenticated requests, followed by web shells being written and the server MachineKey being read and stolen.

**Data confidence:** high

**Cross-check note:** Microsoft’s MSRC guidance describes unauthenticated ToolPane exploitation, web-shell activity, and MachineKey retrieval/theft in on-premises SharePoint attacks. The summary is restricted to the observed CVE-2025-53770 activity.

**Record source URLs:** <https://msrc.microsoft.com/update-guide/vulnerability/CVE-2025-53770> · <https://www.microsoft.com/en-us/msrc/blog/2025/07/customer-guidance-for-sharepoint-vulnerability-cve-2025-53770>

**Source excerpts:**
- <https://www.microsoft.com/en-us/security/blog/2025/07/22/disrupting-active-exploitation-of-on-premises-sharepoint-vulnerabilities/> — “Microsoft observed multiple threat actors conducting reconnaissance and attempting exploitation of on-premises SharePoint servers through a POST request to the ToolPane endpoint.”
- <https://www.microsoft.com/en-us/security/blog/2025/07/22/disrupting-active-exploitation-of-on-premises-sharepoint-vulnerabilities/> — “Threat actors who successfully executed the authentication bypass and remote code execution exploits against vulnerable on-premises SharePoint servers have been observed using a web shell in their post-exploitation payload.”

## Coverage and limits

Records: 50. Records with at least one source excerpt: 50. Excerpts: 92 (29 manually retained from fetched/search material; one is explicitly labeled a search-result extract). Records relying on the source-specific review note without a retained excerpt: 0. Dataset source URL references: 107. A passage may support only one clause in a narrative. The record’s confidence field and uncertainty wording remain authoritative. Automated source-check verdicts were frequently “unclear” because semantic assessment was unavailable; these artifacts are a manually reviewed second pass, not third-party expert certification.
