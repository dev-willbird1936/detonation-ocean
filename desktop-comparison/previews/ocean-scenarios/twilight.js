// Twilight scenarios (owner: content-twilight). Twelve fictional reconstructions: a lure, a sign-in, then a second factor.
// The real attack name and year appear only in attackTitle/year; people, organisations, products and domains are invented.
// scattered-spider has no single year in the selection, so its year is null (the intro card then omits the year).
// Shape: docs/desktop-parity/SCENARIOS-60-CONTRACT.md §2. Step copy follows the twilight entries in ocean-scenes.js.
(() => {
  'use strict';
  const S = (globalThis.OceanScenarioData ||= {});

  S['0ktapus-2022'] = {
    depth: 'twilight', family: 'deception', year: 2022, attackTitle: '0ktapus', os: 'windows',
    card: {
      victim: 'customer-support agent at a messaging company', software: 'a Windows work laptop and the staff mail app',
      firstAction: 'check the text alerts your company relays into your inbox', next: 'A notice says your password has expired and asks you to sign in again.',
    },
    focusApps: ['mail', 'browser', 'messages'], attackKind: 'credential-phish',
    title: 'Your password has expired',
    intro: 'Between support calls, a relayed text alert says your Chatwell password has expired.',
    from: ['Chatwell Staff Alerts', 'alerts@chatwell-staff.example'], subject: 'Text alert: your Chatwell password has expired',
    toast: ['Mail', 'Chatwell Staff Alerts', 'Your Chatwell password has expired. Set a new one before your next shift.'],
    body: ['Your Chatwell password has expired.', 'Set a new password before your next shift to keep access to the support queue.'], link: 'Set a new password',
    signin: { url: 'sso.chatwell-staff-login.example/start', brand: 'Chatwell SSO', headline: 'Sign in to Chatwell', sub: 'Staff single sign-on' },
    mfa: { mode: 'code', headline: 'Enter your verification code', sub: 'Use the code from your authenticator app or your text messages', code: '507284', button: 'Verify' },
    caption: 'The look-alike sign-in passes your password and your code to the real site while the lure watches.',
    effect: 'The captured session opens the support tools and the customer records behind them.',
    targets: [['Chatwell SSO', 'window'], ['Staff account', 'account'], ['Verification code', 'secret'], ['Customer support tools', 'setting']],
    fell: ['One look-alike page collected both steps', ['At the message: a password-expiry alert that arrives as a relayed text is a lure, so report it instead of using the link.', 'At the sign-in page: the address was a look-alike, so open Chatwell SSO from your own bookmark.', 'At the code step: a one-time code belongs only to the real site, so never type it after following a link.']],
    safe: ['You went to your own bookmark', ['Your bookmarked sign-in showed no expired password.', 'Reporting the text lets IT block the look-alike address for every colleague.']],
  };

  S['uber-2022'] = {
    depth: 'twilight', family: 'intrusion', year: 2022, attackTitle: 'Uber', os: 'windows',
    card: {
      victim: 'contractor at a ride-hailing company', software: 'a Windows laptop and the contractor sign-in portal',
      firstAction: 'finish an evening shift while sign-in prompts keep arriving', next: 'A message from "IT" says approving the next prompt will stop them.',
    },
    focusApps: ['mail', 'browser', 'mfa'], attackKind: 'mfa-fatigue',
    title: 'Approve it to make it stop',
    intro: 'Sign-in prompts keep arriving for an account you are not using. A message from "IT" offers a fix.',
    from: ['Roamly IT Support', 'it-support@roamly-helpdesk.example'], subject: 'Contractor access fault: approve the prompt to clear it',
    toast: ['Mail', 'Roamly IT Support', 'Contractor access fault. Approve the next prompt to clear it.'],
    body: ['A sync fault is retrying your contractor sign-in and sending repeated prompts.', 'Sign in once and approve the prompt. The fault clears and the alerts stop.'], link: 'Clear the fault',
    signin: { url: 'access.roamly-contractors.example/login', brand: 'Roamly Contractor Access', headline: 'Sign in to contractor access', sub: 'Staffing partner portal' },
    mfa: { mode: 'push', brand: 'Roamly Authenticator', title: 'Approve sign-in?', text: 'Another sign-in request for contractor access. Approve only if you started it.', number: '29', approve: 'Approve', deny: 'Deny' },
    caption: 'One tired tap lets the attacker in as you, and the contractor account opens the internal network.',
    effect: 'The attacker uses the approved session to reach internal tools.',
    targets: [['Contractor session', 'network'], ['Contractor account', 'account'], ['Internal tools', 'window'], ['Access policy', 'setting']],
    fell: ['You approved a prompt you did not start', ['At the message: IT does not ask you to approve prompts to clear a fault, so report the message and call the helpdesk number you already know.', 'At the sign-in page: you had no reason to sign in, so close the tab.', 'At the prompt: deny any request you did not start, then tell security about the repeated prompts.']],
    safe: ['You denied the prompt and reported it', ['Repeated prompts you did not start are an attack in progress, not a fault.', 'A denial plus a report lets security reset the password before anyone gets in.']],
  };

  S['tycoon2fa'] = {
    depth: 'twilight', family: 'network-abuse', year: 2023, attackTitle: 'Tycoon2FA', os: 'windows',
    card: {
      victim: 'accounts-payable clerk at a small freight company', software: 'a Windows desktop and the web mail app',
      firstAction: 'sort the morning invoices and remittance notices', next: 'A remittance advice arrives with a link to view it online.',
    },
    focusApps: ['mail', 'browser', 'messages'], attackKind: 'credential-phish',
    title: 'Remittance advice',
    intro: 'The morning invoices are half done when a remittance advice arrives from a supplier you know.',
    from: ['Cresta Supplies Accounts', 'accounts@cresta-supplies-pay.example'], subject: 'Remittance advice: payment sent to Bayline Freight',
    toast: ['Mail', 'Cresta Supplies Accounts', 'Remittance advice for payment sent to Bayline Freight.'],
    body: ['A payment was sent to Bayline Freight this morning.', 'View the remittance advice online to match it to your invoices.'], link: 'View remittance advice',
    signin: { url: 'view.cresta-docs-secure.example/remit', brand: 'Cresta Documents', headline: 'Sign in to view the document', sub: 'Remittance advice' },
    mfa: { mode: 'code', headline: 'Confirm it is you', sub: 'Enter the code from your authenticator app', code: '318046', button: 'Confirm' },
    caption: 'A relay page passes every step to the real mail service as you type, and the answer comes straight back to the lure.',
    effect: 'The relayed session is reused to read mail and send the same lure to your contacts.',
    targets: [['Document sign-in', 'window'], ['Mail account', 'account'], ['Session cookie', 'secret'], ['Mail rules', 'setting']],
    fell: ['The relay completed your second factor for the attacker', ['At the message: payment news from a supplier address you cannot match to a past invoice is worth a call to the supplier on a known number.', 'At the sign-in page: a document viewer that wants your mail login is a look-alike, so open your mail from your own bookmark.', 'At the code step: a relayed code works at once, so stop here and let a passkey or hardware key do this step in future.']],
    safe: ['You checked with the supplier first', ['A call to the supplier on a known number showed no payment had been sent.', 'Reporting the message stops colleagues from opening the same page.']],
  };

  S['retool-2023'] = {
    depth: 'twilight', family: 'trusted-source', year: 2023, attackTitle: 'Retool', os: 'macos',
    card: {
      victim: 'IT operations engineer at a software platform company', software: 'a Mac laptop and the company mail app',
      firstAction: 'handle the open-enrolment reminders from the benefits portal', next: 'A notice says a payroll deduction problem blocks your health plan.',
    },
    focusApps: ['mail', 'browser', 'messages'], attackKind: 'credential-phish',
    title: 'Health plan problem',
    intro: 'Open enrolment closes this week. A notice says a payroll problem will remove your health cover.',
    from: ['Hartwell Benefits Notices', 'notices@hartwell-benefits.example'], subject: 'Payroll problem: your health plan enrolment is at risk',
    toast: ['Mail', 'Hartwell Benefits Notices', 'Payroll problem: your health plan enrolment is at risk. Sign in to fix it.'],
    body: ['A deduction problem is blocking your health plan enrolment.', 'Sign in to the staff portal and confirm the code from your authenticator app to keep your cover.'], link: 'Open the staff portal',
    signin: { url: 'staff.latchwork-sso-help.example/login', brand: 'Latchwork SSO', headline: 'Sign in to the Latchwork staff portal', sub: 'Benefits and payroll' },
    mfa: { mode: 'code', headline: 'Enter your authenticator code', sub: 'From your authenticator app', code: '264790', button: 'Verify' },
    caption: 'Your code opens the provider account, and every customer behind it is one hop away.',
    effect: 'The attacker acts as a provider employee and reaches the accounts of downstream customers.',
    targets: [['Staff portal', 'window'], ['Provider account', 'account'], ['One-time code', 'secret'], ['Customer support tools', 'setting']],
    fell: ['A trusted employee account was the way in', ['At the message: a benefits or payroll warning with a deadline is a lure, so open the benefits site from the intranet instead of the link.', 'At the sign-in page: the address is not the staff portal you use, so close the tab and report it.', 'At the code step: no real colleague, caller or page needs your code, so keep it to yourself and use a hardware key where one is offered.']],
    safe: ['You used the intranet link and reported the message', ['The intranet benefits page showed no payroll problem.', 'Reporting the notice let security block the sender before others signed in.']],
  };

  S['dropbox-2022'] = {
    depth: 'twilight', family: 'theft-surveillance', year: 2022, attackTitle: 'Dropbox', os: 'macos',
    card: {
      victim: 'software engineer at a file-sync company', software: 'a Mac laptop and the team mail app',
      firstAction: 'wait on a build in the continuous integration tool', next: 'A notice says your build access needs re-verification.',
    },
    focusApps: ['mail', 'browser', 'messages'], attackKind: 'data-exfil',
    title: 'Build access needs re-verifying',
    intro: 'A build is running when a message from the build service says your access needs re-verifying.',
    from: ['LoopCI Notifications', 'no-reply@loopci-notify.example'], subject: 'Action needed: re-verify your LoopCI access',
    toast: ['Mail', 'LoopCI Notifications', 'Action needed: re-verify your LoopCI access to keep running builds.'],
    body: ['Your organisation has changed its access settings for LoopCI.', 'Sign in through your code host and confirm the one-time code to keep running builds.'], link: 'Re-verify access',
    signin: { url: 'app.loopci-access.example/login', brand: 'LoopCI', headline: 'Sign in with your code host', sub: 'Re-verify your account' },
    mfa: { mode: 'code', headline: 'Enter your one-time code', sub: 'From your authenticator app', code: '931275', button: 'Verify' },
    caption: 'The page relays your code before it expires, and the copied repositories leave through the open session.',
    effect: 'The attacker opens private repositories and copies them out.',
    targets: [['Code host sign-in', 'window'], ['Developer account', 'account'], ['One-time code', 'secret'], ['Private repositories', 'file']],
    fell: ['A one-time code opened the code host', ['At the message: a build-service notice that wants a re-sign-in should be checked in the service itself, so open it from your own bookmark.', 'At the sign-in page: the address was a look-alike of the build service, so close it and report it.', 'At the code step: a typed code can be relayed, while a hardware key checks the real site, so use your key for this step.']],
    safe: ['You opened the build service yourself', ['Your own bookmark showed no re-verification request.', 'Reporting the message let security warn the engineering channel.']],
  };

  S['scattered-spider'] = {
    depth: 'twilight', family: 'extortion-destruction', year: null, attackTitle: 'Scattered Spider', os: 'windows',
    card: {
      victim: 'front-office manager at a resort and casino group', software: 'a Windows desktop and the company mail app',
      firstAction: 'start a busy shift at the reservations desk', next: 'The service desk says your device registration has lapsed.',
    },
    focusApps: ['mail', 'browser', 'mfa'], attackKind: 'ransomware-encrypt',
    title: 'Device registration lapsed',
    intro: 'The reservations desk is busy when the service desk says your sign-in device has to be registered again.',
    from: ['Marlowe Service Desk', 'servicedesk@marlowe-resorts-it.example'], subject: 'Your device registration has lapsed',
    toast: ['Mail', 'Marlowe Service Desk', 'Your device registration has lapsed. Re-register to keep your access.'],
    body: ['Your sign-in device registration has lapsed.', 'Register again now. A prompt will appear on your phone and you approve it to finish.'], link: 'Register my device',
    signin: { url: 'register.marlowe-devices.example/login', brand: 'Marlowe Device Registration', headline: 'Register your sign-in device', sub: 'Staff access' },
    mfa: { mode: 'push', brand: 'Marlowe Authenticator', title: 'Approve device registration?', text: 'A new device is asking to register for your account. Approve only if you started it.', number: '84', approve: 'Approve', deny: 'Deny' },
    caption: 'Your approval registers the attacker\'s device, and from there the group moves across the network.',
    effect: 'The attacker holds a trusted device, steals data and locks the systems for extortion.',
    targets: [['Device registration', 'window'], ['Staff account', 'account'], ['Reservation systems', 'network'], ['Backup settings', 'setting']],
    fell: ['A new device was registered for the attacker', ['At the message: a service desk asks for a ticket in the tool you know, so report the message and check the ticket queue.', 'At the sign-in page: you started nothing, so close the tab.', 'At the prompt: deny a registration you did not start, and report it so the account can be locked.']],
    safe: ['You denied the registration', ['No registration was started by you, so the prompt could only come from someone else.', 'The report let the real service desk lock the account and watch for the next attempt.']],
  };

  S['twitter-2020'] = {
    depth: 'twilight', family: 'intrusion', year: 2020, attackTitle: 'Twitter employee MFA compromise', os: 'macos',
    card: {
      victim: 'customer-support specialist at a social network', software: 'a Mac laptop at home and the company mail app',
      firstAction: 'work the support queue from your kitchen table', next: 'A caller from "IT" says your remote access needs fixing and sends a link.',
    },
    focusApps: ['mail', 'browser', 'mfa'], attackKind: 'account-takeover-post',
    title: 'The call from IT',
    intro: 'You work from home. Someone from "IT" has just called about a remote-access problem and says a message is on its way.',
    from: ['Chirpwell Remote Access', 'remote-access@chirpwell-support.example'], subject: 'As discussed: reset your remote access',
    toast: ['Mail', 'Chirpwell Remote Access', 'As discussed on the call: reset your remote access.'],
    body: ['Thanks for taking the call. Your remote access is out of date after the move to working from home.', 'Sign in at the link below and approve the prompt. The caller will stay on the line.'], link: 'Reset remote access',
    signin: { url: 'vpn.chirpwell-remote.example/login', brand: 'Chirpwell Remote Access', headline: 'Sign in to remote access', sub: 'Support staff' },
    mfa: { mode: 'push', brand: 'Chirpwell Authenticator', title: 'Approve sign-in?', text: 'A remote access sign-in is waiting. Approve only if you started it.', number: '36', approve: 'Approve', deny: 'Deny' },
    caption: 'Your approval lets the caller into the account tools, and the attacker starts posting from other people\'s accounts.',
    effect: 'The attacker reaches the internal account tools and takes over high-profile accounts to post.',
    targets: [['Remote access sign-in', 'window'], ['Support account', 'account'], ['Account tools', 'setting'], ['Internal network', 'network']],
    fell: ['The caller was the attacker', ['At the message: a call you did not book is a lure, so hang up and call the helpdesk number you already know.', 'At the sign-in page: an address you cannot match to your own bookmark is a look-alike, so close it.', 'At the prompt: deny any approval a caller asks for, and report the call to security.']],
    safe: ['You hung up and called back', ['The helpdesk number you already knew had no record of a call or a ticket.', 'Your report let security block the link and warn other support staff.']],
  };

  S['cisco-2022'] = {
    depth: 'twilight', family: 'deception', year: 2022, attackTitle: 'Cisco MFA approval', os: 'windows',
    card: {
      victim: 'network engineer at a networking company', software: 'a Windows work laptop and the browser that syncs your personal profile',
      firstAction: 'return from a meeting to a missed call and a voicemail note', next: 'The note says security tried to reach you about your account.',
    },
    focusApps: ['mail', 'browser', 'mfa'], attackKind: 'mfa-fatigue',
    title: 'Security tried to reach you',
    intro: 'Your phone shows missed calls. A note in your inbox says the security team tried to reach you about your account.',
    from: ['Brinecom Security Operations', 'secops-callback@brinecom-support.example'], subject: 'Missed call: we need to confirm your sign-in',
    toast: ['Mail', 'Brinecom Security Operations', 'Missed call: we need to confirm a sign-in on your account.'],
    body: ['We tried to call you about a sign-in on your account.', 'Sign in once and accept the prompt on your phone so we can close the case.'], link: 'Confirm my sign-in',
    signin: { url: 'secure.brinecom-verify.example/login', brand: 'Brinecom Secure Access', headline: 'Sign in to confirm your account', sub: 'Security case' },
    mfa: { mode: 'push', brand: 'Brinecom Authenticator', title: 'Approve sign-in?', text: 'A sign-in request is waiting for your account. Approve only if you started it.', number: '72', approve: 'Approve', deny: 'Deny' },
    caption: 'Once you accept, the attacker is signed in with credentials your browser had already synced.',
    effect: 'The attacker uses the approved session to reach the corporate network.',
    targets: [['Secure access sign-in', 'window'], ['Engineer account', 'account'], ['Synced browser logins', 'secret'], ['Corporate network', 'network']],
    fell: ['You accepted a prompt the caller asked for', ['At the message: a caller who says they are security should be called back on the number in the staff directory, so do that before any link.', 'At the sign-in page: you opened a case that nobody can confirm, so close the tab.', 'At the prompt: deny any request you did not start, and keep work logins out of a personal browser profile.']],
    safe: ['You called security back on the staff number', ['The staff directory number reached the real team, which had no case open.', 'The report let security reset the synced credentials before the next call.']],
  };

  S['lapsus-mfa-fatigue'] = {
    depth: 'twilight', family: 'extortion-destruction', year: 2022, attackTitle: 'LAPSUS$ MFA fatigue', os: 'windows',
    card: {
      victim: 'night-shift support agent at an outsourcing company', software: 'a Windows desktop and the shared helpdesk mailbox',
      firstAction: 'work the overnight queue while sign-in prompts pile up on your phone', next: 'A note from "night operations" says approving once will end the prompts.',
    },
    focusApps: ['mail', 'browser', 'mfa'], attackKind: 'mfa-fatigue',
    title: 'Ten prompts and a polite note',
    intro: 'It is two in the morning. Ten sign-in prompts have arrived, and now a note offers to stop them.',
    from: ['Callbridge Night Operations', 'night-ops@callbridge-hours.example'], subject: 'About the repeated sign-in prompts tonight',
    toast: ['Mail', 'Callbridge Night Operations', 'About the repeated sign-in prompts tonight. One approval ends them.'],
    body: ['The sign-in service is repeating prompts for night staff after a misconfiguration.', 'Approve one prompt and the service stops. We are fixing it now.'], link: 'Stop the prompts',
    signin: { url: 'nightdesk.callbridge-access.example/login', brand: 'Callbridge Night Desk', headline: 'Sign in to the night desk', sub: 'Overnight staff' },
    mfa: { mode: 'push', brand: 'Callbridge Authenticator', title: 'Approve sign-in?', text: 'This is request 11 tonight. Approve only if you started it.', number: '18', approve: 'Approve', deny: 'Deny' },
    caption: 'The eleventh prompt works because you are tired, and the attacker gets in as you.',
    effect: 'The attacker uses your access to copy data and then demands payment to keep it private.',
    targets: [['Night desk sign-in', 'window'], ['Agent account', 'account'], ['Customer records', 'file'], ['Admin tools', 'setting']],
    fell: ['The eleventh prompt was the break-in', ['At the message: a note that asks you to approve prompts is the attacker, so report it to your team lead.', 'At the sign-in page: you had no reason to sign in, so close the tab.', 'At the prompt: deny every request, then change your password and tell security about the count.']],
    safe: ['You denied every prompt and reported it', ['Ten prompts you did not start mean someone has your password.', 'Reporting the count let security reset the password and end the attack before the data left.']],
  };

  S['reddit-2023'] = {
    depth: 'twilight', family: 'theft-surveillance', year: 2023, attackTitle: 'Reddit second-factor phishing', os: 'macos',
    card: {
      victim: 'product operations employee at a community forum company', software: 'a Mac laptop and the company mail app',
      firstAction: 'check the intranet for the weekly update', next: 'A message asks you to confirm your gateway sign-in after a policy change.',
    },
    focusApps: ['mail', 'browser', 'messages'], attackKind: 'data-exfil',
    title: 'Confirm your gateway sign-in',
    intro: 'The weekly update is due. A message says a policy change means you must confirm your intranet gateway sign-in.',
    from: ['Threadwell IT', 'it-notices@threadwell-staff.example'], subject: 'Confirm your intranet gateway sign-in',
    toast: ['Mail', 'Threadwell IT', 'Confirm your intranet gateway sign-in after the policy change.'],
    body: ['A policy change means every employee must confirm the intranet gateway sign-in this week.', 'Sign in at the link and enter your code to confirm.'], link: 'Confirm gateway sign-in',
    signin: { url: 'gateway.threadwell-intranet.example/login', brand: 'Threadwell Gateway', headline: 'Sign in to the intranet gateway', sub: 'Employee access' },
    mfa: { mode: 'code', headline: 'Enter your verification code', sub: 'From your authenticator app', code: '640913', button: 'Verify' },
    caption: 'A copy of the intranet gateway takes your sign-in and your code in one visit.',
    effect: 'The attacker browses internal documents and copies out what it finds.',
    targets: [['Intranet gateway', 'window'], ['Employee account', 'account'], ['Verification code', 'secret'], ['Internal documents', 'file']],
    fell: ['A copy of the gateway collected both factors', ['At the message: a policy notice that sends you to a sign-in is a lure, so open the intranet from your own bookmark.', 'At the sign-in page: the page looked like the gateway but the address was a look-alike, so close it and report it.', 'At the code step: never type a code after following a link, and use a hardware key where one is offered.']],
    safe: ['You opened the intranet from your bookmark', ['The real gateway showed no policy change.', 'The report let IT take down the copy before anyone else signed in.']],
  };

  S['evilproxy'] = {
    depth: 'twilight', family: 'network-abuse', year: 2022, attackTitle: 'EvilProxy MFA phishing', os: 'windows',
    card: {
      victim: 'vice president of operations at a holding company', software: 'a Windows laptop and the company mail app',
      firstAction: 'clear your inbox between board calls', next: 'An expense report is waiting for your approval.',
    },
    focusApps: ['mail', 'browser', 'mfa'], attackKind: 'credential-phish',
    title: 'Expense report awaiting approval',
    intro: 'Between board calls, an expense report is waiting for your approval in the finance tool.',
    from: ['SpendTrail Approvals', 'approvals@spendtrail-reports.example'], subject: 'Expense report awaiting your approval',
    toast: ['Mail', 'SpendTrail Approvals', 'An expense report is awaiting your approval.'],
    body: ['An expense report was submitted for your approval.', 'Sign in to review and approve it before the close.'], link: 'Review the report',
    signin: { url: 'login.spendtrail-reports.example/auth', brand: 'SpendTrail', headline: 'Sign in to approve the report', sub: 'Expense approvals' },
    mfa: { mode: 'push', brand: 'Quillmark Authenticator', title: 'Approve sign-in?', text: 'A sign-in to your work account is waiting. Approve only if you started it.', number: '51', approve: 'Approve', deny: 'Deny' },
    caption: 'A reverse proxy shows the real sign-in page, passes your approval along and keeps the session it gets back.',
    effect: 'The attacker holds your signed-in session and reads mail and files as you.',
    targets: [['Expense sign-in', 'window'], ['Executive account', 'account'], ['Session cookie', 'secret'], ['Mail and files', 'file']],
    fell: ['The proxy kept your signed-in session', ['At the message: an approval request you did not expect should be opened from the finance tool you normally use, not from the link.', 'At the sign-in page: the real page can come through a look-alike address, so check the address bar first.', 'At the prompt: deny anything you did not start, and prefer a passkey that works only on the real site.']],
    safe: ['You opened the finance tool yourself', ['Your own bookmark showed no report waiting.', 'Reporting the message let security block the look-alike address for the whole firm.']],
  };

  S['midnight-blizzard-2023'] = {
    depth: 'twilight', family: 'trusted-source', year: 2023, attackTitle: 'Midnight Blizzard Teams lure', os: 'windows',
    card: {
      victim: 'IT administrator at a small regional organisation', software: 'a Windows laptop and the Huddle chat app',
      firstAction: 'step away from a ticket while chat notifications arrive', next: 'A chat from "identity protection" says your account needs to be verified.',
    },
    focusApps: ['mail', 'browser', 'mfa'], attackKind: 'mfa-fatigue',
    title: 'The chat from identity protection',
    intro: 'A chat notification arrives from an account called "Identity Protection". It says your sign-in needs checking.',
    from: ['Huddle Notifications', 'notifications@huddle-chat.example'], subject: 'You have a new chat message from Identity Protection',
    toast: ['Mail', 'Huddle Notifications', 'New chat message from Identity Protection: verify your account.'],
    body: ['Identity Protection: we detected a sign-in problem on your account.', 'Open the verification page. It will show a number. Enter it in your authenticator app to confirm it is you.'], link: 'Verify my account',
    signin: { url: 'verify.huddle-identity.example/check', brand: 'Identity Check', headline: 'Verify your account', sub: 'Identity Protection' },
    mfa: { mode: 'push', brand: 'Fernhill Authenticator', title: 'Enter the number to sign in?', text: 'Match the number from the verification page. Approve only if you started this sign-in.', number: '58', approve: 'Approve', deny: 'Deny' },
    caption: 'The number you matched belongs to the attacker\'s own sign-in, so your approval opens their session.',
    effect: 'The attacker uses the approved session to read mail and look for further accounts.',
    targets: [['Verification page', 'window'], ['Administrator account', 'account'], ['Authenticator number', 'secret'], ['Mail and files', 'file']],
    fell: ['Your matched number approved their sign-in', ['At the message: a chat from an unknown "identity" team that asks for verification is a lure, so check the sender in the real directory.', 'At the sign-in page: a page that shows you a number to type is the attacker\'s page, so close it.', 'At the prompt: only match a number for a sign-in you started yourself, and otherwise deny and report.']],
    safe: ['You checked the sender and denied the prompt', ['The staff directory had no Identity Protection team.', 'The denial and the report let IT block the sending tenant before the session opened.']],
  };
})();
