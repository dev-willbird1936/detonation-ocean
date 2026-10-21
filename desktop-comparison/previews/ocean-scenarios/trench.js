// Trench scenarios (owner: content-trench). Twelve passive scenes: nothing asks the displayed victim to respond.
// Same copy shape as the trench entries in ocean-scenes.js (toast, monitor or files + alert, caption, effect, targets,
// fell, safe), plus the scenario fields in docs/desktop-parity/SCENARIOS-60-CONTRACT.md §2. Trench scenes have no safe
// path: `safe` is the debrief of the patched replay. Victims, organisations, products and addresses are invented;
// only attackTitle and year name the real incident.
(() => {
  'use strict';
  const S = (globalThis.OceanScenarioData ||= {});

  S['sim-swapping'] = {
    depth: 'trench', family: 'deception', year: 2021, attackTitle: 'SIM swapping', os: 'macos', attackKind: 'sim-swap',
    card: {
      victim: 'mobile subscriber who gets bank codes by text',
      software: 'a laptop and a Tidewave Mobile phone plan',
      firstAction: 'open Phone & Plan to check your line, like every morning',
      next: 'Nothing asks you to respond. Watch what happens to your number.',
    },
    focusApps: ['updates'],
    title: 'The number that moved',
    intro: 'Nothing in this scene asks you to respond. Open Phone & Plan and check your line as you would on any morning.',
    app: 'updates',
    toast: ['Training', 'Just use the computer', 'Open Phone & Plan and check your line, like every morning.'],
    monitor: {
      title: 'Phone & Plan', status: 'Checking your line…',
      rows: [['Mobile number', 'Active'], ['SIM card', 'Active'], ['Text messages', 'Delivering']],
      flip: { 1: 'Moved to another SIM', 2: 'Rerouted' },
      alert: 'Your carrier moved your number to a new SIM after a caller pretended to be you.',
    },
    caption: 'A caller talks the carrier into moving your number. You are not on the call.',
    effect: 'Bank texts and reset codes now land on a SIM you do not hold.',
    targets: [['Phone & Plan', 'window'], ['Mobile number', 'account'], ['Bank text codes', 'secret'], ['Carrier account', 'account']],
    fell: ['The carrier was deceived, not you', ['The caller passed the carrier\'s identity questions with details gathered elsewhere, so your own care could not stop it.', 'Once the number moved, every text-message code for your bank and mail went to the attacker.', 'A number lock or port-out PIN at the carrier, and an authenticator app instead of text codes, are the defences.']],
    safe: ['A number lock stopped the swap', ['The carrier asked for the account PIN, the caller could not give it, and the request was refused.', 'Your number stayed on your SIM and your bank texts kept arriving.']],
  };

  S['heartbleed-2014'] = {
    depth: 'trench', family: 'intrusion', year: 2014, attackTitle: 'Heartbleed', os: 'macos', attackKind: 'server-exploit-leak',
    card: {
      victim: 'web administrator at a small online shop',
      software: 'a laptop and the shop\'s secure web gateway',
      firstAction: 'open Services to look over the gateway, like every morning',
      next: 'Nothing asks you to respond. Watch what the gateway gives away.',
    },
    focusApps: ['updates'],
    title: 'The gateway that over-answered',
    intro: 'Nothing in this scene asks you to respond. Open Services and look over the shop gateway as an admin would.',
    app: 'updates',
    toast: ['Training', 'Just use the computer', 'Open Services and look over the shop gateway, like normal.'],
    monitor: {
      title: 'Shop Gateway', status: 'Reading service status…',
      rows: [['Secure web gateway', 'Running'], ['Private key store', 'Running'], ['Customer sessions', 'Running']],
      flip: { 0: 'Memory read by unknown host', 2: 'Contents exposed' },
      alert: 'The gateway\'s secure-connection library answered a malformed keep-alive request with a slice of its memory.',
    },
    caption: 'One malformed request and the viperfish reads memory the gateway never meant to share.',
    effect: 'Fragments of memory, including keys and sessions, flow out of the gateway.',
    targets: [['Secure web gateway', 'network'], ['Private keys', 'secret'], ['Customer sessions', 'account'], ['Services', 'window']],
    fell: ['A library flaw, not a person, was the entry', ['No shopper and no admin clicked anything: the gateway answered a stranger and leaked memory.', 'Each request could leak a different slice, so keys and logged-in sessions could be collected quietly.', 'Patch the library, then replace the keys and certificates and end old sessions: the leak may already have happened.']],
    safe: ['The patched library refused the request', ['The fixed gateway checked the request length and sent nothing back.', 'Keys and sessions stayed inside the gateway.']],
  };

  S['mirai-2016'] = {
    depth: 'trench', family: 'network-abuse', year: 2016, attackTitle: 'Mirai', os: 'windows', attackKind: 'botnet-ddos',
    card: {
      victim: 'café owner with a security camera and recorder',
      software: 'a shop PC on the café\'s internet connection',
      firstAction: 'open Shop Devices to glance at the camera, like on any quiet morning',
      next: 'Nothing asks you to respond. Watch what happens to your devices.',
    },
    focusApps: ['updates'],
    title: 'The camera with a factory password',
    intro: 'Nothing in this scene asks you to respond. Open Shop Devices and glance at the café gadgets.',
    app: 'updates',
    toast: ['Training', 'Just use the computer', 'Open Shop Devices and glance at the camera and recorder.'],
    monitor: {
      title: 'Shop Devices', status: 'Pinging your devices…',
      rows: [['Door camera', 'Online'], ['Recorder', 'Online'], ['Café router', 'Online']],
      flip: { 0: 'Joined a remote botnet', 2: 'Sending traffic to unknown targets' },
      alert: 'An automated scan found devices still on their factory password and enrolled them. You did nothing.',
    },
    caption: 'A scanner finds the camera by its factory password and enlists it in the colony.',
    effect: 'Your devices now send floods of traffic for strangers at a site you have never visited.',
    targets: [['Door camera', 'network'], ['Recorder', 'network'], ['Café router', 'network'], ['Factory password', 'secret']],
    fell: ['Nobody had to respond', ['Automated scanners try common factory passwords on every exposed device, all day.', 'The devices worked normally while they were being used against someone else.', 'Change every default password, keep firmware current and do not expose devices to the internet.']],
    safe: ['A changed password kept the devices out', ['The scanner tried the factory login, it failed, and it moved on.', 'The camera and recorder kept doing their own job.']],
  };

  S['shadowhammer-2019'] = {
    depth: 'trench', family: 'trusted-source', year: 2019, attackTitle: 'ASUS ShadowHammer', os: 'windows', attackKind: 'supply-chain-update',
    card: {
      victim: 'freight accounts clerk at a logistics company',
      software: 'a work laptop with the Orrin Live Update utility',
      firstAction: 'open Updates to see what your laptop is doing, like on any morning',
      next: 'Nothing asks you to respond. Watch the update that arrives by itself.',
    },
    focusApps: ['updates'],
    title: 'The update from the maker',
    intro: 'Nothing in this scene asks you to respond. Open Updates and let your laptop do its normal chores.',
    app: 'updates',
    toast: ['Training', 'Just use the computer', 'Open Updates and see what your laptop is doing.'],
    monitor: {
      title: 'Laptop Updates', status: 'Checking for updates…',
      rows: [['Orrin Live Update', 'Update available'], ['Driver pack', 'Up to date'], ['Update signature', 'Verified by Orrin']],
      flip: { 0: 'Installed unexpected component', 2: 'Verified, but hostile' },
      alert: 'The laptop maker\'s own update channel delivered a tampered package with a valid signature.',
    },
    caption: 'The maker\'s own updater carries the isopod: a valid signature, a hostile payload.',
    effect: 'The update that should protect the laptop installs the attacker.',
    targets: [['Orrin Live Update', 'window'], ['Update signature', 'setting'], ['Driver pack', 'file'], ['Update server', 'network']],
    fell: ['The update channel was the entry', ['The package carried a genuine signature, so the laptop trusted it and installed it without a prompt.', 'The clerk approved nothing: the maker\'s updater runs on its own.', 'Makers need build integrity, signing-key protection and monitoring. Users and IT need prompt detection and a way to roll back.']],
    safe: ['Integrity checks stopped the update', ['The maker\'s build checks caught the tampered package and the server refused to publish it.', 'The laptop received only the clean update.']],
  };

  S['moveit-2023'] = {
    depth: 'trench', family: 'theft-surveillance', year: 2023, attackTitle: 'MOVEit Transfer', os: 'windows', attackKind: 'data-exfil',
    card: {
      victim: 'payroll coordinator at a county benefits office',
      software: 'a work PC and the office\'s file transfer service',
      firstAction: 'open the File Transfers folder to collect this week\'s batches',
      next: 'Nothing asks you to respond. Watch the transfer server while you work.',
    },
    focusApps: ['files'],
    title: 'The transfer server that emptied itself',
    intro: 'Nothing in this scene asks you to respond. Open the File Transfers folder like any work day.',
    app: 'files', folder: 'File Transfers',
    toast: ['Training', 'Just use the computer', 'Open the File Transfers folder and collect this week\'s batches as usual.'],
    files: [['Benefit-enrolments.csv', 'CSV file', '2.3 MB'], ['Retiree-letters', 'File folder', ''], ['Vendor-remittance.zip', 'Compressed archive', '11.8 MB'], ['Readme.txt', 'Text document', '2 KB']],
    alert: 'Transfer server: an unknown session is exporting stored records.',
    caption: 'A web flaw in the transfer server lets the shark empty it while you browse.',
    effect: 'Whole folders of enrolment and payment records leave through the transfer service.',
    targets: [['File Transfers folder', 'window'], ['Benefit-enrolments.csv', 'file'], ['Member records', 'account'], ['Transfer service', 'network']],
    fell: ['The server was the entry, not the staff', ['An unauthenticated request to the transfer server\'s web page was enough, so no one at the office clicked or approved anything.', 'The records of members who never used the server directly were stored on it and taken.', 'Patch internet-facing transfer tools quickly, keep only the files you need on them and watch for odd sessions.']],
    safe: ['The patched server refused the request', ['The fixed web page rejected the crafted request and no session was created.', 'The batches stayed in place and the folder looked unchanged.']],
  };

  S['wannacry-2017'] = {
    depth: 'trench', family: 'extortion-destruction', year: 2017, attackTitle: 'WannaCry', os: 'windows', attackKind: 'ransomware-encrypt',
    card: {
      victim: 'records clerk at a community hospital',
      software: 'a ward-office PC on the hospital network',
      firstAction: 'open the Clinic shared drive to start your shift',
      next: 'Nothing asks you to respond. Watch the drive while you work.',
    },
    focusApps: ['files'],
    title: 'The worm on the ward drive',
    intro: 'Nothing in this scene asks you to respond. Open the Clinic shared drive and carry on with your shift.',
    app: 'files', folder: 'Clinic shared drive',
    toast: ['Training', 'Just use the computer', 'Open the Clinic shared drive and start your shift as usual.'],
    files: [['Rota-week-23.xlsx', 'Spreadsheet', '286 KB'], ['Clinic-letters', 'File folder', ''], ['Equipment-log.docx', 'Document', '94 KB'], ['Policies.pdf', 'PDF document', '1.6 MB']],
    alert: 'File-sharing service: inbound connection from another machine.',
    caption: 'A worm crosses the hospital network through an unpatched sharing service and the kraken locks drive after drive.',
    effect: 'Files across the ward computers are locked and a ransom countdown begins.',
    targets: [['Clinic shared drive', 'window'], ['Rota-week-23.xlsx', 'file'], ['File-sharing service', 'network'], ['Backup drive', 'setting']],
    fell: ['The worm needed no click', ['It moved from computer to computer through a file-sharing service that had a fix available but not applied.', 'The ransom note appeared after the files were already locked, so paying looked like the only way back.', 'Apply security updates promptly, retire old protocols, segment the network and keep offline backups.']],
    safe: ['The patch stopped it', ['The patched sharing service refused the worm\'s request, so it could not move to the next computer.', 'The shared drive stayed readable and the clinic kept working.']],
  };

  S['sql-slammer-2003'] = {
    depth: 'trench', family: 'network-abuse', year: 2003, attackTitle: 'SQL Slammer', os: 'windows', attackKind: 'network-worm',
    card: {
      victim: 'branch systems clerk at a regional credit union',
      software: 'a branch PC on the credit union network',
      firstAction: 'open Branch Network to check the morning status',
      next: 'Nothing asks you to respond. Watch the network in the next few minutes.',
    },
    focusApps: ['updates'],
    title: 'The packet that filled the pipe',
    intro: 'Nothing in this scene asks you to respond. Open Branch Network and check the morning status.',
    app: 'updates',
    toast: ['Training', 'Just use the computer', 'Open Branch Network and check the morning status.'],
    monitor: {
      title: 'Branch Network', status: 'Checking branch systems…',
      rows: [['Teller terminals', 'Online'], ['Account database service', 'Running'], ['Cash machine link', 'Online']],
      flip: { 1: 'Flooding the network with copies', 2: 'Offline' },
      alert: 'A single small packet infected the database service, which then flooded the branch network with copies of itself.',
    },
    caption: 'One tiny packet and the colony fills the pipe: the siphonophore copies itself faster than anyone can react.',
    effect: 'Copies of the worm saturate the network until tellers and the cash machine link go dark.',
    targets: [['Branch Network', 'window'], ['Account database service', 'network'], ['Cash machine link', 'network'], ['Teller terminals', 'file']],
    fell: ['A single packet was enough', ['The database service listened on the network for requests, and one packet made it run the worm.', 'Within minutes each infected server was sending copies to random addresses, which swamped the links.', 'Apply the vendor fix that was already out, block the service\'s port at the edge and keep database servers off general networks.']],
    safe: ['The patched service ignored the packet', ['The fixed database service rejected the oversized request and kept running.', 'The network stayed quiet and branch systems stayed online.']],
  };

  S['blaster-2003'] = {
    depth: 'trench', family: 'intrusion', year: 2003, attackTitle: 'Blaster', os: 'windows', attackKind: 'network-worm',
    card: {
      victim: 'office administrator at a small accountancy firm',
      software: 'an office PC connected straight to the internet',
      firstAction: 'open System Services to look things over before the day starts',
      next: 'Nothing asks you to respond. Watch what reaches your computer.',
    },
    focusApps: ['updates'],
    title: 'The countdown nobody started',
    intro: 'Nothing in this scene asks you to respond. Open System Services and look over your computer.',
    app: 'updates',
    toast: ['Training', 'Just use the computer', 'Open System Services and look over your computer.'],
    monitor: {
      title: 'System Services', status: 'Reading service status…',
      rows: [['Remote call service', 'Running'], ['Network connection', 'Connected'], ['Security updates', 'Not applied']],
      flip: { 0: 'Entered from the network', 1: 'Searching for other computers' },
      alert: 'A worm entered through the remote call service, the computer began restarting and the worm started searching for others.',
    },
    caption: 'A remote request walks through an unpatched service and the viperfish is inside with no click at all.',
    effect: 'The computer restarts on a countdown while copies of the worm search for the next machine.',
    targets: [['System Services', 'window'], ['Remote call service', 'network'], ['Security updates', 'setting'], ['Network connection', 'network']],
    fell: ['An open service, not a click, was the entry', ['The remote call service accepted a crafted request from the network, so the worm ran with no one at the keyboard.', 'The restart countdown was only the visible symptom; the worm kept searching for more computers.', 'Install security updates, switch on a firewall and keep unneeded services off the internet.']],
    safe: ['The patch closed the door', ['The updated service rejected the crafted request and kept running.', 'The computer did not restart and nothing scanned from it.']],
  };

  S['sasser-2004'] = {
    depth: 'trench', family: 'extortion-destruction', year: 2004, attackTitle: 'Sasser', os: 'windows', attackKind: 'network-worm',
    card: {
      victim: 'dispatcher at a regional courier company',
      software: 'a dispatch-desk PC on the company network',
      firstAction: 'open Dispatch Systems to check the morning routes',
      next: 'Nothing asks you to respond. Watch the desk while you work.',
    },
    focusApps: ['updates'],
    title: 'The desk that kept restarting',
    intro: 'Nothing in this scene asks you to respond. Open Dispatch Systems and check the morning routes.',
    app: 'updates',
    toast: ['Training', 'Just use the computer', 'Open Dispatch Systems and check the morning routes.'],
    monitor: {
      title: 'Dispatch Systems', status: 'Checking dispatch systems…',
      rows: [['Dispatch terminal', 'Online'], ['Security service', 'Running'], ['Route planner', 'Online']],
      flip: { 1: 'Crashed and restarting', 2: 'Unavailable' },
      alert: 'A worm entered through a flaw in the security service, and the computer began restarting every few minutes.',
    },
    caption: 'The worm scans for the flawed service, enters and leaves the machine crashing in a loop.',
    effect: 'Dispatch desks restart again and again while the worm looks for new machines.',
    targets: [['Dispatch Systems', 'window'], ['Security service', 'network'], ['Route planner', 'file'], ['Dispatch terminal', 'window']],
    fell: ['A service flaw, not a person, was the entry', ['The worm scanned networks for computers running the flawed security service and entered with no action by anyone.', 'The crash loop was the symptom; the real harm was a company that could not dispatch its work.', 'Install the update that was already available, keep a firewall on and block the service from outside the network.']],
    safe: ['The patch stopped the crash loop', ['The updated service rejected the worm\'s request and kept running.', 'Dispatch kept working and no computer restarted.']],
  };

  S['conficker-2008'] = {
    depth: 'trench', family: 'network-abuse', year: 2008, attackTitle: 'Conficker (network-service variant)', os: 'windows', attackKind: 'network-worm',
    card: {
      victim: 'support technician at a city council',
      software: 'a council workstation and the council file server',
      firstAction: 'open Council Network to check the servers before the day starts',
      next: 'Nothing asks you to respond. Watch what the servers do on their own.',
    },
    focusApps: ['updates'],
    title: 'The server that shut its own updates off',
    intro: 'Nothing in this scene asks you to respond. Open Council Network and check the servers.',
    app: 'updates',
    toast: ['Training', 'Just use the computer', 'Open Council Network and check the servers.'],
    monitor: {
      title: 'Council Network', status: 'Checking council servers…',
      rows: [['File server', 'Online'], ['Server service', 'Running'], ['Update service', 'Running']],
      flip: { 1: 'Entered by a remote request', 2: 'Switched off by unknown program' },
      alert: 'An unpatched server service answered a crafted request, and the worm then switched off updates and joined a remote network of infected computers.',
    },
    caption: 'The colony slips through an unpatched server service, then cuts the line that would bring the fix.',
    effect: 'Infected servers stop updating and wait for orders from a remote controller.',
    targets: [['Council Network', 'window'], ['Server service', 'network'], ['Update service', 'setting'], ['File server', 'file']],
    fell: ['An unpatched service was the entry', ['The server service accepted a crafted request, so the worm ran on the server with no one at the keyboard.', 'Switching off updates kept the infection alive and stopped the fix from arriving.', 'Apply the security update, filter the service at the network edge and watch for servers that stop updating.']],
    safe: ['The patch closed the service', ['The updated server service rejected the crafted request.', 'Updates kept arriving and the servers stayed under council control.']],
  };

  S['equifax-2017'] = {
    depth: 'trench', family: 'theft-surveillance', year: 2017, attackTitle: 'Equifax (Struts exploitation)', os: 'macos', attackKind: 'data-exfil',
    card: {
      victim: 'consumer with a credit file at a credit bureau',
      software: 'a home laptop and the Brightline Credit monthly summary',
      firstAction: 'open Credit Profile to read your monthly summary',
      next: 'Nothing asks you to respond. Watch what happens to your file.',
    },
    focusApps: ['updates'],
    title: 'The file you never handed over',
    intro: 'Nothing in this scene asks you to respond. Open Credit Profile and read your monthly summary.',
    app: 'updates',
    toast: ['Training', 'Just use the computer', 'Open Credit Profile and read your monthly summary.'],
    monitor: {
      title: 'Credit Profile', status: 'Reading your credit file…',
      rows: [['Credit file', 'Held securely'], ['Dispute portal', 'Online'], ['Identity alerts', 'None']],
      flip: { 0: 'Records copied by unknown party', 2: 'Your details exposed' },
      alert: 'The credit bureau\'s dispute website was entered through a known flaw that had not been patched. Your file was among the records taken.',
    },
    caption: 'The shark empties a bureau you never chose, and the loss reaches you only as a notice.',
    effect: 'Names, birth dates and identity numbers leave the bureau in bulk.',
    targets: [['Credit Profile', 'window'], ['Credit file', 'account'], ['Identity numbers', 'secret'], ['Dispute portal', 'network']],
    fell: ['The bureau\'s missed fix was the entry', ['You did nothing and could do nothing: the data sat on a company website you never visited.', 'The flaw was known and a fix was out, but it was not applied to this one site.', 'Companies must patch quickly and keep inventory of internet-facing software. You can place a credit freeze and watch your accounts for new activity.']],
    safe: ['The patched site refused the request', ['The fixed web framework rejected the crafted request and the portal stayed closed to strangers.', 'Your file stayed where it belonged.']],
  };

  S['log4shell-2021'] = {
    depth: 'trench', family: 'intrusion', year: 2021, attackTitle: 'Log4Shell (server-side exploitation)', os: 'macos', attackKind: 'server-exploit-leak',
    card: {
      victim: 'platform engineer at a ticketing company',
      software: 'a laptop and the company\'s booking platform',
      firstAction: 'open Booking Platform to check the services before stand-up',
      next: 'Nothing asks you to respond. Watch what a single request does.',
    },
    focusApps: ['updates'],
    title: 'The log line that ran',
    intro: 'Nothing in this scene asks you to respond. Open Booking Platform and check the services before stand-up.',
    app: 'updates',
    toast: ['Training', 'Just use the computer', 'Open Booking Platform and check the services before stand-up.'],
    monitor: {
      title: 'Booking Platform', status: 'Reading service status…',
      rows: [['Booking API', 'Running'], ['Log service', 'Running'], ['Admin console', 'Running']],
      flip: { 1: 'Fetched code from outside', 2: 'Controlled by unknown host' },
      alert: 'A crafted line in an ordinary request made the logging component fetch and run outside code. No one had to click anything.',
    },
    caption: 'A single crafted line in a request is read by the logger, and the viperfish is inside the server.',
    effect: 'The booking platform starts running instructions from a stranger.',
    targets: [['Booking Platform', 'window'], ['Log service', 'network'], ['Admin console', 'setting'], ['Booking API', 'network']],
    fell: ['A logging flaw, not a person, was the entry', ['The logging component treated text in a request as an instruction, so any visitor could trigger it.', 'The flaw sat inside a component many teams did not know they used, which made it hard to find and fix.', 'Keep an inventory of components, update the fixed version quickly and limit what servers may fetch from outside.']],
    safe: ['The updated component ignored the line', ['The fixed logging component logged the text as plain words and ran nothing.', 'The booking platform stayed under the company\'s control.']],
  };
})();
