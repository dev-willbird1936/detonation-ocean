// Midnight scenarios (password only, no second factor): one fictional reconstruction per selected real attack.
// Brands, people and domains are invented; the real attack name and year appear only in attackTitle and year.
// Each entry follows the AUTHORED shape of the midnight scenes in ocean-scenes.js plus the scenario fields in
// docs/desktop-parity/SCENARIOS-60-CONTRACT.md §2. The victim desktop lives in data/desktop-profiles/<id>.json.
(() => {
  'use strict';

  const S = (globalThis.OceanScenarioData ||= {});

  S['podesta-2016'] = {
    depth: 'midnight', family: 'deception', year: 2016, attackTitle: 'Podesta email phishing (2016)', os: 'macos',
    card: { victim: 'campaign staffer', software: 'a laptop and a webmail inbox', firstAction: 'check your inbox late in the evening during a busy week', next: 'A security alert from your mail provider arrives.' },
    focusApps: ['browser', 'mail'], attackKind: 'credential-phish',
    title: 'Someone tried to use your password',
    intro: 'It is late and the rally is two days away. A security alert from your mail provider lands in the inbox.',
    from: ['Mailwren Security', 'no-reply@mailwren-security.example'], subject: 'Someone tried to use your password',
    toast: ['Mail', 'Mailwren Security', 'A sign-in from another country was blocked. Change your password now.'],
    body: ['Mailwren blocked a sign-in to your account from an unfamiliar device in another country.', 'Change your password right away. The link below was shortened to fit this message.'], link: 'Change password',
    signin: { url: 'accounts.mailwren-secure.example/reset', brand: 'Mailwren', headline: 'Change your password', sub: 'Confirm your account to continue' },
    caption: 'The reset page only pretends to protect you, and the lure takes the key.',
    effect: 'With the password alone, years of campaign mail are open and copied out.',
    targets: [['Reset page', 'window'], ['Campaign inbox', 'account'], ['Password', 'secret'], ['Mail archive', 'file']],
    fell: ['The alert was the break-in', ['A scary alert plus a short link pushed you to act before you checked.', 'The page looked like the real reset page, and no second factor stood between the password and the inbox.', 'Safe step at the message: open the mail provider yourself or ask the IT team on a known channel. Safe step at the sign-in page: close the tab and turn on a second factor.']],
    safe: ['You went to the account yourself', ['Opening your mail provider from a bookmark showed no alert, so the message was false.', 'You reported the message, and the campaign IT team warned the rest of the staff.', 'A second factor on every campaign account would have limited the damage even if you had typed the password.']],
  };

  S['the-onion-2013'] = {
    depth: 'midnight', family: 'intrusion', year: 2013, attackTitle: 'The Onion social account hijack (2013)', os: 'macos',
    card: { victim: 'staff writer at a satirical newspaper', software: 'a laptop and the newsroom mail account', firstAction: 'read mail between pitch meetings', next: 'A colleague forwards an article about your paper.' },
    focusApps: ['browser', 'mail'], attackKind: 'account-takeover-post',
    title: 'Fwd: a piece about us',
    intro: 'The pitch meeting starts at four. A colleague forwards a story about the paper and says you should read it first.',
    from: ['Wendell Park', 'wendell.park@dailyparsnip.example'], subject: 'Fwd: Interesting piece about us',
    toast: ['Mail', 'Wendell Park', 'Fwd: Interesting piece about us. Read it before the 4 pm meeting.'],
    body: ['Saw this piece about our site and thought you should read it before the 4 pm meeting.', 'It may ask you to sign in with your staff mail account first.'], link: 'Read the article',
    signin: { url: 'mail.dailyparsnip-staff.example/signin', brand: 'Daily Parsnip Staff Mail', headline: 'Sign in to read the article', sub: 'Your staff mail session has expired' },
    caption: 'One quiet sign-in, and the intruder is posting from inside the newsroom.',
    effect: 'The stolen staff login is used to send the same lure to colleagues and to post on the paper\'s social accounts.',
    targets: [['Staff mail page', 'window'], ['Newsroom accounts', 'account'], ['Social publishing', 'setting'], ['Password', 'secret']],
    fell: ['Your colleague\'s name was borrowed', ['The message looked like it came from a colleague, so you trusted the link.', 'The page copied the staff mail sign-in, and the password alone opened the account.', 'Safe step at the message: ask the colleague on chat whether they sent it. Safe step at the sign-in page: close the tab and open staff mail from your own bookmark.']],
    safe: ['You asked before you clicked', ['A short chat message to Wendell showed that nothing had been forwarded.', 'Reporting the message let the IT desk warn the rest of the newsroom before anyone else signed in.', 'Separate passwords for the social accounts would have contained a leak from staff mail.']],
  };

  S['twitter-stalkers-2011'] = {
    depth: 'midnight', family: 'network-abuse', year: 2011, attackTitle: 'Twitter "Stalkers app" scam (2011)', os: 'windows',
    card: { victim: 'college student', software: 'a desktop computer and a social network account', firstAction: 'check your mail before a lecture', next: 'A notice says a friend sent you a message about your profile.' },
    focusApps: ['browser', 'mail'], attackKind: 'account-takeover-post',
    title: 'See who is stalking your profile',
    intro: 'Your friend Brooke seems to have sent you a message. It says some people have been checking your page.',
    from: ['Chatterwing Notices', 'notices@chatterwing.example'], subject: 'A friend sent you a message about your profile',
    toast: ['Mail', 'Chatterwing Notices', 'Brooke sent you a message: "see who is stalking your profile!!"'],
    body: ['Your friend Brooke Hanley wrote: "see who is stalking your profile!! you wont believe it".', 'The message came with a link to the PeekBack app.'], link: 'See who is viewing you',
    signin: { url: 'peekback-app.example/connect', brand: 'PeekBack', headline: 'Log in to see your stalkers', sub: 'Use your Chatterwing name and password' },
    caption: 'Each hijacked account becomes another voice that posts the same lure.',
    effect: 'Your account starts messaging your friends with the same offer, and so the scam spreads.',
    targets: [['PeekBack page', 'window'], ['Chatterwing account', 'account'], ['Friend list', 'network'], ['Password', 'secret']],
    fell: ['Curiosity gave away the password', ['The message came from a friend\'s hijacked account, so it felt safe.', 'The app asked for your Chatterwing password, and the real site never works that way.', 'Safe step at the message: ask Brooke in person or by phone. Safe step at the login page: close the tab and change your password if you typed it anywhere.']],
    safe: ['You skipped the viewer app', ['No site can show who viewed your profile, so the offer itself was the tell.', 'You told Brooke that her account was posting spam, and she reset her password.', 'Reporting the post helps friends who see it next.']],
  };

  S['pypi-juiceledger-2022'] = {
    depth: 'midnight', family: 'trusted-source', year: 2022, attackTitle: 'PyPI JuiceLedger phishing (2022)', os: 'macos',
    card: { victim: 'software package maintainer', software: 'a laptop, a terminal and a package registry account', firstAction: 'check mail after a long coding session', next: 'The registry sends a notice about your account.' },
    focusApps: ['browser', 'mail'], attackKind: 'supply-chain-update',
    title: 'Verify your email or lose your package',
    intro: 'Your small library has a few thousand users. The package registry says it is verifying every maintainer.',
    from: ['Quillpack Security', 'security@quillpack-index.example'], subject: 'Email verification required: packages will be suspended',
    toast: ['Mail', 'Quillpack Security', 'Verify your email address or your packages will be suspended.'],
    body: ['Quillpack is verifying the email address of every maintainer as part of a security upgrade.', 'Packages owned by unverified accounts will be suspended on the 30th.'], link: 'Verify email address',
    signin: { url: 'quillpack-verify.example/account/login', brand: 'Quillpack Index', headline: 'Log in to verify your account', sub: 'Maintainer email verification' },
    caption: 'Your password lets the attacker publish a tainted release under a name people trust.',
    effect: 'A poisoned update is published to every project that installs your package.',
    targets: [['Verification page', 'window'], ['Maintainer account', 'account'], ['Release rights', 'setting'], ['Published package', 'file']],
    fell: ['The registry did not send that notice', ['A deadline and a threat to your package made the verification feel urgent.', 'Without a second factor on the account, the password alone was enough to publish a release.', 'Safe step at the message: open the registry from your own bookmark and look for a notice. Safe step at the login page: close the tab and report the message.']],
    safe: ['You went to the registry yourself', ['Your own bookmark showed no verification request and no suspension.', 'Reporting the message helped the registry warn other maintainers.', 'A hardware key or authenticator on the account would have blocked a stolen password.']],
  };

  S['ryan-collins-2014'] = {
    depth: 'midnight', family: 'theft-surveillance', year: 2014, attackTitle: 'Ryan Collins Apple and Google phishing (2014)', os: 'macos',
    card: { victim: 'working actor', software: 'a laptop and a cloud account that keeps your backups and photos', firstAction: 'check mail between rehearsals', next: 'An account security notice arrives.' },
    focusApps: ['browser', 'mail'], attackKind: 'data-exfil',
    title: 'Verify your account to keep your backups',
    intro: 'Your agent wants your attention on a callback, and a cloud security notice sits just below it in the inbox.',
    from: ['Cloudmoor Account Security', 'noreply@cloudmoor-id.example'], subject: 'Unusual activity on your Cloudmoor account',
    toast: ['Mail', 'Cloudmoor Account Security', 'Unusual sign-in. Verify your account to keep your backups safe.'],
    body: ['We noticed a sign-in to your account from a new device.', 'Verify your account details to keep your backups and photos safe.'], link: 'Verify your account',
    signin: { url: 'verify.cloudmoor-id-support.example/signin', brand: 'Cloudmoor ID', headline: 'Verify your account', sub: 'Confirm your details to keep your backups safe' },
    caption: 'The password opens the cloud account and the shark pulls out everything it finds.',
    effect: 'Backups, contacts and photos are downloaded in bulk.',
    targets: [['Verification page', 'window'], ['Cloud backups', 'file'], ['Photo library', 'file'], ['Account password', 'secret']],
    fell: ['A notice about safety was the theft', ['A message about protecting your backups made handing over the password feel sensible.', 'The page copied the real sign-in, and the password alone opened the account.', 'Safe step at the message: open the cloud settings yourself. Safe step at the sign-in page: close the tab and turn on two-step verification.']],
    safe: ['You checked the account yourself', ['Your own device settings showed no unusual sign-in.', 'Reporting the message protected others in your industry who got the same notice.', 'Two-step verification would have kept the stolen password from opening the account.']],
  };

  S['instagram-ransom-2021'] = {
    depth: 'midnight', family: 'extortion-destruction', year: 2021, attackTitle: 'Instagram account-ransom campaign (2021)', os: 'windows',
    card: { victim: 'small bakery owner', software: 'a shop computer and a photo-sharing business account', firstAction: 'check mail while the first batch bakes', next: 'The photo-sharing site says your business account needs a review.' },
    focusApps: ['browser', 'mail'], attackKind: 'account-takeover-post',
    title: 'Business account review',
    intro: 'Your bakery\'s page brings in half of your orders. A notice says the account is under review and may be removed.',
    from: ['Glimmerly Business Support', 'support@glimmerly-help.example'], subject: 'Business account review: confirm ownership today',
    toast: ['Mail', 'Glimmerly Business Support', 'Business account review: confirm ownership within 24 hours.'],
    body: ['Your business account has been selected for a review.', 'Confirm ownership within 24 hours or the account and all its posts will be removed.'], link: 'Confirm ownership',
    signin: { url: 'business-review.glimmerly-help.example/login', brand: 'Glimmerly', headline: 'Confirm account ownership', sub: 'Business account review' },
    caption: 'The lure takes the account hostage and posts a price for its return.',
    effect: 'The account email is changed, the page is locked and a payment is demanded.',
    targets: [['Review page', 'window'], ['Bakery account', 'account'], ['Photos and posts', 'file'], ['Password', 'secret']],
    fell: ['The account was held for ransom', ['The fear of losing your customers made the review feel urgent.', 'The password alone was enough for the attacker to lock you out and ask for money.', 'Safe step at the message: open the app yourself and look in the account settings. Safe step at the sign-in page: close the tab and report the message.']],
    safe: ['You checked the real app', ['The app showed no review and no warning, so you deleted the message.', 'Reporting it protected other small shops who got it too.', 'A second factor on the account would have stopped a stolen password from locking you out.']],
  };

  S['ap-2013'] = {
    depth: 'midnight', family: 'trusted-source', year: 2013, attackTitle: 'Associated Press phishing (2013)', os: 'windows',
    card: { victim: 'newsroom social media editor', software: 'a desktop computer on the newsroom network', firstAction: 'check mail before the afternoon desk call', next: 'A colleague forwards a story about your agency.' },
    focusApps: ['browser', 'mail'], attackKind: 'account-takeover-post',
    title: 'A rival story about our coverage',
    intro: 'The afternoon call is at three. A colleague forwards a rival\'s story about your wire service and says it is a must-read.',
    from: ['Ines Calloway', 'ines.calloway@harborwire.example'], subject: 'Fwd: Rival story on our coverage, see before the 3 pm call',
    toast: ['Mail', 'Ines Calloway', 'Fwd: Rival story on our coverage, see before the 3 pm call.'],
    body: ['A rival paper ran a long story about our coverage and our social accounts.', 'You may have to log on to the newsroom network to open it.'], link: 'Read the story',
    signin: { url: 'logon.harborwire-newsroom.example/staff', brand: 'Harbor Wire Newsroom', headline: 'Log on to the newsroom network', sub: 'Staff access required' },
    caption: 'One logon, and a false headline goes out from the agency\'s own account.',
    effect: 'The stolen logon is used to post a false breaking-news item to a large audience.',
    targets: [['Newsroom logon page', 'window'], ['Staff account', 'account'], ['Agency social account', 'network'], ['Password', 'secret']],
    fell: ['A trusted newsroom name opened the door', ['The message looked like an ordinary forward from a colleague, so the link felt safe.', 'The logon page copied the newsroom network, and the password alone gave access.', 'Safe step at the message: ask Ines on chat whether she sent it. Safe step at the logon page: close the tab and tell the IT helpdesk.']],
    safe: ['You checked with the sender', ['Ines had not forwarded anything, so you reported the message.', 'The IT helpdesk warned the desk before another person logged on.', 'Publishing rights on the agency account should need more than a single password.']],
  };

  S['guardian-2013'] = {
    depth: 'midnight', family: 'deception', year: 2013, attackTitle: 'Guardian phishing (2013)', os: 'windows',
    card: { victim: 'newspaper journalist', software: 'a desktop computer and the newsroom webmail', firstAction: 'check mail before the morning news conference', next: 'The IT helpdesk writes about your mailbox.' },
    focusApps: ['browser', 'mail'], attackKind: 'account-takeover-post',
    title: 'Your mailbox is over quota',
    intro: 'The morning conference is at ten. The IT helpdesk says your mailbox is full and about to be suspended.',
    from: ['Courier IT Helpdesk', 'helpdesk@meridiancourier-it.example'], subject: 'Mailbox over quota: verify to avoid suspension',
    toast: ['Mail', 'Courier IT Helpdesk', 'Your mailbox is over quota. Verify your account to avoid suspension.'],
    body: ['Your mailbox has passed its size limit and will stop receiving mail within 24 hours.', 'Sign in to the webmail page to raise your limit.'], link: 'Raise my mailbox limit',
    signin: { url: 'webmail.meridiancourier-quota.example/login', brand: 'Courier Webmail', headline: 'Sign in to raise your mailbox limit', sub: 'Staff accounts only' },
    caption: 'The look-alike webmail page keeps the password, and the lure walks into the newsroom.',
    effect: 'The stolen password is used to post from the paper\'s accounts and to send the same lure to more staff.',
    targets: [['Webmail page', 'window'], ['Staff mailbox', 'account'], ['Paper\'s social accounts', 'network'], ['Password', 'secret']],
    fell: ['A fake helpdesk got the password', ['A threat to your mailbox made the quick fix feel like routine IT work.', 'The page copied the webmail sign-in, and the password alone gave access to your account.', 'Safe step at the message: call the helpdesk on its known number. Safe step at the sign-in page: close the tab and report the message.']],
    safe: ['You called the real helpdesk', ['The helpdesk said it had sent no such notice, so the link stayed unclicked.', 'Reporting the message let IT block the sender for every journalist.', 'IT staff never need your password, and a quota notice can wait for a call.']],
  };

  S['ft-2013'] = {
    depth: 'midnight', family: 'intrusion', year: 2013, attackTitle: 'Financial Times phishing (2013)', os: 'windows',
    card: { victim: 'financial newspaper reporter', software: 'a desktop computer and a corporate cloud mail account', firstAction: 'check mail before the markets briefing', next: 'Tech support announces a change to the staff sign-in.' },
    focusApps: ['browser', 'mail'], attackKind: 'credential-phish',
    title: 'The new single sign-in',
    intro: 'The markets briefing is at half past seven. Tech support says the staff sign-in is being upgraded and you must act today.',
    from: ['Copper Ledger Tech Support', 'techsupport@copperledger.example'], subject: 'Action required: upgrade to the new Ledger Apps sign-in',
    toast: ['Mail', 'Copper Ledger Tech Support', 'Action required: upgrade to the new Ledger Apps sign-in today.'],
    body: ['Staff accounts are moving to a new single sign-in this week.', 'Sign in once to keep your mail, calendar and blog access.'], link: 'Upgrade my sign-in',
    signin: { url: 'apps.copperledger-signin.example/a/login', brand: 'Ledger Apps', headline: 'Sign in with your Ledger Apps account', sub: 'Staff single sign-in upgrade' },
    caption: 'The copied sign-in page keeps your password, and the intruder reads your mail from the inside.',
    effect: 'The stolen password opens staff mail, and the same lure goes out from your address to other staff.',
    targets: [['Sign-in page', 'window'], ['Staff mailbox', 'account'], ['Blog access', 'setting'], ['Password', 'secret']],
    fell: ['A fake upgrade took the password', ['An announced change felt like routine tech support, so you did not check it.', 'The page copied the company sign-in, and a single password opened mail and blogs.', 'Safe step at the message: confirm the upgrade with tech support on a known number. Safe step at the sign-in page: close the tab and report the message.']],
    safe: ['You confirmed the change first', ['Tech support said no upgrade was planned, so you did not use the link.', 'Reporting the message got the sender blocked for the whole newsroom.', 'A second factor on staff mail would have stopped a stolen password from opening it.']],
  };

  S['colin-powell-2016'] = {
    depth: 'midnight', family: 'theft-surveillance', year: 2016, attackTitle: 'Colin Powell email phishing (2016)', os: 'windows',
    card: { victim: 'retired diplomat and advisor', software: 'a home computer and a personal webmail account', firstAction: 'check mail before a board call', next: 'A security alert from your mail provider arrives.' },
    focusApps: ['browser', 'mail'], attackKind: 'data-exfil',
    title: 'New device sign-in',
    intro: 'The board call is at eleven. Your mail provider says a new device just tried to sign in to your account.',
    from: ['Letterfinch Security', 'alerts@letterfinch-security.example'], subject: 'Letterfinch security alert: new device sign-in',
    toast: ['Mail', 'Letterfinch Security', 'A new device tried to sign in. Review your account activity now.'],
    body: ['Your Letterfinch account was accessed from an unrecognised device.', 'Review your sign-in activity and secure your account.'], link: 'Review activity',
    signin: { url: 'letterfinch-account-alerts.example/signin', brand: 'Letterfinch', headline: 'Review your sign-in activity', sub: 'Sign in to secure your account' },
    caption: 'The password opens years of private mail and the shark copies it out.',
    effect: 'A large mail archive is downloaded and later published.',
    targets: [['Review page', 'window'], ['Personal inbox', 'account'], ['Mail archive', 'file'], ['Password', 'secret']],
    fell: ['A security alert exposed the archive', ['A warning about a stranger made you hurry to secure the account.', 'The page copied the provider\'s sign-in, and the password alone opened the whole inbox.', 'Safe step at the message: open the provider from your own bookmark and look at activity. Safe step at the sign-in page: close the tab and ask your assistant to check.']],
    safe: ['You checked the account yourself', ['Your own bookmark showed no new device, so the alert was false.', 'Your assistant forwarded the message to the provider as phishing.', 'Two-step verification would have kept the password from opening the archive.']],
  };

  S['password-only-smishing'] = {
    depth: 'midnight', family: 'network-abuse', year: 2024, attackTitle: 'Password-only smishing (composite)', os: 'macos',
    card: { victim: 'freelance designer', software: 'a laptop that also receives your phone\'s text messages', firstAction: 'check mail while waiting for a parcel', next: 'A text about your parcel is forwarded to your inbox.' },
    focusApps: ['browser', 'mail'], attackKind: 'credential-phish',
    title: 'Your parcel is held at the depot',
    intro: 'Drawing paper is on its way. A text message, forwarded to your inbox, says the parcel is stuck.',
    from: ['Text Relay', 'relay@textrelay.example'], subject: 'New text message from +1 555 0142',
    toast: ['Mail', 'Text Relay', 'New text message from +1 555 0142: your parcel is held at the depot.'],
    body: ['Forwarded text message from +1 555 0142:', '"Crateline: your parcel is held at our depot. Reschedule your delivery with the link below or it will be returned in 24 hours."'], link: 'Reschedule delivery',
    signin: { url: 'crateline-reschedule.example/track', brand: 'Crateline', headline: 'Reschedule your delivery', sub: 'Log in to your Crateline account' },
    caption: 'The text reaches you through a trusted channel, and the lure takes the password.',
    effect: 'The stolen password opens the delivery account, and the same text goes out to your contacts.',
    targets: [['Reschedule page', 'window'], ['Crateline account', 'account'], ['Saved addresses', 'file'], ['Password', 'secret']],
    fell: ['A parcel text got the password', ['You were waiting for a parcel, so the text fitted your day.', 'The page asked for a Crateline password, and nothing else stood between it and the account.', 'Safe step at the message: check the tracking number in the shop\'s own order email. Safe step at the login page: close the tab and delete the text.']],
    safe: ['You checked your own order', ['The shop\'s order email showed the parcel arriving on Tuesday, so the text was wrong.', 'You reported the number and deleted the message.', 'A courier never needs a password just to reschedule a delivery.']],
  };

  S['password-only-quishing'] = {
    depth: 'midnight', family: 'deception', year: 2024, attackTitle: 'Password-only quishing (composite)', os: 'windows',
    card: { victim: 'logistics depot administrator', software: 'an office computer and a work mailbox', firstAction: 'sort the morning mail before the depot opens', next: 'A message from the benefits team arrives with a QR code.' },
    focusApps: ['browser', 'mail'], attackKind: 'credential-phish',
    title: 'Scan to confirm your benefits',
    intro: 'Open enrolment closes on Friday. A message from the benefits team asks you to scan a code to confirm your plan.',
    from: ['Brightmoor Benefits Team', 'benefits@brightmoor-hr.example'], subject: 'Open enrolment closes Friday: scan to confirm your plan',
    toast: ['Mail', 'Brightmoor Benefits Team', 'Open enrolment closes Friday. Scan the code to confirm your plan.'],
    body: ['Scan the QR code below with your phone camera to confirm your benefits plan before Friday.', '[QR code image. If you cannot scan it, use the link below on this computer.]'], link: 'Confirm on this computer',
    signin: { url: 'benefits.brightmoor-enroll.example/login', brand: 'Brightmoor Benefits', headline: 'Confirm your benefit plan', sub: 'Sign in with your work account' },
    caption: 'The code hides the address, and the lure takes the work password.',
    effect: 'The stolen password opens work mail, and the same message goes out to colleagues.',
    targets: [['Benefits page', 'window'], ['Work account', 'account'], ['Staff directory', 'network'], ['Password', 'secret']],
    fell: ['A code hid the address', ['A QR code shows no address, so you could not check where it led.', 'The page asked for your work password, and nothing else stood between it and your mailbox.', 'Safe step at the message: open the benefits portal from the intranet. Safe step at the sign-in page: close the tab and report the message to IT.']],
    safe: ['You used the intranet link', ['The intranet portal showed enrolment open until the end of the month, so the Friday deadline was false.', 'Reporting the message let IT block the sender before colleagues scanned the code.', 'Never scan a code from a message that asks for a password.']],
  };
})();
