// Abyss scenarios (owner: content-abyss). 12 real incidents rebuilt as fictional scenes; see docs/desktop-parity/SCENARIOS-60-CONTRACT.md §2.
// Brands, people, senders and pages are invented. The real attack name and year appear only in attackTitle, year and the debrief note.
// `date` is the in-scene "now" for the era (see docs/desktop-parity/requests/content-abyss-to-engine-core.md).
(() => {
  'use strict';
  const S = (globalThis.OceanScenarioData ||= {});

  const CONTAINMENT = 'In the Vultr-backed version the sandbox revokes the access and is torn down here. This local training desktop only describes that step; no Vultr sandbox ran.';

  S['bec'] = {
    depth: 'abyss', family: 'deception', year: 2024, date: '2024-09-12T13:40:00Z',
    attackTitle: 'Business email compromise (2024 FBI advisory)', os: 'windows',
    card: { victim: 'accounts-payable clerk at a regional building-supplies distributor', software: 'Windows 11 and the company mailbox', firstAction: 'check the inbox an hour before the 3 pm wire cut-off', next: 'A message that looks like it comes from the finance chief asks for one more approval.' },
    focusApps: ['mail', 'browser'],
    attackKind: 'money-transfer',
    title: 'The urgent wire',
    intro: 'The wire cut-off is at 3 pm. A message from the finance chief says one more payment must go out today.',
    from: ['Gareth Lindqvist', 'g.lindqvist@halvorsen-supply-mail.example'], subject: 'Urgent wire before 3 pm',
    toast: ['Mail', 'Gareth Lindqvist', 'Urgent wire before 3 pm. Details inside.'],
    body: ['I am boarding a flight and cannot take calls. A new aggregates supplier needs a wire before 3 pm or we lose the delivery slot.', 'Use the treasury page below and approve it yourself. Please keep this between us until it is done.'], link: 'Open the wire request',
    consent: { url: 'treasury.halvorsen-wires.example/approve', brand: 'Halvorsen Treasury', app: 'Wire Approval', publisher: 'Sender not verified', headline: 'Approve an urgent wire request?', perms: ['Release a wire of 62,500 today', 'Use the payee details from the email', 'Skip the usual call-back check'], allow: 'Approve' },
    journey: {
      steps: {
        payment: {
          url: 'treasury.halvorsen-wires.example/release', brand: 'Halvorsen Treasury', headline: 'Release wire', sub: 'Awaiting your approval',
          rows: [['Payee', 'Bluestone Aggregates Ltd'], ['Amount', '62,500'], ['Bank account', '00-00-00 · 00000000'], ['Payee status', 'New today'], ['Call-back check', 'Skipped']],
          release: 'Release wire', verify: 'Call the requester on a known number', second: 'Ask the second approver to verify', report: 'Report',
        },
      },
      debrief: {
        attack: 'Business email compromise (BEC)',
        consentNote: 'The approval page stands in for the moment a BEC victim agrees to the request. In real cases the email itself was the whole attack: no malware and no password was needed.',
        stages: [
          { id: 'lure', title: 'Lure', stepIds: ['toast', 'mail'], detail: 'A message from a look-alike of the finance chief asks for an urgent, private payment.', safeStep: 'Dismiss, delete or report the message, or call the sender on a known number.' },
          { id: 'consent', title: 'Approval', stepIds: ['consent'], detail: 'The request asks you to approve a new payee and skip the call-back check.', safeStep: 'Deny the request, or close the page.' },
          { id: 'payment', title: 'Payment', stepIds: ['payment'], detail: 'The wire waits for you to release it to an account that is new today.', safeStep: 'Verify with a known number, ask a second approver, or report.' },
          { id: 'attack', title: 'Attack', stepIds: [], detail: 'The wire is released to the attacker\'s account.', safeStep: null },
          { id: 'containment', title: 'Containment', stepIds: [], detail: CONTAINMENT, safeStep: null },
        ],
      },
    },
    caption: 'No malware and no password: your approval moves the money.',
    effect: 'A wire leaves for an account the attacker controls.',
    targets: [['Wire approval', 'window'], ['Payee details', 'setting'], ['Treasury account', 'account'], ['Wire transfer', 'network']],
    fell: ['Your approval moved the money', ['The email looked like the finance chief and pushed you to hurry and keep quiet.', 'A new payee and a skipped call-back check were both warning signs.', 'Call the requester on a number you already have, and ask a second approver, before you release a wire.']],
    safe: ['You broke the chain before the wire left', ['Denying, reporting or calling the finance chief on a known number each stopped the transfer.', 'The sender domain differed from the real company domain by one word.', 'Reporting lets the team warn accounts payable and recall any earlier request.']],
  };

  S['aurora-2010'] = {
    depth: 'abyss', family: 'intrusion', year: 2010, date: '2010-01-05T15:20:00Z',
    attackTitle: 'Operation Aurora (2010)', os: 'windows',
    card: { victim: 'build engineer at a mid-size software company', software: 'Windows and a web browser that has not been patched yet', firstAction: 'read a link a coworker forwarded after lunch', next: 'The page asks for nothing visible, but it wants to run something.' },
    focusApps: ['mail', 'browser'],
    attackKind: 'data-exfil',
    title: 'Slides from the reorg',
    intro: 'A coworker forwards a link to slides about next quarter\'s reorganisation. The page wants to run a component.',
    from: ['Kendra Voss', 'kendra.voss@brightloom.example'], subject: 'Fwd: have a look at this (reorg slides?)',
    toast: ['Mail', 'Kendra Voss', 'Fwd: have a look at this (reorg slides?)'],
    body: ['Saw this going around and thought of you. It shows the new team layout.', 'It opens in your browser.'], link: 'View page',
    consent: { url: 'preview.brightloom-share.example/view', brand: 'Slide Viewer', app: 'Page component', publisher: 'Unknown publisher', headline: 'Allow this page to run a component?', perms: ['Run an embedded viewer component', 'Read files your browser can reach', 'Keep running after you leave the page'], allow: 'Allow' },
    journey: {
      steps: {},
      debrief: {
        attack: 'Browser exploit followed by data theft',
        consentNote: 'This prompt stands in for a step that was invisible in the real incident: loading the page in an unpatched browser was enough, and no prompt appeared.',
        stages: [
          { id: 'lure', title: 'Lure', stepIds: ['toast', 'mail'], detail: 'A message from a coworker\'s address links to a page about the reorganisation.', safeStep: 'Dismiss, delete or report the message, or ask the coworker on a known channel.' },
          { id: 'consent', title: 'Page component', stepIds: ['consent'], detail: 'The page asks to run a component that reads files and keeps running.', safeStep: 'Deny the request, or close the page.' },
          { id: 'attack', title: 'Attack', stepIds: [], detail: 'The component opens a back door and quietly copies source code and documents out.', safeStep: null },
          { id: 'containment', title: 'Containment', stepIds: [], detail: CONTAINMENT, safeStep: null },
        ],
      },
    },
    caption: 'One page view opens a quiet door, and the viperfish walks out with the source code.',
    effect: 'Project files and source code are copied to an outside server.',
    targets: [['Reorg page', 'window'], ['Browser session', 'secret'], ['Source repository', 'file'], ['Outbound link', 'network']],
    fell: ['Opening the page was the break-in', ['No password and no file was needed: the page ran code in your browser.', 'The message came from a coworker\'s address, so it felt safe. Attackers had taken over that trust first.', 'Keep browsers patched, and ask the coworker on a known channel before you open a surprise link.']],
    safe: ['You did not let the page run', ['Denying, reporting or asking the coworker each stopped the attack before it began.', 'A link nobody announced, about a sensitive topic, is worth a second check.', 'Reporting lets the security team block the page for everyone.']],
  };

  S['great-cannon-2015'] = {
    depth: 'abyss', family: 'network-abuse', year: 2015, date: '2015-03-18T10:15:00Z',
    attackTitle: 'Great Cannon (2015)', os: 'windows',
    card: { victim: 'university student', software: 'a Windows laptop and an ordinary web browser', firstAction: 'open a forum digest between lectures', next: 'The forum page loads a stats script over an unencrypted link.' },
    focusApps: ['mail', 'browser'],
    attackKind: 'botnet-ddos',
    title: 'The forum digest',
    intro: 'A forum you follow sends its weekly digest. The page loads a third-party stats script over an unencrypted link.',
    from: ['Parkbench Forum', 'digest@parkbench-forum.example'], subject: 'Weekly digest: 5 threads you follow',
    toast: ['Mail', 'Parkbench Forum', 'Weekly digest: 5 threads you follow.'],
    body: ['Five threads you follow have new replies this week.', 'Open the digest to read them.'], link: 'Read threads',
    consent: { url: 'stats.parkbench-forum.example/loader', brand: 'Parkbench', app: 'Visitor stats script', publisher: 'Third-party analytics (unencrypted)', headline: 'Allow the stats script to load?', perms: ['Load a script over an unencrypted link', 'Send repeated requests in the background', 'Keep running while the tab stays open'], allow: 'Allow' },
    journey: {
      steps: {},
      debrief: {
        attack: 'Browser recruited into a flood of traffic',
        consentNote: 'No prompt appeared in the real incident: a network device swapped the stats script on unencrypted connections. The prompt here shows what the swap did.',
        stages: [
          { id: 'lure', title: 'Lure', stepIds: ['toast', 'mail'], detail: 'A routine digest links to a forum page that uses a third-party stats script.', safeStep: 'Dismiss or delete the message, or open the forum from your own bookmark.' },
          { id: 'consent', title: 'Script load', stepIds: ['consent'], detail: 'The unencrypted script can be replaced in transit with one that sends requests for someone else.', safeStep: 'Deny the request, or close the page.' },
          { id: 'attack', title: 'Attack', stepIds: [], detail: 'Your browser sends traffic to a site you never visited, together with thousands of other browsers.', safeStep: null },
          { id: 'containment', title: 'Containment', stepIds: [], detail: CONTAINMENT, safeStep: null },
        ],
      },
    },
    caption: 'Your idle browser tab becomes one more tentacle in a flood aimed at someone else.',
    effect: 'Repeated requests leave your browser for a site you never opened.',
    targets: [['Forum tab', 'window'], ['Stats script', 'file'], ['Background requests', 'network'], ['Target site (not you)', 'network']],
    fell: ['Your browser joined the flood', ['You lost nothing and saw nothing: the harm landed on the site being flooded.', 'The script travelled over an unencrypted link, so it could be swapped on the way.', 'Prefer encrypted pages, and close tabs you are not using.']],
    safe: ['You kept the script out', ['Denying or closing the page stopped your browser from sending any traffic.', 'Encrypted connections cannot be rewritten in transit, so the swap would have failed.', 'Reporting the odd behaviour helps the site move its scripts to encrypted links.']],
  };

  S['polyfill-io-2024'] = {
    depth: 'abyss', family: 'trusted-source', year: 2024, date: '2024-06-26T18:10:00Z',
    attackTitle: 'Polyfill.io (2024)', os: 'macos',
    card: { victim: 'concert-goer buying presale tickets', software: 'a MacBook and a browser', firstAction: 'open the presale page from an email', next: 'The ticket site loads a script from a library that quietly changed owners.' },
    focusApps: ['mail', 'browser'],
    attackKind: 'supply-chain-update',
    title: 'The presale page',
    intro: 'A ticket site you know has its presale open. It loads a helper library that changed owners this year.',
    from: ['Setlist Tickets', 'offers@setlist-tickets.example'], subject: 'Your presale starts now',
    toast: ['Mail', 'Setlist Tickets', 'Your presale starts now. Tickets are limited.'],
    body: ['Your presale code is active for the next two hours.', 'Open the presale page to pick your seats.'], link: 'Open presale',
    consent: { url: 'cdn.compat-lib.example/loader', brand: 'Setlist Tickets', app: 'Compatibility loader', publisher: 'New owner (changed this year)', headline: 'Allow the compatibility loader?', perms: ['Load a script from a new owner', 'Change what the page shows', 'Send some visitors to another site'], allow: 'Allow' },
    journey: {
      steps: {},
      debrief: {
        attack: 'Compromised third-party script',
        consentNote: 'Real visitors saw no prompt: the site loaded the library on its own. The prompt here makes that hidden trust visible.',
        stages: [
          { id: 'lure', title: 'Lure', stepIds: ['toast', 'mail'], detail: 'A genuine-looking presale email sends you to a site you already use.', safeStep: 'Dismiss, delete or report the message, or open the site from your own bookmark.' },
          { id: 'consent', title: 'Script load', stepIds: ['consent'], detail: 'The page loads a helper library whose new owner is unknown to the site\'s visitors.', safeStep: 'Deny the request, or close the page.' },
          { id: 'attack', title: 'Attack', stepIds: [], detail: 'The library sends some visitors to a scam page instead of the ticket page.', safeStep: null },
          { id: 'containment', title: 'Containment', stepIds: [], detail: CONTAINMENT, safeStep: null },
        ],
      },
    },
    caption: 'A once-trusted library flips, and the isopod rides in on a page you know.',
    effect: 'A trusted page quietly sends some visitors to a scam site.',
    targets: [['Presale page', 'window'], ['Helper library', 'file'], ['Page content', 'setting'], ['Visitor redirects', 'network']],
    fell: ['The page was real; the script was not', ['You approved a script from an owner nobody had checked.', 'One changed library reached over a hundred thousand sites at once.', 'Sites should host their own copies of scripts, and visitors should treat a sudden redirect as a warning.']],
    safe: ['You refused the new owner', ['Denying, reporting or closing the page each stopped the redirect.', 'The presale page works without the loader, so refusing cost nothing.', 'Reporting lets the site team pin its scripts and drop the library.']],
  };

  S['cambridge-analytica'] = {
    depth: 'abyss', family: 'theft-surveillance', year: 2018, date: '2014-05-14T19:30:00Z',
    attackTitle: 'Cambridge Analytica (2018 revelations)', os: 'windows',
    card: { victim: 'paid-survey participant working from home', software: 'a Windows laptop and a social network account', firstAction: 'pick up a personality survey that pays two units', next: 'The survey asks you to connect your social profile.' },
    focusApps: ['mail', 'browser'],
    attackKind: 'oauth-consent',
    title: 'The personality survey',
    intro: 'A survey panel offers a small payment for a personality quiz. The quiz wants to connect to your profile.',
    from: ['Panelpay Surveys', 'tasks@panelpay-surveys.example'], subject: 'New task: personality survey, reward 2.00',
    toast: ['Mail', 'Panelpay Surveys', 'New task: personality survey, reward 2.00.'],
    body: ['A research team needs adults to take a 10-minute personality survey.', 'Connect your profile so the result can be matched to your answers.'], link: 'Start the survey',
    consent: { url: 'personalitylab-app.example/connect', brand: 'Friendnest', app: 'Personality Lab', publisher: 'Northfield Research Ltd', headline: 'Personality Lab wants access to your profile', perms: ['Read your profile and likes', 'Read your friend list and their public details', 'Read your posts and birthday'], allow: 'Allow' },
    journey: {
      steps: {},
      debrief: {
        attack: 'Permission-based data harvest',
        consentNote: 'The permission screen was genuine in the real case. Participants consented to the quiz; the people whose data was collected through their friend lists never saw it.',
        stages: [
          { id: 'lure', title: 'Lure', stepIds: ['toast', 'mail'], detail: 'A survey task offers a small payment for a personality quiz.', safeStep: 'Dismiss or delete the task, or check the research team before you take part.' },
          { id: 'consent', title: 'Permission', stepIds: ['consent'], detail: 'The quiz asks for your profile and your friends\' public details.', safeStep: 'Deny the request, or close the page.' },
          { id: 'attack', title: 'Harvest', stepIds: [], detail: 'The app copies your data and your friends\' data to its own servers.', safeStep: null },
          { id: 'containment', title: 'Containment', stepIds: [], detail: CONTAINMENT, safeStep: null },
        ],
      },
    },
    caption: 'Your permission opens the door, and the shark takes your friends\' profiles too.',
    effect: 'Profile data about you and your friends is collected.',
    targets: [['Personality Lab', 'window'], ['Your profile', 'account'], ['Friend list', 'account'], ['Connected apps', 'setting']],
    fell: ['You granted the data, no password needed', ['The quiz asked only for permission, and the permission was the access.', 'It also reached your friends\' details through you, and they never agreed.', 'Check what a quiz asks for, and remove connected apps you no longer use.']],
    safe: ['You declined the connection', ['Denying kept your profile and your friends out of the harvest.', 'A personality quiz does not need your friend list, so the list of permissions was the tell.', 'Reporting the task lets the survey panel review the research team.']],
  };

  S['unc6040-salesforce'] = {
    depth: 'abyss', family: 'extortion-destruction', year: 2025, date: '2025-06-10T14:25:00Z',
    attackTitle: 'UNC6040 / UNC6240 Salesforce campaigns (2025)', os: 'windows',
    card: { victim: 'customer-support analyst at a hotel group', software: 'Windows 11 and the company customer-records workspace', firstAction: 'take a call from "IT support" about a tool you need', next: 'A follow-up email asks you to connect the tool.' },
    focusApps: ['mail', 'browser'],
    attackKind: 'data-exfil',
    title: 'Connect the data tool',
    intro: 'A caller from "IT support" walks you through a tool setup. A follow-up email arrives with the link.',
    from: ['IT Helpdesk', 'helpdesk@marrowfinch-support.example'], subject: 'As discussed: connect Data Tool',
    toast: ['Mail', 'IT Helpdesk', 'As discussed on the call: connect Data Tool.'],
    body: ['Thanks for your time on the phone.', 'Open connected apps and approve Data Tool so we can finish the setup today.'], link: 'Open connected apps',
    consent: { url: 'crm.marrowfinch-apps.example/connect', brand: 'Guestbook CRM', app: 'Data Tool Plus', publisher: 'Unverified developer', headline: 'Approve the connected app?', perms: ['Read all guest and booking records', 'Export records in bulk', 'Keep access without signing in'], allow: 'Approve connection' },
    journey: {
      steps: {
        mailbox: {
          app: 'Data Tool Plus', headline: 'Data Tool Plus is reading your records',
          status: 'You do not need to do anything. It is reading tables and starting an export.',
          labels: { threads: 'Tables read', rules: 'Exports', read: 'Read by', added: 'Started by' },
          threads: [['Guest profiles', 'Table · 184,000 rows'], ['Bookings', 'Table · 612,000 rows'], ['Loyalty accounts', 'Table · 97,000 rows'], ['Support cases', 'Table · 41,000 rows']],
          rules: [],
          newRule: ['Bulk export', 'Export every table to an outside address and keep the connection open'],
          button: 'Continue',
        },
      },
      debrief: {
        attack: 'Voice phishing, connected-app approval, data theft and extortion',
        consentNote: 'The approval page is genuine in the real campaigns: the caller guides the victim through approving a look-alike of a real data tool, so nothing about the page itself looks wrong.',
        stages: [
          { id: 'lure', title: 'Lure', stepIds: ['toast', 'mail'], detail: 'A caller posing as IT support follows up with an email and a link.', safeStep: 'Dismiss, delete or report the email, then call IT on the number in your own directory.' },
          { id: 'consent', title: 'Approval', stepIds: ['consent'], detail: 'An unverified connected app asks to read and export all records.', safeStep: 'Deny the request, or close the page.' },
          { id: 'mailbox', title: 'Records read', stepIds: ['mailbox'], detail: 'After approval the app reads every table and starts a bulk export.', safeStep: 'Report it or close the window, then ask IT to revoke the app.' },
          { id: 'attack', title: 'Extortion', stepIds: [], detail: 'The data leaves, and the attacker later demands payment to keep it private.', safeStep: null },
          { id: 'containment', title: 'Containment', stepIds: [], detail: CONTAINMENT, safeStep: null },
        ],
      },
    },
    caption: 'The approved tool empties the records, and the kraken posts the price.',
    effect: 'Customer data is exported and a payment is demanded.',
    targets: [['Connected apps', 'setting'], ['Guest records', 'file'], ['CRM account', 'account'], ['Export job', 'network']],
    fell: ['The tool you approved did the theft', ['No password was shared: the approved app held the access.', 'A caller who sounds helpful and urgent is the lure, and the email only repeats it.', 'Only IT should approve connected apps, and a caller should be verified on a number you already have.']],
    safe: ['You verified the caller first', ['Denying, reporting or calling IT back each stopped the export.', 'A data tool from an unverified developer should not be approved on a call.', 'Reporting lets IT remove the app and review who else was called.']],
  };

  S['google-docs-oauth-2017'] = {
    depth: 'abyss', family: 'network-abuse', year: 2017, date: '2017-05-03T18:05:00Z',
    attackTitle: 'Google Docs OAuth worm (2017)', os: 'macos',
    card: { victim: 'admissions coordinator at a small college', software: 'a MacBook and a web mailbox', firstAction: 'open a document a colleague shared', next: 'The link opens a permission page instead of a document.' },
    focusApps: ['mail', 'browser'],
    attackKind: 'mass-mail-worm',
    title: 'A shared document',
    intro: 'A colleague shares a document. The link opens a permission page, not a file.',
    from: ['Hannah Whitlock', 'hannah.whitlock@eastgate-college.example'], subject: 'Hannah Whitlock has shared a document with you',
    toast: ['Mail', 'Hannah Whitlock', 'Hannah Whitlock has shared a document with you.'],
    body: ['Hannah Whitlock has shared a document with you in Quillshare Docs.', 'Open it to view and comment.'], link: 'Open in Quillshare Docs',
    consent: { url: 'accounts.quillshare-docs.example/connect', brand: 'Quillshare Sign-in', app: 'Quillshare Docs', publisher: 'Unverified developer', headline: 'Allow Quillshare Docs to access your account?', perms: ['Read, send and delete your email', 'See and manage your contacts', 'Keep access without asking again'], allow: 'Allow' },
    journey: {
      steps: {
        mailbox: {
          app: 'Quillshare Docs', headline: 'Quillshare Docs is working in your mailbox',
          status: 'You do not need to do anything. It is reading your contacts and sending a message in your name.',
          labels: { threads: 'Contacts read', rules: 'Messages sent', read: 'Read by', added: 'Sent by' },
          threads: [['Imani Cole', 'Contact · imani.cole@eastgate-college.example'], ['Rafael Duarte', 'Contact · rafael.duarte@eastgate-college.example'], ['Sunita Rao', 'Contact · sunita.rao@lakeview-uni.example'], ['Tobias Wendt', 'Contact · tobias.wendt@lakeview-uni.example']],
          rules: [],
          newRule: ['Share with every contact', 'Send the same "shared a document with you" message from your address to all 63 contacts, each with its own Allow link'],
          button: 'Continue',
        },
      },
      debrief: {
        attack: 'Self-spreading OAuth consent worm',
        consentNote: 'In the real 2017 incident the page was a genuine consent screen for an app with a trusted-looking name, so nothing about it looked like phishing.',
        stages: [
          { id: 'lure', title: 'Lure', stepIds: ['toast', 'mail'], detail: 'A message from a colleague says a document was shared with you.', safeStep: 'Dismiss, delete or report the message, or ask the colleague first.' },
          { id: 'consent', title: 'Consent', stepIds: ['consent'], detail: 'A look-alike app named after a document service asks to read, send and delete your email.', safeStep: 'Deny the request, or close the page.' },
          { id: 'mailbox', title: 'Contacts mailed', stepIds: ['mailbox'], detail: 'After Allow, the app reads your contacts and sends each one the same invitation.', safeStep: 'Report it or close the window, then revoke the app.' },
          { id: 'attack', title: 'Spread', stepIds: [], detail: 'Every contact who clicks Allow repeats the cycle from their own mailbox.', safeStep: null },
          { id: 'containment', title: 'Containment', stepIds: [], detail: CONTAINMENT, safeStep: null },
        ],
      },
    },
    caption: 'One click lets the colony copy itself into every contact\'s inbox.',
    effect: 'The same invitation leaves your address for every contact.',
    targets: [['Contact: Imani', 'network'], ['Contact: Rafael', 'network'], ['Contact: Sunita', 'network'], ['Contact: Tobias', 'network'], ['Your mailbox', 'account'], ['App permissions', 'setting']],
    fell: ['One Allow click recruited every contact', ['No password and no file was needed: the permission page was the whole attack.', 'The invitation came from a colleague you trust, so each contact was likely to click Allow in turn.', 'Check the app name and publisher, and ask the sender on a known channel before you allow mail access.']],
    safe: ['You denied the look-alike app', ['Denying, reporting or asking the colleague each stopped the spread at your mailbox.', 'A document viewer that asks to send and delete your email is asking for too much.', 'Reporting lets the college revoke the app for everyone who already allowed it.']],
  };

  S['wallet-drainers'] = {
    depth: 'abyss', family: 'theft-surveillance', year: 2022, date: '2022-11-08T21:40:00Z',
    attackTitle: 'Approval-only wallet drainers (2022)', os: 'macos',
    card: { victim: 'hobbyist who collects digital art tokens', software: 'a MacBook and a browser wallet extension', firstAction: 'open a mint allowlist email on a weeknight', next: 'A claim page asks you to approve token access.' },
    focusApps: ['mail', 'browser'],
    attackKind: 'wallet-drain',
    title: 'The allowlist claim',
    intro: 'A mint team says you are on its allowlist. The claim page asks you to approve a token permission.',
    from: ['Reefmint', 'team@reefmint-drop.example'], subject: 'You are on the allowlist: claim window opens tonight',
    toast: ['Mail', 'Reefmint', 'You are on the allowlist. The claim window closes at midnight.'],
    body: ['Your wallet is on the allowlist for tonight\'s drop.', 'Open the claim page and approve the claim before midnight.'], link: 'Claim now',
    consent: { url: 'claim.reefmint-drop.example/connect', brand: 'Reefmint', app: 'Claim contract', publisher: 'Unverified contract', headline: 'Approve token access?', perms: ['Spend any amount of your tokens', 'Spend them at any time', 'No expiry date'], allow: 'Sign approval' },
    journey: {
      steps: {},
      debrief: {
        attack: 'Approval-only wallet drainer',
        consentNote: 'No recovery phrase is asked for here or in real approval phishing: the signed approval is the whole attack.',
        stages: [
          { id: 'lure', title: 'Lure', stepIds: ['toast', 'mail'], detail: 'A drop announcement says your wallet won an allowlist spot, with a deadline.', safeStep: 'Dismiss, delete or report the message, or check the drop on the team\'s own page.' },
          { id: 'consent', title: 'Approval', stepIds: ['consent'], detail: 'The claim page asks you to sign a token approval with no limit and no expiry.', safeStep: 'Deny the request, or close the page.' },
          { id: 'attack', title: 'Drain', stepIds: [], detail: 'The attacker uses the approval to move your tokens out, without asking again.', safeStep: null },
          { id: 'containment', title: 'Containment', stepIds: [], detail: CONTAINMENT, safeStep: null },
        ],
      },
    },
    caption: 'Your signature is the key, and the shark empties the wallet with it.',
    effect: 'Tokens leave your wallet under an approval you signed.',
    targets: [['Claim page', 'window'], ['Token approval', 'setting'], ['Wallet', 'account'], ['Token transfer', 'network']],
    fell: ['Your signed approval emptied the wallet', ['No recovery phrase and no password was shared: the approval gave unlimited spending.', 'A deadline and a lucky-winner message pushed you to sign without reading.', 'Read what an approval allows, set limits, and revoke approvals you no longer need.']],
    safe: ['You refused to sign', ['Denying, reporting or checking the drop on the official page each stopped the drain.', 'A claim that needs unlimited spending of your tokens is not a claim.', 'Reporting helps others who got the same message.']],
  };

  S['pegasus-trident-2016'] = {
    depth: 'abyss', family: 'theft-surveillance', year: 2016, date: '2016-08-10T08:35:00Z',
    attackTitle: 'Pegasus / Trident (2016)', os: 'macos',
    card: { victim: 'human-rights researcher at a small non-profit', software: 'a MacBook and a phone that relays text messages to email', firstAction: 'read a forwarded text message before a meeting', next: 'The text carries a link about a topic you work on.' },
    focusApps: ['mail', 'browser'],
    attackKind: 'spyware-surveillance',
    title: 'The forwarded text',
    intro: 'A text from an unknown number is relayed to your email. It promises new details about people you advocate for.',
    from: ['Text Relay', 'relay@mobilecom-text.example'], subject: 'New text message: new details about the detainees',
    toast: ['Mail', 'Text Relay', 'New text message from an unknown number.'],
    body: ['A text message from an unknown number was relayed to your email.', 'Message: "New details about the detainees. Read it here."'], link: 'Open link',
    consent: { url: 'details.detainee-news.example/read', brand: 'News Page', app: 'Linked page', publisher: 'Unknown sender', headline: 'Open this page?', perms: ['Open a page from an unknown number', 'Run page code in your browser', 'Allow later changes to your device'], allow: 'Open' },
    journey: {
      steps: {},
      debrief: {
        attack: 'One-click spyware chain delivered by text link',
        consentNote: 'The real 2016 target did not click, and no victim click is documented. This scene shows what one click would have allowed. In the real chain no prompt appeared either.',
        stages: [
          { id: 'lure', title: 'Lure', stepIds: ['toast', 'mail'], detail: 'A text from an unknown number promises sensitive news on a topic you work on.', safeStep: 'Dismiss or delete the message, and send it to your security contact instead of opening it.' },
          { id: 'consent', title: 'One click', stepIds: ['consent'], detail: 'The link opens a page that carries a chain of device flaws.', safeStep: 'Deny the request, or close the page.' },
          { id: 'attack', title: 'Surveillance', stepIds: [], detail: 'The spyware reads messages, contacts and calls, and turns on sensors.', safeStep: null },
          { id: 'containment', title: 'Containment', stepIds: [], detail: CONTAINMENT, safeStep: null },
        ],
      },
    },
    caption: 'One tap on a link, and the shark takes a bite of everything your device holds.',
    effect: 'Messages, contacts and calls are copied to a hidden server.',
    targets: [['Linked page', 'window'], ['Messages', 'secret'], ['Contacts', 'account'], ['Device settings', 'setting']],
    fell: ['One tap opened the device', ['No password and no file was needed: the page itself carried the attack.', 'The topic was chosen to make you curious and to feel urgent.', 'Update your phone and computer quickly, and send odd links to your security contact instead of opening them.']],
    safe: ['You did not open the link', ['Denying, deleting or forwarding the message to your security contact each stopped the chain.', 'A link from an unknown number about your own work is a classic lure for people in your role.', 'Reporting helps the security team study the link safely.']],
  };

  S['ledger-connect-kit-2023'] = {
    depth: 'abyss', family: 'trusted-source', year: 2023, date: '2023-12-14T14:55:00Z',
    attackTitle: 'Ledger Connect Kit (2023)', os: 'windows',
    card: { victim: 'user of a decentralised exchange', software: 'Windows 11, a browser wallet and a hardware wallet', firstAction: 'open the exchange\'s staking page from a newsletter', next: 'A wallet pop-up asks you to sign a transaction.' },
    focusApps: ['mail', 'browser'],
    attackKind: 'wallet-drain',
    title: 'The staking rewards',
    intro: 'An exchange you use says staking rewards are live. Its wallet-connect library was updated this week.',
    from: ['Tideswap Weekly', 'digest@tideswap-weekly.example'], subject: 'Staking rewards are live: claim today',
    toast: ['Mail', 'Tideswap Weekly', 'Staking rewards are live. Claim today.'],
    body: ['Staking rewards for this month are ready.', 'Open Tideswap, connect your wallet and claim.'], link: 'Open Tideswap',
    consent: { url: 'app.tideswap-fi.example/connect', brand: 'Tideswap', app: 'Wallet connect kit', publisher: 'Trusted library (updated this week)', headline: 'Sign this transaction?', perms: ['Move tokens out of your wallet', 'Approve an address you do not know', 'Details hidden by the wallet pop-up'], allow: 'Sign' },
    journey: {
      steps: {},
      debrief: {
        attack: 'Compromised wallet-connect library',
        consentNote: 'The page and the library were real. A former employee\'s account was used to publish a tampered version, and the pop-up lacked clear details. No recovery phrase was asked for.',
        stages: [
          { id: 'lure', title: 'Lure', stepIds: ['toast', 'mail'], detail: 'A genuine newsletter sends you to an exchange you already use.', safeStep: 'Dismiss or delete the message, or open the exchange from your own bookmark.' },
          { id: 'consent', title: 'Signature', stepIds: ['consent'], detail: 'The page, loading a tampered library, asks you to sign a transaction with hidden details.', safeStep: 'Deny the request, or reject the pop-up on the hardware wallet.' },
          { id: 'attack', title: 'Drain', stepIds: [], detail: 'The signed transaction sends your tokens to the attacker\'s address.', safeStep: null },
          { id: 'containment', title: 'Containment', stepIds: [], detail: CONTAINMENT, safeStep: null },
        ],
      },
    },
    caption: 'The trusted library flips, and the isopod rides your signature out of the wallet.',
    effect: 'Tokens move to an address you never chose.',
    targets: [['Tideswap page', 'window'], ['Connect library', 'file'], ['Wallet', 'account'], ['Token transfer', 'network']],
    fell: ['A trusted page asked for a bad signature', ['The page and the library were the real ones, so everything looked right.', 'The transaction details were hidden or unclear, and you signed it anyway.', 'Only sign what you can read on your hardware wallet screen, and reject anything unclear.']],
    safe: ['You refused to sign', ['Denying, or rejecting the pop-up on the hardware wallet, kept your tokens in place.', 'A claim that moves tokens out of your wallet is not a claim.', 'Reporting lets the exchange pull the library and warn other users.']],
  };

  S['likejacking'] = {
    depth: 'abyss', family: 'deception', year: 2010, date: '2010-06-09T20:10:00Z',
    attackTitle: 'Facebook likejacking (2010)', os: 'windows',
    card: { victim: 'college student on a shared home PC', software: 'Windows and a web browser', firstAction: 'check a friend\'s post about a funny video', next: 'The video page asks you to click Play.' },
    focusApps: ['mail', 'browser'],
    attackKind: 'account-takeover-post',
    title: 'OMG you have to see this',
    intro: 'A friend\'s post says you have to see a video. The page asks you to click Play.',
    from: ['Friendnest', 'notify@friendnest.example'], subject: 'Dana posted: OMG you have to see this video',
    toast: ['Mail', 'Friendnest', 'Dana posted: OMG you have to see this video.'],
    body: ['Dana Reyes posted a link on your wall.', 'Click to watch the video.'], link: 'Watch video',
    consent: { url: 'cutevid-hq.example/watch', brand: 'ClipZone', app: 'Play button', publisher: 'Unknown site', headline: 'Click Play to watch', perms: ['Click Like on a page for you', 'Share it with your friends', 'Hidden under the Play button'], allow: 'Play' },
    journey: {
      steps: {},
      debrief: {
        attack: 'Likejacking (a disguised click that posts for you)',
        consentNote: 'In the real attack the Like button was invisible and sat under the Play button. The list of effects here shows what that hidden click did.',
        stages: [
          { id: 'lure', title: 'Lure', stepIds: ['toast', 'mail'], detail: 'A friend\'s post and a notification promise a shocking video.', safeStep: 'Dismiss, delete or report the post, or ask the friend whether they posted it.' },
          { id: 'consent', title: 'The click', stepIds: ['consent'], detail: 'The page hides a Like button under the Play button.', safeStep: 'Deny the request, or close the page.' },
          { id: 'attack', title: 'Spread', stepIds: [], detail: 'Your click posts a Like in your name, and your friends see it and click in turn.', safeStep: null },
          { id: 'containment', title: 'Containment', stepIds: [], detail: CONTAINMENT, safeStep: null },
        ],
      },
    },
    caption: 'One disguised click posts for you, and the lure spreads to every friend.',
    effect: 'A Like appears in your name and reaches your friends.',
    targets: [['Video page', 'window'], ['Hidden Like button', 'setting'], ['Your profile', 'account'], ['Friend feed', 'network']],
    fell: ['Your click posted for you', ['No password was taken: the click you meant for Play was a Like.', 'The post came from a friend, so it felt safe, and your Like then reached your friends.', 'Be wary of "you have to see this" posts, and remove the post if you find it on your page.']],
    safe: ['You did not click the disguised button', ['Denying, reporting or asking Dana each stopped the spread at your page.', 'A video that asks you to click first and play later is a warning sign.', 'Reporting the post helps the network warn your friends.']],
  };

  S['lockbit-3-drive-by'] = {
    depth: 'abyss', family: 'extortion-destruction', year: 2022, date: '2022-09-20T13:50:00Z',
    attackTitle: 'LockBit 3.0 drive-by compromise (technique-level)', os: 'windows',
    card: { victim: 'bookkeeper at a small accounting firm', software: 'Windows 11 and a web browser', firstAction: 'open a tax-news summary from a newsletter', next: 'The news site\'s page wants to run extra content.' },
    focusApps: ['mail', 'browser'],
    attackKind: 'ransomware-encrypt',
    title: 'The tax-rule summary',
    intro: 'A trade newsletter links to a summary of new tax rules. The page wants to run extra content.',
    from: ['Ledgerline Trade News', 'news@ledgerline-news.example'], subject: 'Tax rule changes: read the summary',
    toast: ['Mail', 'Ledgerline Trade News', 'Tax rule changes: read the summary.'],
    body: ['Three tax rules change next quarter.', 'Read the short summary before your clients ask.'], link: 'Read the summary',
    consent: { url: 'news.ledgerline-cdn.example/continue', brand: 'Ledgerline Trade News', app: 'Page extras', publisher: 'Third-party host', headline: 'Allow this page to run extra content?', perms: ['Run a script from a third-party host', 'Check your browser for weaknesses', 'Continue to a hidden second page'], allow: 'Allow' },
    journey: {
      steps: {},
      debrief: {
        attack: 'Drive-by compromise leading to ransomware',
        consentNote: 'No named LockBit 3.0 incident is documented for this route. This scene reconstructs the technique only: a compromised site hands a visitor to an exploit page, with no prompt in real cases.',
        stages: [
          { id: 'lure', title: 'Lure', stepIds: ['toast', 'mail'], detail: 'A trade newsletter links to a site that attackers have tampered with.', safeStep: 'Dismiss or delete the message, or open the site from your own bookmark.' },
          { id: 'consent', title: 'Extra content', stepIds: ['consent'], detail: 'The tampered page loads a script that checks your browser for weaknesses.', safeStep: 'Deny the request, or close the page.' },
          { id: 'attack', title: 'Attack', stepIds: [], detail: 'A weakness gives the attacker a foothold, and later the files are locked and a payment is demanded.', safeStep: null },
          { id: 'containment', title: 'Containment', stepIds: [], detail: CONTAINMENT, safeStep: null },
        ],
      },
    },
    caption: 'A trusted news page hides a second page, and the kraken locks the firm\'s files.',
    effect: 'Files are locked and a payment is demanded.',
    targets: [['News page', 'window'], ['Browser', 'setting'], ['Client files', 'file'], ['Ransom note', 'window']],
    fell: ['Visiting the page was the way in', ['No password and no file was needed: the tampered page tested your browser.', 'The site was a real trade site, so nothing about it looked wrong.', 'Keep browsers patched, back up files offline, and treat an unexpected request on a news page as a warning.']],
    safe: ['You did not let the page run extras', ['Denying, closing the page or reopening the site from a bookmark each broke the chain.', 'A news summary does not need to test your browser.', 'Reporting lets the security team block the tampered site for the whole firm.']],
  };
})();
