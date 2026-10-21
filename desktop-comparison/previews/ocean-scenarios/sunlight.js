// Sunlight scenarios (owner: content-sunlight). 12 attacks, one entry per id in data/ocean-selection.json depths.sunlight.
// Fields follow the AUTHORED shape in ocean-scenes.js plus depth, family, year, attackTitle, os, card, focusApps, attackKind
// (docs/desktop-parity/SCENARIOS-60-CONTRACT.md). Organisations, people and products are invented; only attackTitle and year name the real attack.
(() => {
  'use strict';
  const S = (globalThis.OceanScenarioData ||= {});

  S['macdefender-2011'] = {
    depth: 'sunlight', family: 'deception', year: 2011, attackTitle: 'MacDefender (2011)', os: 'macos',
    card: { victim: 'freelance translator working from home', software: 'a web browser on a Mac', firstAction: 'click a photo in an image search for a lemon tart recipe', next: 'The page you land on starts a "virus scan" of your Mac.' },
    focusApps: ['browser', 'files'], attackKind: 'scareware',
    title: 'The scan that found everything',
    intro: 'You searched for a recipe photo and the result opened a page full of progress bars. A scan seems to be running on your Mac.',
    via: 'browser',
    toast: ['Browser', 'ShieldLeaf Scan', 'Scanning your Mac... 14 threats found. Remove them now.'],
    page: { url: 'shieldleaf-scan.example/mac', brand: 'ShieldLeaf', headline: '14 threats found on your Mac', text: 'A scan of your files found viruses. Download the ShieldLeaf security tool to remove them and protect your Mac.', button: 'Download ShieldLeaf' },
    file: ['ShieldLeaf-Setup.zip', 'Compressed archive', '1.9 MB'],
    caption: 'The "antivirus" installs itself, then the alerts start asking for a card number.',
    effect: 'Fake alerts spread across the desktop and a payment demand follows.',
    targets: [['ShieldLeaf window', 'window'], ['Login items', 'setting'], ['Saved card details', 'secret'], ['Downloads folder', 'file']],
    fell: ['The scan was a stage prop', ['Stage 1, the page: a web page cannot scan your Mac. The safe step was to close the tab without clicking the download button.', 'Stage 2, the file: a security tool you did not choose has no place in your Downloads folder. The safe step was to move it to the Trash unopened.', 'Later the "full version" asks for a card number. Stop there and tell someone instead of paying.']],
    safe: ['You closed the tab', ['Closing the tab and trashing the file left the "threats" with nothing to run.', 'If you are unsure, check your Mac with its own built-in tools, never with a page banner.', 'Tell your household or IT contact that the page exists.']],
  };

  S['follina-2022'] = {
    depth: 'sunlight', family: 'intrusion', year: 2022, attackTitle: 'Follina (2022)', os: 'windows',
    card: { victim: 'policy analyst at a regional trade office', software: 'a word processor on a Windows PC', firstAction: 'receive a revised interview schedule from a partner agency', next: 'The document needs to be read before the 2 pm briefing.' },
    focusApps: ['mail', 'files'], attackKind: 'macro-dropper',
    title: 'Delegation schedule',
    intro: 'A visiting delegation changes its plans. A revised schedule arrives as a document, and the briefing starts at 2 pm.',
    via: 'mail', from: ['Anselm Ferro', 'a.ferro@delegation-office.example'], subject: 'Delegation interview schedule: revised',
    toast: ['Mail', 'Anselm Ferro', 'Delegation interview schedule: revised copy attached.'],
    body: ['Please find the revised interview schedule for the delegation visit.', 'Open it before the briefing so you can see the room changes.'],
    file: ['Delegation-Schedule-rev2.docx', 'Document', '184 KB'],
    caption: 'The document calls out to a remote page, and the viper slips in through a support tool.',
    effect: 'The document launches a command from a remote page. No macro prompt ever appears.',
    targets: [['Document window', 'window'], ['Support diagnostic tool', 'setting'], ['Work files', 'file'], ['Saved sessions', 'secret']],
    fell: ['Opening the document was the whole attack', ['Stage 1, the mail: a "revised" schedule from an agency you rarely deal with. The safe step was to call that contact on a number you already have before opening anything.', 'Stage 2, the file: no macro warning appeared, so nothing signalled danger. The safe step was to delete the file, or open it only in a read-only preview.', 'Report the mail so IT can look for the same document in other inboxes.']],
    safe: ['You checked before you opened it', ['A call to the delegation office showed no revised schedule had been sent.', 'Deleting the file kept it from ever contacting the outside page.', 'Reporting the mail let IT pull it from the other inboxes.']],
  };

  S['mydoom-2004'] = {
    depth: 'sunlight', family: 'network-abuse', year: 2004, attackTitle: 'Mydoom (2004)', os: 'windows',
    card: { victim: 'front-office clerk at a small auto-parts shop', software: 'a desktop mail program on Windows', firstAction: 'see a delivery failure notice in your inbox', next: 'A small archive is attached to it.' },
    focusApps: ['mail', 'files'], attackKind: 'mass-mail-worm',
    title: 'Mail transaction failed',
    intro: 'The shop runs its mail from one old PC. A returned-mail notice lands in the inbox with an attachment.',
    via: 'mail', from: ['Mail Delivery Subsystem', 'mailer-daemon@postfix-relay.example'], subject: 'Mail transaction failed: partial message is available',
    toast: ['Mail', 'Mail Delivery Subsystem', 'Mail transaction failed. The message text is attached.'],
    body: ['The message could not be delivered to one or more recipients.', 'The text of the message is in the attachment. Open it to see what was not sent.'],
    file: ['returned-text.zip', 'Compressed archive', '22 KB'],
    caption: 'One double-click and the worm starts mailing itself to every address on the PC.',
    effect: 'Copies go to every address it finds, and the PC quietly opens a back door.',
    targets: [['Address book', 'account'], ['Mail program', 'window'], ['Outgoing mail', 'network'], ['Saved addresses file', 'file']],
    fell: ['The PC became a mail relay', ['Stage 1, the mail: you had not sent anything that could bounce, so the notice did not fit. The safe step was to delete it.', 'Stage 2, the file: archives from delivery notices should never be run. The safe step was to leave it unopened and ask whoever looks after the PC.', 'Warn your contacts if copies already went out in the shop\'s name.']],
    safe: ['You deleted the failure notice', ['No message of yours had bounced, so deleting the notice was right.', 'The unopened archive never ran, so no copies were mailed.', 'Mention odd notices to the shop\'s IT contractor.']],
  };

  S['keranger-2016'] = {
    depth: 'sunlight', family: 'trusted-source', year: 2016, attackTitle: 'KeRanger (2016)', os: 'macos',
    card: { victim: 'video editor at a small studio', software: 'a Mac and a file-sharing app', firstAction: 'open the official download page for a new version of the app', next: 'The page offers version 2.90 as a disk image.' },
    focusApps: ['browser', 'files'], attackKind: 'supply-chain-update',
    title: 'The official download',
    intro: 'Your file-sharing app has a new version. You fetch it from its own website, as you always do.',
    via: 'browser',
    toast: ['Browser', 'RippleBit 2.90', 'Version 2.90 is available. Download the new release.'],
    page: { url: 'ripplebit-app.example/mac', brand: 'RippleBit', headline: 'RippleBit 2.90 is here', text: 'The new release comes as a disk image. Download it and drag the app to Applications.', button: 'Download for Mac' },
    file: ['RippleBit-2.90.dmg', 'Disk image', '5.6 MB'],
    caption: 'The site was real and the file was swapped. After a quiet wait, the app locks your files.',
    effect: 'The app sleeps for days, then locks your documents and asks for payment.',
    targets: [['RippleBit app', 'window'], ['Documents folder', 'file'], ['Backup volume', 'file'], ['Startup items', 'setting']],
    fell: ['A trusted site served a bad build', ['Stage 1, the page: nothing looked wrong, because the real site had been tampered with. The safe step was to check the publisher\'s announcement or a published checksum first.', 'Stage 2, the file: a build that changed within hours deserves a wait. The safe step was to trash the image and wait for a confirmed-clean release.', 'Keep an offline backup, so a locked folder is an annoyance and not a loss.']],
    safe: ['You waited for confirmation', ['Closing the page and leaving the image closed kept the bad build off the Mac.', 'Checking the publisher\'s own notice would have flagged the swap.', 'An offline backup means even a bad build cannot lock your only copy.']],
  };

  S['carbanak-2015'] = {
    depth: 'sunlight', family: 'theft-surveillance', year: 2015, attackTitle: 'Carbanak (2015)', os: 'windows',
    card: { victim: 'back-office clerk at a regional bank', software: 'a desktop mail program on Windows', firstAction: 'open a message that looks like it came from head office', next: 'It has a form about wire approval limits attached.' },
    focusApps: ['mail', 'files'], attackKind: 'spyware-surveillance',
    title: 'Updated wire limits',
    intro: 'Head office sends a form about wire approval limits. It will affect how you process payments today.',
    via: 'mail', from: ['Sabine Orlov, Head Office', 's.orlov@larkspur-savings-hq.example'], subject: 'Updated wire approval limits: please review',
    toast: ['Mail', 'Sabine Orlov, Head Office', 'Updated wire approval limits: please review the attached form.'],
    body: ['Head office has updated the wire approval limits for branch back offices.', 'The new limits form is attached. Please review it before the end of the day.'],
    file: ['Wire-Limits-2015.doc', 'Document', '96 KB'],
    caption: 'The form opens quietly and a hidden recorder starts watching how you work.',
    effect: 'Screens and keystrokes are watched for weeks before any money moves.',
    targets: [['Banking terminal window', 'window'], ['Screen recording', 'secret'], ['Payment queue', 'network'], ['Admin account', 'account']],
    fell: ['The clerk\'s screen became the attacker\'s classroom', ['Stage 1, the mail: the sender domain was a look-alike of the bank\'s own. The safe step was to check the address closely and report the message.', 'Stage 2, the file: opening a form from a look-alike sender started the hidden recorder. The safe step was to delete it and confirm with head office by phone.', 'The attackers then learned the payment routine just by watching, which is why reporting early matters.']],
    safe: ['You verified with head office first', ['A call to head office showed that no limits update existed.', 'Reporting the look-alike address let the bank block the domain.', 'The unopened form never installed anything.']],
  };

  S['pc-cyborg-1989'] = {
    depth: 'sunlight', family: 'extortion-destruction', year: 1989, attackTitle: 'PC Cyborg / AIDS Trojan (1989)', os: 'windows',
    card: { victim: 'research administrator at a health charity', software: 'a desktop PC', firstAction: 'find a diskette in this morning\'s post', next: 'The mailroom has copied its files to your Downloads folder.' },
    focusApps: ['mail', 'files'], attackKind: 'ransomware-encrypt',
    title: 'The diskette in the post',
    intro: 'A diskette about health risk arrived in the post. The mailroom sends you a memo and copies its files onto your PC. The real diskette came by post; this memo is the stand-in.',
    via: 'mail', from: ['Mailroom', 'mailroom@fenwick-trust.example'], subject: 'Diskette for you from the post: health information',
    toast: ['Mail', 'Mailroom', 'A diskette came in the post for you. Its files are copied to Downloads.'],
    body: ['A health information diskette arrived addressed to you. It says the program assesses personal risk.', 'The mailroom copied its contents to your Downloads folder. Run the setup program to start.'],
    file: ['SETUP.EXE', 'Program', '41 KB'],
    caption: 'The setup program counts your restarts, then scrambles your file names and asks for payment.',
    effect: 'File names are scrambled after about 90 restarts and a bill appears on screen.',
    targets: [['Setup program', 'window'], ['File names', 'file'], ['Startup file', 'setting'], ['Payment letter', 'secret']],
    fell: ['A diskette in the post carried the trap', ['Stage 1, the memo: an unrequested diskette is not safe to run. The safe step was to leave it with the mailroom and ask IT to check it first.', 'Stage 2, the file: running the setup program started a counter that did nothing for weeks. The safe step was to delete the copied files unopened.', 'Today the same trick arrives on a USB stick or behind a download link.']],
    safe: ['You left the diskette alone', ['Asking IT first kept the program from ever running.', 'Unrequested media from the post deserves the same caution as an unexpected attachment.', 'Back up files separately, so a locked machine costs you hours and not years.']],
  };

  S['melissa-1999'] = {
    depth: 'sunlight', family: 'network-abuse', year: 1999, attackTitle: 'Melissa (1999)', os: 'windows',
    card: { victim: 'office assistant at a small law firm', software: 'a mail program and a word processor on Windows', firstAction: 'read a message from a colleague named Hollis', next: 'It says the attached document is the one you asked for.' },
    focusApps: ['mail', 'files'], attackKind: 'mass-mail-worm',
    title: 'The document you asked for',
    intro: 'A colleague\'s name is on a message with a document attached. It sounds sure of itself, and you think you might have asked.',
    via: 'mail', from: ['Hollis Carr', 'hollis.carr@pryce-hartwell.example'], subject: 'Important message from Hollis Carr',
    toast: ['Mail', 'Hollis Carr', 'Important message from Hollis Carr. Here is that document you asked for.'],
    body: ['Here is that document you asked for. Do not show it to anyone else.', 'It has the list in it.'],
    file: ['Requested-List.doc', 'Document', '54 KB'],
    caption: 'Open the document and its macro mails a copy to the first names in your address book.',
    effect: 'Fifty copies leave in your name, each one pointing at a colleague.',
    targets: [['Address book', 'account'], ['Mail program', 'window'], ['Document template', 'setting'], ['Outgoing mail', 'network']],
    fell: ['Fifty colleagues got your copy', ['Stage 1, the mail: the note was vague and asked for secrecy. The safe step was to phone Hollis, since a real document would not need to be hidden.', 'Stage 2, the file: a document can carry a macro that runs when it opens. The safe step was to delete it unopened.', 'Warn the people in your address book at once; they will see your name on the message.']],
    safe: ['You phoned before you opened', ['Hollis had sent nothing. One short call stopped the chain at your desk.', 'Unopened, the document\'s macro never mailed a copy.', 'Telling the office manager let the firm warn everyone else.']],
  };

  S['iloveyou-2000'] = {
    depth: 'sunlight', family: 'deception', year: 2000, attackTitle: 'ILOVEYOU (2000)', os: 'windows',
    card: { victim: 'junior accountant at a shipping agency', software: 'a mail program on Windows', firstAction: 'open a message from a coworker titled "Love note"', next: 'It says the attached note is meant for you.' },
    focusApps: ['mail', 'files'], attackKind: 'mass-mail-worm',
    title: 'A little love note',
    intro: 'A coworker has sent you a personal note with an attachment. Nobody at the desks nearby is looking up.',
    via: 'mail', from: ['Mara Lindqvist', 'mara.lindqvist@tamarind-ship.example'], subject: 'Love note: please read',
    toast: ['Mail', 'Mara Lindqvist', 'Love note: please read the attached note.'],
    body: ['I wanted to tell you something. Please read the attached note.', 'It is only for you.'],
    file: ['Admirer-Note.txt.vbs', 'Script file', '11 KB'],
    caption: 'The "text file" is really a script that overwrites files and mails itself onward.',
    effect: 'Documents and pictures are overwritten and copies go to your whole address book.',
    targets: [['Address book', 'account'], ['Pictures folder', 'file'], ['Documents folder', 'file'], ['Saved passwords', 'secret']],
    fell: ['A text file that was really a program', ['Stage 1, the mail: a personal note from a coworker pulls at curiosity and skips suspicion. The safe step was to ask Mara in person, and to report it if she knew nothing.', 'Stage 2, the file: Windows can hide the last extension, so a script looks like text. The safe step was to delete it and turn file extensions on.', 'The script overwrote files, so restore from a backup, not from the damaged folders.']],
    safe: ['You asked Mara first', ['Mara knew nothing about the note, which exposed the lure at stage 1.', 'The second extension (".vbs") showed the file was a script, not text.', 'Deleting it meant no files were overwritten and no copies were sent.']],
  };

  S['emotet-attachment'] = {
    depth: 'sunlight', family: 'intrusion', year: 2020, attackTitle: 'Emotet (2020)', os: 'windows',
    card: { victim: 'accounts-payable clerk at a distribution company', software: 'a word processor on a Windows PC', firstAction: 'read the latest reply in an overdue invoice thread', next: 'The reply has a statement attached.' },
    focusApps: ['mail', 'files'], attackKind: 'macro-dropper',
    title: 'Re: Overdue invoice',
    intro: 'A supplier you know replies in an invoice thread already in your inbox. This time a statement is attached.',
    via: 'mail', from: ['Silvio Marchetti', 's.marchetti@harrowgate-supply.example'], subject: 'Re: Overdue invoice 20-4471',
    toast: ['Mail', 'Silvio Marchetti', 'Re: Overdue invoice 20-4471. Please see the attached statement.'],
    body: ['Following up on our last exchange: the statement for invoice 20-4471 is attached.', 'If the figures look wrong, enable editing and content to see the detail.'],
    file: ['Statement-20-4471.doc', 'Document', '318 KB'],
    caption: 'Enable content and the document fetches a loader. The viper keeps the door open for others.',
    effect: 'A loader installs, reads your mailbox and sells access to other crews.',
    targets: [['Mail thread history', 'account'], ['Document macro', 'setting'], ['Network shares', 'network'], ['Saved browser logins', 'secret']],
    fell: ['A real thread and a stolen reply', ['Stage 1, the mail: the reply sat inside a genuine invoice thread, so it looked safe; the supplier\'s mailbox had been taken over. The safe step was to confirm the statement by phone with the supplier.', 'Stage 2, the file: the "enable editing and content" prompt is the whole trick. The safe step was to delete the file and enable nothing.', 'Report it; the supplier also needs to know their mailbox is compromised.']],
    safe: ['You phoned the supplier', ['A call showed Silvio had sent nothing.', 'No content was enabled, so the macro never ran.', 'Reporting let IT warn both companies and block the sender.']],
  };

  S['rsa-securid-2011'] = {
    depth: 'sunlight', family: 'theft-surveillance', year: 2011, attackTitle: 'RSA SecurID (2011)', os: 'windows',
    card: { victim: 'recruiting coordinator at a security-hardware company', software: 'a mail program and a spreadsheet on Windows', firstAction: 'pull a hiring-plan message out of the junk folder', next: 'It has a spreadsheet attached.' },
    focusApps: ['mail', 'files'], attackKind: 'data-exfil',
    title: 'The hiring plan',
    intro: 'A recruiting agency has sent the hiring plan you were waiting for. The spam filter had flagged it, but you need the figures for Thursday.',
    via: 'mail', from: ['Talentbridge Recruiting', 'plans@talentbridge-hire.example'], subject: '2011 hiring plan: updated headcount',
    toast: ['Mail', 'Talentbridge Recruiting', '2011 hiring plan: updated headcount attached.'],
    body: ['The updated headcount plan for 2011 is attached for your review.', 'Please open it before the Thursday planning call.'],
    file: ['Hiring-Plan-2011.xls', 'Spreadsheet', '74 KB'],
    caption: 'The spreadsheet hides an object that opens a door. Later the attackers copy out what they came for.',
    effect: 'A small remote tool lets the attackers move inward and copy sensitive files out.',
    targets: [['Spreadsheet window', 'window'], ['Internal file shares', 'file'], ['Staff accounts', 'account'], ['Outbound transfer', 'network']],
    fell: ['The first foothold was a spreadsheet', ['Stage 1, the mail: the filter had flagged it, and in the real attack the employee pulled it out of the junk folder. The safe step was to leave it in junk and report it.', 'Stage 2, the file: the embedded object ran as soon as the sheet opened. The safe step was to delete the file, or ask IT to open it in an isolated viewer.', 'A small foothold like this led to a far larger theft.']],
    safe: ['You left it in the junk folder', ['A filtered message is flagged for a reason; leaving it there was right.', 'Deleting the spreadsheet kept the embedded object from running.', 'Reporting the mail let IT check for the same message elsewhere.']],
  };

  S['cryptolocker-2013'] = {
    depth: 'sunlight', family: 'extortion-destruction', year: 2013, attackTitle: 'CryptoLocker (2013)', os: 'windows',
    card: { victim: 'bookkeeper at a plumbing supplier', software: 'a desktop mail program on Windows', firstAction: 'open a customer complaint notice', next: 'The details are in a zipped file attached to it.' },
    focusApps: ['mail', 'files'], attackKind: 'ransomware-encrypt',
    title: 'Customer complaint',
    intro: 'A consumer bureau says a customer has filed a complaint about your company. The details are attached, and a reply is due in five days.',
    via: 'mail', from: ['Customer Care Desk', 'care@tradeguard-bureau.example'], subject: 'Customer complaint: case 70331',
    toast: ['Mail', 'Customer Care Desk', 'Customer complaint: case 70331. Details attached.'],
    body: ['A complaint was filed against your company. The details are in the attached archive.', 'Please respond within 5 days.'],
    file: ['Complaint-70331.zip', 'Compressed archive', '96 KB'],
    caption: 'Run what is inside and your files are locked with a key the attackers keep.',
    effect: 'Documents, spreadsheets and pictures are locked and a countdown shows the payment demand.',
    targets: [['Documents folder', 'file'], ['Shared network drive', 'network'], ['Locked-files list', 'file'], ['Payment countdown', 'window']],
    fell: ['The files were locked for ransom', ['Stage 1, the mail: a complaint with a case number you did not recognise. The safe step was to look the case up on the bureau\'s own website, not through the message, and to report it.', 'Stage 2, the file: the program inside the archive ran at once. The safe step was to delete the archive without opening it.', 'Offline backups are the real defence once files are locked.']],
    safe: ['You checked the complaint first', ['The case number did not exist on the bureau\'s own site.', 'The archive stayed shut, so no files were locked.', 'Reporting it showed IT that the complaint campaign had reached the office.']],
  };

  S['locky-2016'] = {
    depth: 'sunlight', family: 'extortion-destruction', year: 2016, attackTitle: 'Locky (2016)', os: 'windows',
    card: { victim: 'front-desk administrator at a community clinic', software: 'a mail program and a word processor on Windows', firstAction: 'open an invoice sent to the clinic\'s billing address', next: 'The invoice is a document with a note about macros.' },
    focusApps: ['mail', 'files'], attackKind: 'ransomware-encrypt',
    title: 'Garbled invoice',
    intro: 'An invoice arrives at the clinic\'s shared billing address. The front desk usually forwards these to the billing manager.',
    via: 'mail', from: ['Accounts Receivable', 'ar@medsupply-invoices.example'], subject: 'Invoice J-82019: payment due',
    toast: ['Mail', 'Accounts Receivable', 'Invoice J-82019: payment due. Invoice attached.'],
    body: ['Please find invoice J-82019 attached.', 'If the text looks garbled, enable macros to display the invoice correctly.'],
    file: ['Invoice-J-82019.doc', 'Document', '142 KB'],
    caption: 'Enable macros and the document fetches a locker. Patient files become unreadable.',
    effect: 'Documents get random new names and every folder receives a payment note.',
    targets: [['Patient scans folder', 'file'], ['Shared appointments drive', 'network'], ['Macro setting', 'setting'], ['Payment note', 'window']],
    fell: ['A garbled invoice and a macro prompt', ['Stage 1, the mail: an unexpected invoice to a front desk, with an odd request to enable macros. The safe step was to ask the billing manager and report it.', 'Stage 2, the file: a real invoice never needs macros to be read. The safe step was to delete the file.', 'Clinics lean on shared drives, so keep an offline backup to keep patient care running.']],
    safe: ['You asked billing first', ['No supplier called J-82019 existed, and the billing manager knew it at once.', 'With macros off, the document stayed harmless text.', 'Reporting let IT filter the same invoice from other front-desk inboxes.']],
  };
})();
