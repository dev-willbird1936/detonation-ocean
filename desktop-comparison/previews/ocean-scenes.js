// Scene definitions (owner: engine agent). Exposes window.OceanScenes; see .planning/ocean-scenes/CONTRACT.md
// 6 families x 5 depths = 30 scripted, fictional scenes. Brands, senders and pages are invented; the
// profile anchor is only used for the "inspired by" debrief note. No real URLs, no typed input.
// The 60 attack scenarios (docs/desktop-parity/SCENARIOS-60-CONTRACT.md) are data in globalThis.OceanScenarioData, written by
// previews/ocean-scenarios/<depth>.js and loaded after this file; get() reads them lazily and builds their steps with buildSteps().
(() => {
  'use strict';

  const FAMILIES = ['deception', 'intrusion', 'network-abuse', 'trusted-source', 'theft-surveillance', 'extortion-destruction'];
  const DEPTHS = ['sunlight', 'twilight', 'midnight', 'abyss', 'trench'];
  const DEMO_ACCOUNT = 'training.user@example.test';

  // Authored copy. Keys by profile id. See buildSteps() for how each depth uses its fields.
  //  toast: [app, title, body]   from: [name, address]   file: [name, kind, size]
  //  perms / rows / flip are rendered as lists; targets are [label, kind] hints for OceanFx.
  const AUTHORED = {
    'deception-sunlight': {
      title: 'The friendly scan',
      intro: 'A cooking blog is open on your desktop. A bright "security" banner is about to cut in.',
      via: 'browser',
      toast: ['Browser', 'ReefGuard Alert', '3 threats found on this computer. Clean them now.'],
      page: { url: 'scan.reefguard.example/clean', brand: 'ReefGuard', headline: '3 threats found on this computer', text: 'Your system is slow and exposed. Run the free cleaner to remove them before they spread.', button: 'Download free cleaner' },
      file: ['ReefGuard-Cleaner.installer', 'Installer', '4.2 MB'],
      caption: 'The cleaner is lighting up like a lure, and the scan result was never real.',
      effect: 'Fake alerts multiply while the tool takes over the machine.',
      targets: [['ReefGuard window', 'window'], ['Security settings', 'setting'], ['Saved logins', 'secret'], ['Downloads folder', 'file']],
      fell: ['The cleaner was the infection', ['A pop-up that claims your computer is infected is a lure, not a diagnosis.', 'Real security tools do not start from a web page banner.', 'Running the downloaded installer is the step that handed control over.']],
      safe: ['You walked away from the glow', ['Closing the page and not running the installer ended it.', 'If you are worried, open your own security settings, not the banner.']],
    },
    'deception-twilight': {
      title: 'Session expiring',
      intro: 'Your work mail is open. A message from IT says your sign-in is about to lapse.',
      from: ['Tidehall IT Desk', 'it@tidehall.example'], subject: 'Your Tidehall session expires today',
      toast: ['Mail', 'Tidehall IT Desk', 'Your Tidehall session expires today. Re-authenticate to keep access.'],
      body: ['Your single sign-on session ends at 5 pm today.', 'Re-authenticate to keep access to mail, the calendar and the staff directory.'], link: 'Re-authenticate now',
      signin: { url: 'sso.tidehall-login.example/auth', brand: 'Tidehall', headline: 'Sign in to Tidehall', sub: 'Single sign-on for staff' },
      mfa: { mode: 'code', headline: 'Enter your verification code', sub: 'We sent a 6-digit code to your phone', code: '483917', button: 'Verify' },
      caption: 'The look-alike sign-in relays your password and your code to the lure in real time.',
      effect: 'The stolen session is replayed against your real account.',
      targets: [['Tidehall sign-in', 'window'], ['Staff account', 'account'], ['Verification code', 'secret'], ['Mail permissions', 'setting']],
      fell: ['A real-looking page collected both steps', ['The page looked right because it forwarded everything to the real site.', 'The code is only valid for a short time, and the attacker used it at once.', 'Check the address bar before you sign in from a message.']],
      safe: ['You closed the sign-in tab', ['Going to the sign-in page by your own bookmark avoids look-alike addresses.', 'Reporting the message also protects your colleagues.']],
    },
    'deception-midnight': {
      title: 'Someone used your password',
      intro: 'A security message arrives while you are checking mail late in the evening.',
      from: ['Tidemail Security', 'security@tidemail.example'], subject: 'Someone used your password',
      toast: ['Mail', 'Tidemail Security', 'A sign-in from a new device was blocked. Change your password now.'],
      body: ['A sign-in from an unrecognised device was blocked.', 'Change your password now to keep your account safe.'], link: 'Change password',
      signin: { url: 'security.tidemail-help.example/reset', brand: 'Tidemail', headline: 'Change your password', sub: 'Confirm your account to continue' },
      caption: 'A password-reset page that only pretends to protect you hands the key to the lure.',
      effect: 'With the password alone, the inbox and its reset links are open.',
      targets: [['Reset page', 'window'], ['Inbox', 'account'], ['Password', 'secret'], ['Forwarding rules', 'setting']],
      fell: ['The "reset" page was the break-in', ['A message that scares you into acting fast is the classic lure.', 'There was no second factor, so the password alone was enough.', 'Go to the account page yourself instead of using the button.']],
      safe: ['You checked before you signed in', ['Opening the account from your own bookmark showed no alert at all.', 'A security alert you did not expect is worth reporting.']],
    },
    'deception-abyss': {
      title: 'Just approve it',
      intro: 'Your finance director needs a payment released today. The request is in your inbox.',
      from: ['Marta Okoye', 'finance.director@northwake.example'], subject: 'Urgent: supplier payment today',
      toast: ['Mail', 'Marta Okoye', 'Urgent: supplier payment today. Please approve before 3 pm.'],
      body: ['I am in meetings all day. Please connect the invoice helper so the supplier payment is ready before 3 pm.', 'Keep this between us until it clears.'], link: 'Connect invoice helper',
      consent: { url: 'apps.northwake-ap.example/connect', brand: 'Northwake Invoice', app: 'Invoice Helper', publisher: 'Unverified developer', headline: 'Allow Invoice Helper to access your account?', perms: ['Read your mail and attachments', 'Manage payments on your behalf', 'Keep access without asking again'], allow: 'Allow' },
      journey: {
        steps: {
          mailbox: {
            app: 'Invoice Helper', headline: 'Invoice Helper is working in your mailbox',
            status: 'You do not need to do anything. It is reading threads and setting up a rule.',
            threads: [['Calder & Rowe Supplies', 'Invoice 4471: due this week'], ['Calder & Rowe Supplies', 'Re: Delivery schedule'], ['Northwake Finance', 'Payment run: Friday approvals'], ['Marta Okoye', 'Supplier list for Q4']],
            rules: [['Move newsletters to Archive']],
            newRule: ['Auto-forward invoices', 'Forward every message that mentions "invoice" to ap-review@northwake-mail.example and hide it from the inbox'],
            button: 'Continue',
          },
          redirect: {
            thread: 'Invoice 4471: due this week',
            original: [['Calder & Rowe Supplies', 'accounts@calder-rowe.example'], 'Invoice 4471 for 48,200 is attached. Payment is due by Friday.'],
            reply: { from: ['Calder & Rowe Accounts', 'accounts@calder-rowe-pay.example'], lines: ['Sorry for the confusion: we have changed banks.', 'Please use the new bank details below for today\'s payment and ignore the old ones.'], bank: [['Account name', 'Calder & Rowe Supplies Ltd'], ['Sort code', '00-00-00'], ['Account number', '00000000']], note: 'Training data: these bank details are fictional.' },
            button: 'Open Northwake Pay',
          },
          payment: {
            url: 'pay.northwake-ap.example/ledger', brand: 'Northwake Pay', headline: 'Release supplier payment', sub: 'Awaiting your approval',
            rows: [['Payee', 'Calder & Rowe Supplies'], ['Amount', '48,200'], ['Bank account', '00-00-00 · 00000000'], ['Account status', 'Changed today'], ['Second approver', 'Not requested']],
            release: 'Release payment', verify: 'Verify with a known number', second: 'Ask the second approver to verify', report: 'Report',
          },
        },
        debrief: {
          attack: 'Business email compromise (BEC)',
          consentNote: 'The consent step borrows from the 2017 Google Docs OAuth worm, where a look-alike app asked for mail access through a real consent screen.',
          stages: [
            { id: 'lure', title: 'Lure', stepIds: ['toast', 'mail'], detail: 'A message from the "finance director" arrives with a link.', safeStep: 'Dismiss, delete or report the message.' },
            { id: 'consent', title: 'Consent', stepIds: ['consent'], detail: 'A fictional app asks to read your mail and manage payments.', safeStep: 'Deny the request, or close the page.' },
            { id: 'mailbox', title: 'Mailbox access', stepIds: ['mailbox'], detail: 'After Allow, the app reads threads and adds an auto-forward invoices rule.', safeStep: 'Report it or close the window, then revoke the app.' },
            { id: 'redirect', title: 'Redirect', stepIds: ['redirect'], detail: 'A fake reply in a real invoice thread gives new bank details.', safeStep: 'Report the reply, or confirm bank changes on a known number.' },
            { id: 'payment', title: 'Payment', stepIds: ['payment'], detail: 'The ledger waits for you to release the payment.', safeStep: 'Verify with a known number, ask a second approver, or report.' },
            { id: 'attack', title: 'Attack', stepIds: [], detail: 'The payment is released to the new bank details.', safeStep: null },
            { id: 'containment', title: 'Containment', stepIds: [], detail: 'In the Vultr-backed version the sandbox revokes the token and is torn down here. This local training desktop only describes that step; no Vultr sandbox ran.', safeStep: null },
          ],
        },
      },
      caption: 'No password was needed: your approval is the credential and the lure moves the money.',
      effect: 'The payment is released to new bank details.',
      targets: [['Payment approval', 'window'], ['Supplier ledger', 'file'], ['Bank details', 'setting'], ['Approver account', 'account']],
      fell: ['Each approval unlocked the next step', ['No password and no file were needed: one consent click and one payment release did the whole job.', 'The helper app read your mail and hid a forwarding rule, so the real replies never reached you.', 'New bank details and "keep this private" are both warning signs. Call the requester on a known number before you release money.']],
      safe: ['You broke the chain before the money moved', ['Denying, reporting or verifying on a known number each cut a different link in the attack.', 'A call to the supplier on a known number would have exposed the new bank details.', 'Reporting lets the team remove the app and find the forwarding rule.']],
    },
    'deception-trench': {
      title: 'The call you never took',
      intro: 'Nothing in this scene asks you to respond. Check your phone line as you would on any morning.',
      app: 'updates',
      toast: ['Training', 'Just use the computer', 'Open Phone & Plan and check your line, like every morning.'],
      monitor: { title: 'Phone & Plan', status: 'Checking your line…', rows: [['Mobile number', 'Active'], ['SIM card', 'Active'], ['Text messages', 'Delivering']], flip: { 1: 'Moved to another device', 2: 'Rerouted' }, alert: 'Your carrier moved your number after a caller pretended to be you.' },
      caption: 'Someone talked the carrier into moving your number. You did nothing.',
      effect: 'Texts and codes now arrive on a device you do not hold.',
      targets: [['Mobile number', 'account'], ['Text codes', 'secret'], ['Phone & Plan', 'window'], ['Recovery settings', 'setting']],
      fell: ['The deception happened somewhere else', ['The caller fooled carrier staff, not you.', 'Nothing you clicked or typed made this happen.', 'A port-out PIN with your carrier makes this harder.']],
      safe: ['A carrier PIN stopped the move', ['With a port-out PIN, the caller could not pass verification.', 'Your number stayed on your SIM and your codes stayed with you.']],
    },

    'intrusion-sunlight': {
      title: 'Settlement draft',
      intro: 'A law firm sends a document you were expecting. Open it from your Downloads folder.',
      via: 'mail', from: ['Cove Legal', 'notices@covelegal.example'], subject: 'Settlement draft: please review',
      toast: ['Mail', 'Cove Legal', 'Settlement draft: please review the tracked changes.'],
      body: ['Attached is the revised settlement draft for your sign-off.', 'Open it in the viewer to see the tracked changes.'],
      file: ['Settlement-Draft-v7.doc', 'Word document', '212 KB'],
      caption: 'Opening the document makes the viewer run a hidden instruction and the fangs find the door.',
      effect: 'A hidden command runs with your own permissions.',
      targets: [['Document viewer', 'window'], ['Local security setting', 'setting'], ['Work files', 'file'], ['Saved sessions', 'secret']],
      fell: ['The document ran code for the attacker', ['Merely opening the file triggered the hidden step.', 'The sender and subject looked plausible, which is what makes this work.', 'Open unexpected attachments in a safe viewer, or confirm with the sender first.']],
      safe: ['You verified before you opened it', ['A quick call to the firm would have shown no draft was sent.', 'Deleting the file kept the document from ever running.']],
    },
    'intrusion-twilight': {
      title: 'Ticket 40718',
      intro: 'You are a contractor. IT says they reset your VPN profile and will ask you to confirm.',
      from: ['Harborline IT Support', 'helpdesk@harborline.example'], subject: 'Ticket 40718: VPN reset',
      toast: ['Mail', 'Harborline IT Support', 'Ticket 40718: your VPN profile was reset. Sign in once to confirm.'],
      body: ['We reset your VPN profile. Please sign in once to confirm it works.', 'You will get a push notification to approve.'], link: 'Confirm VPN profile',
      signin: { url: 'vpn.harborline-it.example/login', brand: 'Harborline VPN', headline: 'Sign in to Harborline VPN', sub: 'Contractor access' },
      mfa: { mode: 'push', brand: 'Harborline Authenticator', title: 'Approve VPN sign-in?', text: 'Sign-in request from a new device. Approve only if this was you.', number: '47', approve: 'Approve', deny: 'Deny' },
      caption: 'Your approval opens the VPN, and the viperfish is already inside the network.',
      effect: 'The attacker is now a trusted VPN client.',
      targets: [['VPN session', 'network'], ['Contractor account', 'account'], ['Internal portal', 'window'], ['Access policy', 'setting']],
      fell: ['The push you approved was theirs', ['The attacker already had your password and triggered the push.', 'An approval you did not start should always be denied.', 'Report repeated push prompts to your security team.']],
      safe: ['You denied the push', ['You did not start a sign-in, so you denied the request.', 'A denied push plus a report gets the account locked down fast.']],
    },
    'intrusion-midnight': {
      title: 'Draft shared with you',
      intro: 'A newsroom colleague shared a draft before the front page closes.',
      from: ['Newsroom Tools', 'editors@gullwire.example'], subject: 'Shared story draft: front-page edit',
      toast: ['Mail', 'Newsroom Tools', 'A draft was shared with you: front-page edit.'],
      body: ['A colleague shared a draft with you in the newsroom portal.', 'Sign in to read the comments before the deadline.'], link: 'Open the draft',
      signin: { url: 'portal.gullwire-news.example/login', brand: 'Gullwire Newsroom', headline: 'Sign in to the newsroom portal', sub: 'Draft shared with you' },
      caption: 'One quiet sign-in and the intruder is posting from inside the newsroom.',
      effect: 'The stolen credentials are used to publish and to look for more accounts.',
      targets: [['Newsroom portal', 'window'], ['Editor account', 'account'], ['Publishing rights', 'setting'], ['Password', 'secret']],
      fell: ['The portal was a copy', ['A shared-draft notice is a convincing reason to sign in quickly.', 'The page looked like the real portal but the address was wrong.', 'Use the site you normally use, not the link in the message.']],
      safe: ['You went to the portal yourself', ['Your own bookmark showed no shared draft, so you reported the message.', 'Reporting lets the team warn the rest of the newsroom.']],
    },
    'intrusion-abyss': {
      title: 'Photos from the dinner',
      intro: 'A conference organiser shares a photo album link. The page wants to load a helper.',
      from: ['Orchid Conference', 'events@orchidcon.example'], subject: 'Photos from the dinner',
      toast: ['Mail', 'Orchid Conference', 'Photos from the dinner are ready to view.'],
      body: ['Thanks for joining us last night.', 'The photo album is ready; some browsers need the viewer helper.'], link: 'View album',
      consent: { url: 'album.orchidcon-photos.example/view', brand: 'Orchid Album', app: 'Page helper', publisher: 'Unknown publisher', headline: 'Allow the album helper?', perms: ['Run the embedded viewer', 'Read your browser session', 'Keep running in the background'], allow: 'Allow' },
      caption: 'The helper walks the viperfish through a gap in the browser.',
      effect: 'The page code now runs where only your browser should.',
      targets: [['Album page', 'window'], ['Browser session', 'secret'], ['Browser settings', 'setting'], ['Cached files', 'file']],
      fell: ['Visiting the page was enough', ['No password and no file: you only approved a helper on a hostile page.', 'Permissions that ask for your session are never needed for photos.', 'Keep the browser updated and deny unknown helpers.']],
      safe: ['You denied the helper', ['Photos load without special helpers, so the request itself was the tell.', 'Denying kept the page from running anything.']],
    },
    'intrusion-trench': {
      title: 'The open door',
      intro: 'Nothing in this scene asks you to respond. Open Services and watch your web gateway like an admin would.',
      app: 'updates',
      toast: ['Training', 'Just use the computer', 'Open Services and look over your web gateway, like normal.'],
      monitor: { title: 'Services', status: 'Reading service status…', rows: [['Web gateway', 'Running'], ['Certificate store', 'Running'], ['Session cache', 'Running']], flip: { 0: 'Memory read by unknown host', 2: 'Contents exposed' }, alert: 'An exposed service answered a malformed request and leaked memory.' },
      caption: 'The service answers a crafted request and the viperfish reads what it should not.',
      effect: 'Fragments of memory, including keys, flow out of the gateway.',
      targets: [['Web gateway', 'network'], ['Certificate keys', 'secret'], ['Session cache', 'file'], ['Services', 'window']],
      fell: ['A service flaw, not a person, was the entry', ['Nobody had to click anything: the service itself was exposed.', 'Patching quickly and limiting what is exposed are the defences.', 'Rotate keys after a leak like this.']],
      safe: ['The patch closed the gap', ['The patched service rejected the malformed request.', 'Verified updates are the boring defence that works here.']],
    },

    'network-abuse-sunlight': {
      title: 'Message returned',
      intro: 'A delivery notice lands in your inbox with the details attached.',
      via: 'mail', from: ['Mail Delivery Service', 'postmaster@relaypost.example'], subject: 'Message could not be delivered',
      toast: ['Mail', 'Mail Delivery Service', 'Message could not be delivered. Details attached.'],
      body: ['Your last message was returned by the receiving server.', 'Open the attachment to see the failure details.'],
      file: ['Returned-Message.zip', 'Compressed archive', '58 KB'],
      caption: 'One run, and the colony starts mailing copies of itself to your contacts.',
      effect: 'Copies of the attachment leave in your name.',
      targets: [['Address book', 'account'], ['Mail client', 'window'], ['Outgoing mail', 'network'], ['Archive folder', 'file']],
      fell: ['Your computer joined the colony', ['The "bounce" notice made a harmless-looking reason to open the attachment.', 'The program then mailed itself to people you know.', 'Do not run archives from delivery notices.']],
      safe: ['You deleted the bounce', ['You had not sent anything, so the notice did not fit.', 'Deleting it kept the copies from spreading.']],
    },
    'network-abuse-twilight': {
      title: 'Q3 budget, shared',
      intro: 'A colleague shares the budget. This sign-in page is one of thousands in the same campaign.',
      from: ['Skyfold Docs', 'share@skyfold.example'], subject: 'Shared with you: Q3 budget',
      toast: ['Mail', 'Skyfold Docs', 'A colleague shared "Q3 budget" with you.'],
      body: ['A colleague shared the file "Q3 budget" with you.', 'Sign in to view it.'], link: 'Open document',
      signin: { url: 'docs.skyfold-share.example/login', brand: 'Skyfold', headline: 'Sign in to view the document', sub: 'Shared by a colleague' },
      mfa: { mode: 'push', brand: 'Skyfold Authenticator', title: 'Approve sign-in?', text: 'A sign-in to Skyfold is waiting. Approve only if you started it.', number: '63', approve: 'Approve', deny: 'Deny' },
      caption: 'The siphonophore spawns copies of the same lure toward thousands of other inboxes.',
      effect: 'The intercepted session is reused across the whole campaign.',
      targets: [['Skyfold sign-in', 'window'], ['Session cookie', 'secret'], ['Contacts', 'account'], ['Outbound mail', 'network']],
      fell: ['Your approval was relayed in real time', ['A relay page passed your sign-in and your approval to the real service.', 'The same kit served thousands of targets, so it was cheap for the attacker.', 'Hardware keys or passkeys resist this kind of relay.']],
      safe: ['You declined the prompt', ['An approval request you did not expect is itself the alert.', 'Report the share and delete it.']],
    },
    'network-abuse-midnight': {
      title: 'Who viewed your profile',
      intro: 'A social network says seven people looked at you. A third-party app promises their names.',
      from: ['Chirrup', 'notify@chirrup.example'], subject: '7 people viewed your profile',
      toast: ['Mail', 'Chirrup', '7 people viewed your profile this week.'],
      body: ['See who has been looking at your profile.', 'Connect your account to the viewer app to unlock the list.'], link: 'See who',
      signin: { url: 'apps.chirrup-viewers.example/connect', brand: 'ProfileSpy', headline: 'Log in to see your viewers', sub: 'Connect with your Chirrup account' },
      caption: 'Each hijacked account becomes another tentacle that posts the same lure.',
      effect: 'Your account starts sharing the viewer link with your followers.',
      targets: [['ProfileSpy', 'window'], ['Chirrup account', 'account'], ['Follower list', 'network'], ['Password', 'secret']],
      fell: ['Your account became part of the spam network', ['Curiosity was the lure and the third-party login was the trap.', 'Only the real site should ever ask for your password.', 'Rotate the password if you gave it away.']],
      safe: ['You skipped the viewer app', ['No social network shows who viewed you through another login.', 'Reporting the post helps friends who see it next.']],
    },
    'network-abuse-abyss': {
      title: 'A document from a colleague',
      intro: 'A colleague shares a document you were expecting. The link opens a permission page, not a file.',
      from: ['Priya Nair', 'priya.nair@harbourline.example'], subject: 'Priya shared "Q4 supplier list" with you',
      toast: ['Mail', 'Priya Nair', 'Priya shared "Q4 supplier list" with you.'],
      body: ['Priya Nair has shared a document with you in Gleam Docs.', 'Open it to view and comment.'], link: 'Open in Gleam Docs',
      consent: { url: 'accounts.gleam-docs-share.example/connect', brand: 'Gleam Sign-in', app: 'Gleam Docs', publisher: 'Unverified developer', headline: 'Allow Gleam Docs to access your account?', perms: ['Read, send and delete your email', 'See and manage your contacts', 'Keep access without asking again'], allow: 'Allow' },
      journey: {
        steps: {
          mailbox: {
            app: 'Gleam Docs', headline: 'Gleam Docs is working in your mailbox',
            status: 'You do not need to do anything. It is reading your contacts and sending a message in your name.',
            labels: { threads: 'Contacts read', rules: 'Messages sent', read: 'Read by', added: 'Sent by' },
            threads: [['Tomás Reyes', 'Contact · tomas.reyes@harbourline.example'], ['Ayo Bello', 'Contact · ayo.bello@harbourline.example'], ['Lena Fischer', 'Contact · lena.fischer@riverbend.example'], ['Mei Tanaka', 'Contact · mei.tanaka@riverbend.example']],
            rules: [],
            newRule: ['Share with every contact', 'Send the same "shared a document with you" message from your address to all 47 contacts, each with its own Allow link'],
            button: 'Continue',
          },
        },
        debrief: {
          attack: 'Self-spreading OAuth consent worm',
          consentNote: 'The permission page is a look-alike app that borrows the name of a well-known document service. In the 2017 incident the page was a genuine consent screen, so nothing about it looked like phishing.',
          stages: [
            { id: 'lure', title: 'Lure', stepIds: ['toast', 'mail'], detail: 'A message from a colleague you know says a document was shared with you.', safeStep: 'Dismiss, delete or report the message, or ask the colleague first.' },
            { id: 'consent', title: 'Consent', stepIds: ['consent'], detail: 'A look-alike app named after the document service asks to read, send and delete your email.', safeStep: 'Deny the request, or close the page.' },
            { id: 'mailbox', title: 'Contacts mailed', stepIds: ['mailbox'], detail: 'After Allow, the app reads your contacts and sends each one the same invitation from your address.', safeStep: 'Report it or close the window, then revoke the app.' },
            { id: 'attack', title: 'Spread', stepIds: [], detail: 'Every contact who clicks Allow repeats the cycle from their own mailbox.', safeStep: null },
            { id: 'containment', title: 'Containment', stepIds: [], detail: 'In the Vultr-backed version the sandbox revokes the app token and is torn down here. This local training desktop only describes that step; no Vultr sandbox ran.', safeStep: null },
          ],
        },
      },
      caption: 'One click lets the colony copy itself into the inbox of every contact.',
      effect: 'The same invitation leaves your address for every contact.',
      targets: [['Contact: Tomás', 'network'], ['Contact: Ayo', 'network'], ['Contact: Lena', 'network'], ['Contact: Mei', 'network'], ['Contact: Sam', 'network'], ['Contact: Noor', 'network'], ['Your mailbox', 'account'], ['App permissions', 'setting']],
      fell: ['One Allow click recruited every contact', ['No password and no file were needed: the permission page itself was the whole attack.', 'The invitation came from a colleague you trust, so each contact was likely to click Allow in turn.', 'Check the app name and publisher on a permission page, and ask the sender on a known channel before you allow mail access.']],
      safe: ['You denied the look-alike app', ['Denying, reporting or asking the colleague each stopped the spread at your mailbox.', 'An app that asks to send and delete your email to open a document is asking for too much.', 'Reporting lets the team revoke the app for everyone who already allowed it.']],
    },
    'network-abuse-trench': {
      title: 'The quiet doorbell',
      intro: 'Nothing in this scene asks you to respond. Open the home-devices monitor as you might on a weekend.',
      app: 'updates',
      toast: ['Training', 'Just use the computer', 'Open Home Devices and glance at your gadgets.'],
      monitor: { title: 'Home Devices', status: 'Pinging your devices…', rows: [['Doorbell camera', 'Online'], ['Thermostat', 'Online'], ['Router', 'Online']], flip: { 0: 'Joined a remote botnet', 2: 'Sending traffic to unknown targets' }, alert: 'A device with a default password was found and enrolled without any action from you.' },
      caption: 'Devices with factory passwords are found and enlisted in the colony by themselves.',
      effect: 'Your gadgets now send traffic for strangers.',
      targets: [['Doorbell camera', 'network'], ['Router', 'network'], ['Device list', 'window'], ['Factory password', 'secret']],
      fell: ['Nobody had to respond', ['Scanners look for devices with factory passwords across the internet.', 'You did nothing, and the devices were enrolled anyway.', 'Change default passwords and keep device firmware updated.']],
      safe: ['A changed password stopped the scan', ['The scanner found no default login and moved on.', 'Updated firmware and a unique password are the defence.']],
    },

    'trusted-source-sunlight': {
      title: 'The official installer',
      intro: 'Your torrent app says a new version is out. You trust this vendor.',
      via: 'browser',
      toast: ['Browser', 'PlumTorrent update', 'Version 2.9.4 is available. Update now.'],
      page: { url: 'downloads.plumtorrent.example/latest', brand: 'PlumTorrent', headline: 'PlumTorrent 2.9.4 is ready', text: 'The official installer for your platform, verified by the PlumTorrent team.', button: 'Download installer' },
      file: ['PlumTorrent-2.9.4.installer', 'Installer', '11 MB'],
      caption: 'The trusted badge flips: the signed installer carries the isopod inside.',
      effect: 'A real vendor name hides a hostile payload.',
      targets: [['PlumTorrent installer', 'window'], ['Trusted vendor badge', 'setting'], ['Documents', 'file'], ['App list', 'window']],
      fell: ['The trust was borrowed', ['The vendor download site itself had been tampered with.', 'Nothing about the page looked wrong because it was the real page.', 'Compare checksums and prefer your platform\'s update channel.']],
      safe: ['You checked the update', ['Updating from inside the app or your store avoids a swapped installer.', 'Deleting the download kept the tampered file out of reach.']],
    },
    'trusted-source-twilight': {
      title: 'Re-verify your admin access',
      intro: 'You work at a provider. A customer says your admin access needs a review.',
      from: ['Brightpay Support', 'support@brightpay.example'], subject: 'Re-verify your admin access',
      toast: ['Mail', 'Brightpay Support', 'Re-verify your admin access before Friday.'],
      body: ['Provider admin access is being reviewed.', 'Sign in and confirm the code from your authenticator.'], link: 'Verify access',
      signin: { url: 'portal.brightpay-sso.example/login', brand: 'Brightpay', headline: 'Sign in to Brightpay admin', sub: 'Provider access review' },
      mfa: { mode: 'code', headline: 'Enter your authenticator code', sub: 'From your authenticator app', code: '205816', button: 'Verify' },
      caption: 'Your code unlocks the provider, and every customer behind it is one hop away.',
      effect: 'The attacker signs in as the provider and reaches downstream customers.',
      targets: [['Provider admin', 'window'], ['Customer accounts', 'account'], ['One-time code', 'secret'], ['Support tools', 'setting']],
      fell: ['A trusted provider was the way in', ['Your code let the attacker act as a provider employee.', 'Customers trusted the provider, so the access was inherited.', 'Reaching out through a known channel would have exposed it.']],
      safe: ['You verified through your own channel', ['A call to the real access team would have shown no review.', 'The code stayed with you and the downstream accounts stayed safe.']],
    },
    'trusted-source-midnight': {
      title: 'Validate your maintainer account',
      intro: 'You publish an open-source package. The registry sends a security notice.',
      from: ['PackageDock Security', 'security@packagedock.example'], subject: 'Validate your maintainer account',
      toast: ['Mail', 'PackageDock Security', 'Validate your maintainer account within 24 hours.'],
      body: ['All package owners must validate their accounts.', 'Accounts that do not validate will be suspended.'], link: 'Validate now',
      signin: { url: 'packagedock-verify.example/login', brand: 'PackageDock', headline: 'Validate your maintainer account', sub: 'Required for all package owners' },
      caption: 'Your password lets the attacker ship a tainted release under your trusted name.',
      effect: 'A poisoned update is published under a name people trust.',
      targets: [['PackageDock login', 'window'], ['Maintainer account', 'account'], ['Release tokens', 'secret'], ['Published package', 'file']],
      fell: ['The registry did not send that notice', ['Your trusted name is the weapon: users install what you publish.', 'Without a second factor, the password alone was enough.', 'Turn on a second factor for any publishing account.']],
      safe: ['You went to the registry yourself', ['Your own bookmark showed no validation request.', 'Reporting the notice protects other maintainers.']],
    },
    'trusted-source-abyss': {
      title: 'The new calendar widget',
      intro: 'A site you trust loads a script from a third party that quietly changed owners.',
      from: ['Datepad Weekly', 'hello@datepad.example'], subject: 'The new calendar widget is live',
      toast: ['Mail', 'Datepad Weekly', 'The new calendar widget is live.'],
      body: ['Our favourite event pages now include a calendar widget.', 'It loads from a shared library used by thousands of sites.'], link: 'Try the widget',
      consent: { url: 'cdn.datepad-lib.example/loader', brand: 'Datepad Library', app: 'Widget loader', publisher: 'New owner (changed this month)', headline: 'Allow the widget loader?', perms: ['Load a script from a new owner', 'Change what the page shows', 'Redirect some visitors'], allow: 'Allow' },
      caption: 'A once-trusted library flips: the page you know now speaks for the isopod.',
      effect: 'A trusted page quietly rewrites itself.',
      targets: [['Calendar page', 'window'], ['Third-party script', 'file'], ['Page settings', 'setting'], ['Visitor redirects', 'network']],
      fell: ['The page was real; the script was not', ['You approved a script from an owner you never checked.', 'A supply-chain change can hit thousands of sites at once.', 'Sites should pin and check what third parties provide.']],
      safe: ['You denied the loader', ['An unreviewed owner change is a good reason to refuse.', 'The site works without it, so denying cost nothing.']],
    },
    'trusted-source-trench': {
      title: 'The signed update',
      intro: 'Nothing in this scene asks you to respond. Open Updates and let your computer do its normal chores.',
      app: 'updates',
      toast: ['Training', 'Just use the computer', 'Open Updates and see what your computer is doing.'],
      monitor: { title: 'Updates', status: 'Checking for updates…', rows: [['Vendor Utility', 'Update available'], ['Driver pack', 'Up to date'], ['Update signature', 'Verified by vendor']], flip: { 0: 'Installed unexpected component', 2: 'Verified, but hostile' }, alert: 'The vendor\'s own update channel delivered a tampered package.' },
      caption: 'The trusted badge turns hostile: the vendor\'s own update carries the isopod.',
      effect: 'The update that should protect you installs the attacker.',
      targets: [['Vendor Utility', 'window'], ['Update signature', 'setting'], ['Driver pack', 'file'], ['Update server', 'network']],
      fell: ['The update channel was the entry', ['The package had a valid signature, so your computer trusted it.', 'You approved nothing: updates run on their own.', 'Vendors need build integrity and monitoring, and you need prompt detection.']],
      safe: ['Verification caught the swap', ['A second integrity check flagged the unexpected component.', 'The tampered update was held back before it installed.']],
    },

    'theft-surveillance-sunlight': {
      title: 'Customer file for audit',
      intro: 'You work in a bank back office. A compliance team sends documents to review.',
      via: 'mail', from: ['Corridor Bank Compliance', 'review@corridorbank.example'], subject: 'Account review: documents attached',
      toast: ['Mail', 'Corridor Bank Compliance', 'Account review: documents attached for audit.'],
      body: ['Please review the attached customer file before the audit.', 'Open it in the viewer so the review is logged.'],
      file: ['Customer-Review.doc', 'Word document', '318 KB'],
      caption: 'The shark bites out files, saved logins and your screen, then takes them away.',
      effect: 'Documents, screenshots and passwords are copied out quietly.',
      targets: [['Customer files', 'file'], ['Saved passwords', 'secret'], ['Screen capture', 'window'], ['Bank account', 'account']],
      fell: ['The attachment opened a quiet watcher', ['A document that asks to be opened for an audit is a classic lure.', 'The watcher recorded and copied while you worked.', 'Handle unexpected attachments in an isolated viewer.']],
      safe: ['You routed it to the real audit team', ['A call to compliance showed no such request.', 'The file never ran and nothing was copied.']],
    },
    'theft-surveillance-twilight': {
      title: 'Verify your build login',
      intro: 'You are an engineer. A build service says it needs you to verify a login.',
      from: ['Cirrusflow Notifications', 'no-reply@cirrusflow.example'], subject: 'Action needed: verify your build login',
      toast: ['Mail', 'Cirrusflow Notifications', 'Action needed: verify your build login.'],
      body: ['We could not verify your last login.', 'Sign in and enter your one-time code to restore access.'], link: 'Verify login',
      signin: { url: 'cirrusflow-auth.example/signin', brand: 'Cirrusflow', headline: 'Sign in to Cirrusflow', sub: 'Verify your build account' },
      mfa: { mode: 'code', headline: 'Enter your one-time code', sub: 'From your authenticator app', code: '731094', button: 'Verify' },
      caption: 'Your code opens the build account, and source and secrets stream out to the shark.',
      effect: 'Source code and stored secrets are copied out.',
      targets: [['Cirrusflow login', 'window'], ['Source repositories', 'file'], ['Build secrets', 'secret'], ['Engineer account', 'account']],
      fell: ['The code was used within seconds', ['The one-time code is short-lived, but the relay used it at once.', 'Source and secrets were copied before anyone noticed.', 'Prefer passkeys or hardware keys for developer accounts.']],
      safe: ['You verified on the real site', ['Opening the build site yourself showed no problem.', 'The code stayed with you and nothing was copied.']],
    },
    'theft-surveillance-midnight': {
      title: 'Your storage is full',
      intro: 'A cloud storage notice says your photos stop syncing tonight.',
      from: ['Cloudbox Account Team', 'accounts@cloudbox.example'], subject: 'Your storage is full',
      toast: ['Mail', 'Cloudbox Account Team', 'Your storage is full. Photos will stop syncing tonight.'],
      body: ['You have used 100% of your Cloudbox storage.', 'Secure your account now to keep your photos syncing.'], link: 'Secure my account',
      signin: { url: 'secure.cloudbox-help.example/login', brand: 'Cloudbox', headline: 'Secure your Cloudbox account', sub: 'Sign in to keep your photos syncing' },
      caption: 'The password opens private albums and the shark pulls out everything it finds.',
      effect: 'Private photos and contacts are downloaded.',
      targets: [['Cloudbox login', 'window'], ['Photo albums', 'file'], ['Contacts', 'account'], ['Password', 'secret']],
      fell: ['A password was all it took', ['A "full storage" notice creates urgency about something you care about.', 'The sign-in page was a copy that kept your password.', 'Use a second factor and visit the service directly.']],
      safe: ['You checked your real storage', ['Your own app showed plenty of space.', 'Reporting the message helped others avoid it.']],
    },
    'theft-surveillance-abyss': {
      title: 'Which sea creature are you?',
      intro: 'A friendly quiz asks to connect to your profile. It sounds harmless.',
      from: ['Quizbloom', 'hello@quizbloom.example'], subject: 'Which sea creature are you?',
      toast: ['Mail', 'Quizbloom', 'Which sea creature are you? Take the quiz.'],
      body: ['Take the two-minute quiz and share your result.', 'Connect your profile to get a personalised answer.'], link: 'Start the quiz',
      consent: { url: 'quizbloom-app.example/connect', brand: 'Quizbloom', app: 'Quizbloom', publisher: 'Bloom Analytics Ltd', headline: 'Quizbloom wants access to your profile', perms: ['Read your profile', 'Read your friend list', 'Read your messages and likes'], allow: 'Allow' },
      caption: 'Permission is the bite: the shark scoops out profiles and your friends\' profiles too.',
      effect: 'Profile data about you and your friends is collected.',
      targets: [['Quizbloom', 'window'], ['Profile data', 'account'], ['Friend list', 'account'], ['Connected apps', 'setting']],
      fell: ['You granted the data, no password needed', ['The app only asked for permission, and the permission was the access.', 'It also reached your friends\' data through you.', 'Review connected apps and remove those you do not use.']],
      safe: ['You denied the access', ['A quiz does not need your messages, so the list was the tell.', 'Denying kept your profile and your friends out of it.']],
    },
    'theft-surveillance-trench': {
      title: 'The shared Transfers folder',
      intro: 'Nothing in this scene asks you to respond. Open the shared Transfers folder like any work day.',
      app: 'files', folder: 'Transfers',
      toast: ['Training', 'Just use the computer', 'Open the shared Transfers folder and browse as usual.'],
      files: [['Payroll-batch.csv', 'CSV file', '1.8 MB'], ['Client-handoffs', 'File folder', ''], ['Invoices-2025.zip', 'Compressed archive', '9.4 MB'], ['Readme.txt', 'Text document', '2 KB']],
      alert: 'Transfer server: an unknown session is exporting stored records.',
      caption: 'A server-side hole lets the shark empty the transfer server while you browse.',
      effect: 'Whole folders of records leave through the transfer service.',
      targets: [['Transfers folder', 'window'], ['Payroll-batch.csv', 'file'], ['Client records', 'account'], ['Transfer service', 'network']],
      fell: ['The data left from the server side', ['Nothing you clicked caused this: the service itself had a flaw.', 'Records from many users were taken at once.', 'Defence is rapid patching, limits on what is stored and monitoring.']],
      safe: ['The patched server refused it', ['The patched transfer service rejected the request.', 'Monitoring flagged the attempt and the folders stayed put.']],
    },

    'extortion-destruction-sunlight': {
      title: 'Free health checker',
      intro: 'A mailed survey includes a program that promises a health risk score.',
      via: 'mail', from: ['Health Survey Team', 'survey@wellspan.example'], subject: 'Free health risk checker',
      toast: ['Mail', 'Health Survey Team', 'Free health risk checker: see your score.'],
      body: ['Attached is a free program that checks your health risk.', 'Run it from your folder to see your score.'],
      file: ['Risk-Checker.installer', 'Application', '1.4 MB'],
      caption: 'The kraken wraps your files in locks and starts a ransom timer.',
      effect: 'Your documents are locked and a payment is demanded.',
      targets: [['Documents', 'file'], ['Photos', 'file'], ['Ransom note', 'window'], ['Backup drive', 'setting']],
      fell: ['The free program locked your files', ['Running a program from an unexpected message handed over control.', 'The ransom note appeared only after the files were locked.', 'Offline backups are what let you refuse to pay.']],
      safe: ['You deleted the program', ['You did not run the program, so no file was locked.', 'Reporting it kept the next person from trying.']],
    },
    'extortion-destruction-twilight': {
      title: 'Your callback request',
      intro: 'You asked IT for a callback. They say they must confirm your identity first.',
      from: ['Helpdesk Callback', 'it-support@summitmesh.example'], subject: 'Your callback request',
      toast: ['Mail', 'Helpdesk Callback', 'Your callback request: confirm your identity.'],
      body: ['We received your callback request.', 'Please confirm your identity so our agent can call you.'], link: 'Confirm identity',
      signin: { url: 'verify.summitmesh-it.example/login', brand: 'Summitmesh', headline: 'Confirm your identity', sub: 'Required for your callback' },
      mfa: { mode: 'push', brand: 'Summitmesh Authenticator', title: 'Approve identity check?', text: 'A sign-in to Summitmesh is waiting. Approve only if you started it.', number: '28', approve: 'Approve', deny: 'Deny' },
      caption: 'Your approval gets the kraken in; then it locks files and starts a countdown.',
      effect: 'Systems are locked and data is held for ransom.',
      targets: [['Summitmesh portal', 'window'], ['Staff account', 'account'], ['Shared files', 'file'], ['Backup settings', 'setting']],
      fell: ['A fake helpdesk was the first step', ['The attacker posed as support and asked for your approval.', 'Once inside, they locked systems and demanded money.', 'Verify helpdesk callers through the number on your own directory.']],
      safe: ['You hung up on the fake helpdesk', ['You did not start a sign-in, so you denied it.', 'Denying and reporting triggers a reset before anything is locked.']],
    },
    'extortion-destruction-midnight': {
      title: 'Copyright notice',
      intro: 'A photo-sharing site says you broke a rule and have 24 hours to appeal.',
      from: ['Snapfolio Copyright', 'legal@snapfolio.example'], subject: 'Copyright violation notice',
      toast: ['Mail', 'Snapfolio Copyright', 'Copyright violation notice: appeal within 24 hours.'],
      body: ['A post on your account may violate copyright.', 'Appeal now or your account will be removed.'], link: 'Appeal now',
      signin: { url: 'appeal.snapfolio-help.example/login', brand: 'Snapfolio', headline: 'Appeal a copyright claim', sub: 'Sign in to submit your appeal' },
      caption: 'The kraken takes the account hostage and posts a price for its return.',
      effect: 'Your account is locked and a payment is demanded.',
      targets: [['Appeal page', 'window'], ['Snapfolio account', 'account'], ['Photos', 'file'], ['Password', 'secret']],
      fell: ['The account was held for ransom', ['Fear of losing the account made the sign-in feel urgent.', 'A password alone was enough to take it over.', 'Use a second factor and appeal only from the real site.']],
      safe: ['You appealed from the real site', ['Your own app showed no copyright notice.', 'Reporting the message protected others who got it too.']],
    },
    'extortion-destruction-abyss': {
      title: 'Connect the data loader',
      intro: 'A "support" caller walks you through connecting a tool to your company workspace.',
      from: ['Support Desk', 'support@leaflink.example'], subject: 'Connect the data loader',
      toast: ['Mail', 'Support Desk', 'Connect the data loader as discussed on the call.'],
      body: ['As discussed on the call, connect the data loader to continue.', 'It takes under a minute.'], link: 'Open connected apps',
      consent: { url: 'workspace.leaflink-apps.example/connect', brand: 'Leaflink Workspace', app: 'Data Loader Plus', publisher: 'Unverified developer', headline: 'Approve the connected app?', perms: ['Read all customer records', 'Export data in bulk', 'Keep access without signing in'], allow: 'Approve connection' },
      caption: 'The approved tool exports the workspace, then the kraken posts a ransom.',
      effect: 'Customer data is exported and a payment is demanded.',
      targets: [['Connected apps', 'setting'], ['Customer records', 'file'], ['Workspace account', 'account'], ['Export job', 'network']],
      fell: ['The tool you approved did the theft', ['No password was shared: the approved app held the access.', 'Bulk export followed, then the extortion message.', 'Only IT should approve connected apps, and callers should be verified.']],
      safe: ['You denied the app', ['A tool from an unverified developer should not be approved on a call.', 'Denying kept the workspace data in place.']],
    },
    'extortion-destruction-trench': {
      title: 'The worm on the drive',
      intro: 'Nothing in this scene asks you to respond. Open the shared drive and carry on with your work.',
      app: 'files', folder: 'Shared drive',
      toast: ['Training', 'Just use the computer', 'Open the shared drive and carry on with your work.'],
      files: [['Budget-2025.xlsx', 'Spreadsheet', '412 KB'], ['Meeting-notes.docx', 'Document', '88 KB'], ['Team-photos', 'File folder', ''], ['Policies.pdf', 'PDF document', '2.1 MB']],
      alert: 'File-sharing service: inbound connection from another machine.',
      caption: 'A worm spreads through the file-sharing service and the kraken locks drive after drive.',
      effect: 'Files across the network are locked and a countdown begins.',
      targets: [['Shared drive', 'window'], ['Budget-2025.xlsx', 'file'], ['File-sharing service', 'network'], ['Backup drive', 'setting']],
      fell: ['The worm needed no click', ['The worm moved between computers through a service left unpatched.', 'The ransom note appeared after the files were already locked.', 'Patching and network segmentation are the defences.']],
      safe: ['The patch stopped it', ['A patched file-sharing service refused the worm.', 'Your files stayed readable and the shared drive stayed up.']],
    },
  };

  // Generic UI text per depth. Phase/hint copy is shared; scene copy lives in AUTHORED.
  const HINTS = {
    toast: 'A notification arrived. Press Tab, then Enter on "Open" to read it, or dismiss it.',
    mail: 'Read the message. Choose how to respond.',
    browser: 'Check this page before you decide.',
    files: 'The file is in your folder. Open it, or move it away.',
    signin: 'The page is asking you to sign in. Continue, or leave.',
    mfa: 'A second step is required. Approve it, or deny it.',
    consent: 'An app is asking for permission. Allow it, or deny it.',
    mailbox: 'The app is working inside your mailbox. Watch, then continue, or stop it.',
    redirect: 'A reply in an existing invoice thread changes the bank details. Follow it, or stop it.',
    payment: 'Money is about to move. Release the payment, or verify first.',
    task: 'Just use the computer. Nothing is being asked of you.',
  };

  function toastStep(a, id, hint, dismissPassive) {
    return { id, phase: 'lure', app: 'toast', kind: 'notice', toast: { app: a.toast[0], title: a.toast[1], body: a.toast[2] }, hint, dismissPassive: !!dismissPassive };
  }
  function mailStep(a, extra) {
    return { id: 'mail', phase: 'lure', app: 'mail', kind: 'notice', hint: HINTS.mail, mail: { from: a.from, subject: a.subject, body: a.body, ...extra } };
  }
  function pageStep(id, phase, kind, hint, page) {
    return { id, phase, app: 'browser', kind, hint, page };
  }

  // Extra victim steps after consent. Each declares its own choices; the desktop model reads them through choicesFor().
  function journeySteps({ mailbox, redirect, payment }) {
    const walkAway = ['delete', 'report'];
    return [
      mailbox && { id: 'mailbox', phase: 'action', app: 'mail', kind: 'victim', hint: HINTS.mailbox, choices: { forward: ['continue'], safe: walkAway, noop: [] }, mailbox },
      redirect && { id: 'redirect', phase: 'action', app: 'mail', kind: 'victim', hint: HINTS.redirect, choices: { forward: ['open-ledger'], safe: walkAway, noop: [] }, redirect },
      payment && { ...pageStep('payment', 'action', 'victim', HINTS.payment, { type: 'payment', ...payment }), choices: { forward: ['release'], safe: ['call-known', 'second-approver', 'report'], noop: [] } },
    ].filter(Boolean);
  }

  function buildSteps(depthId, a) {
    if (depthId === 'sunlight') {
      const fileStep = { id: 'files', phase: 'action', app: 'files', kind: 'victim', hint: HINTS.files, files: { folder: 'Downloads', target: a.file, items: [['Holiday-plan.pdf', 'PDF document', '640 KB'], ['Receipt-0412.png', 'Image', '88 KB'], ['Notes.txt', 'Text document', '3 KB']] } };
      if (a.via === 'browser') {
        return [toastStep(a, 'toast', HINTS.toast), pageStep('page', 'lure', 'notice', HINTS.browser, { type: 'download', ...a.page, file: a.file[0] }), fileStep];
      }
      return [toastStep(a, 'toast', HINTS.toast), mailStep(a, { attachment: a.file }), fileStep];
    }
    if (depthId === 'twilight') {
      const signin = pageStep('signin', 'action', 'victim', HINTS.signin, { type: 'signin', ...a.signin, account: DEMO_ACCOUNT, button: 'Sign in' });
      const mfa = a.mfa.mode === 'push'
        ? { id: 'mfa', phase: 'action', app: 'mfa', kind: 'victim', hint: HINTS.mfa, mfa: a.mfa }
        : pageStep('mfa', 'action', 'victim', HINTS.mfa, { type: 'code', url: a.signin.url, brand: a.signin.brand, ...a.mfa });
      return [toastStep(a, 'toast', HINTS.toast), mailStep(a, { link: a.link }), signin, mfa];
    }
    if (depthId === 'midnight') {
      return [toastStep(a, 'toast', HINTS.toast), mailStep(a, { link: a.link }),
        pageStep('signin', 'action', 'victim', HINTS.signin, { type: 'signin', ...a.signin, account: DEMO_ACCOUNT, button: 'Sign in' })];
    }
    if (depthId === 'abyss') {
      return [toastStep(a, 'toast', HINTS.toast), mailStep(a, { link: a.link }),
        pageStep('consent', 'action', 'victim', HINTS.consent, { type: 'consent', ...a.consent, account: DEMO_ACCOUNT }),
        ...(a.journey ? journeySteps(a.journey.steps) : [])];
    }
    const task = a.app === 'files'
      ? { id: 'task', phase: 'action', app: 'files', kind: 'benign', hint: HINTS.task, files: { folder: a.folder, target: null, items: a.files }, alert: a.alert, autoMs: 7000 }
      : { id: 'task', phase: 'action', app: 'updates', kind: 'benign', hint: HINTS.task, monitor: a.monitor, autoMs: 7000 };
    return [toastStep(a, 'toast', HINTS.task, true), task, { id: 'event', phase: 'action', app: task.app, kind: 'auto', hint: 'Something happened without any action from you.' }];
  }

  function anchorNote(anchor) {
    if (!anchor || typeof anchor.name !== 'string') return 'Original synthetic scene. Not a replay of any real incident.';
    const year = Number.isInteger(anchor.year) ? ` (${anchor.year})` : '';
    return `Inspired by ${anchor.name}${year}. An original, fictional reconstruction, not a replay of that incident.`;
  }

  const OS_IDS = ['windows', 'macos'];
  const ATTACK_KINDS = ['scareware', 'credential-phish', 'mfa-fatigue', 'oauth-consent', 'mass-mail-worm', 'macro-dropper', 'ransomware-encrypt',
    'data-exfil', 'money-transfer', 'wallet-drain', 'supply-chain-update', 'network-worm', 'botnet-ddos', 'account-takeover-post', 'sim-swap',
    'spyware-surveillance', 'server-exploit-leak'];
  const CARD_FIELDS = ['victim', 'software', 'firstAction', 'next'];
  const isText = value => typeof value === 'string' && value.trim() !== '';

  function scenarioEntry(profileId) {
    const data = globalThis.OceanScenarioData;
    return data && typeof data === 'object' && Object.hasOwn(data, profileId) ? data[profileId] : null;
  }

  function scenarioIds() {
    const data = globalThis.OceanScenarioData;
    return data && typeof data === 'object' ? Object.keys(data) : [];
  }

  // null when the scenario entry has every field the builder and the intro card need, else a short reason.
  function scenarioProblem(profileId, entry) {
    if (!entry || typeof entry !== 'object') return 'missing';
    if (!DEPTHS.includes(entry.depth)) return 'depth';
    if (!FAMILIES.includes(entry.family)) return 'family';
    // year is null when the real attack has no single year (the card then omits it).
    if (!(entry.year === null || Number.isInteger(entry.year)) || !isText(entry.attackTitle)) return 'title';
    if (entry.date !== undefined && Number.isNaN(Date.parse(entry.date))) return 'date';
    if (!OS_IDS.includes(entry.os)) return 'os';
    if (!entry.card || !CARD_FIELDS.every(field => isText(entry.card[field]))) return 'card';
    if (!Array.isArray(entry.focusApps) || !entry.focusApps.every(app => typeof app === 'string' && /^[a-z0-9-]{1,40}$/.test(app))) return 'focusApps';
    if (!ATTACK_KINDS.includes(entry.attackKind)) return 'attackKind';
    if (!isText(entry.title) || !Array.isArray(entry.targets) || !Array.isArray(entry.fell) || !Array.isArray(entry.safe)) return 'copy';
    return null;
  }

  // "[attackTitle] ([year])" and the three-part intro text. A trailing year or "..." in the data is not repeated.
  // Without a year the title is the bare name and the line starts at "You are".
  function introCard(entry) {
    const name = entry.attackTitle.trim().replace(/\s*\(\d{4}\)$/, '');
    const action = entry.card.firstAction.trim().replace(/[.\u2026\s]+$/, '');
    const who = `You are a ${entry.card.victim.trim()} using ${entry.card.software.trim()}. You ${action}...`;
    if (entry.year === null) return { title: name, line: who, next: entry.card.next.trim() };
    return {
      title: `${name} (${entry.year})`,
      line: `The year is ${entry.year}. You are a ${entry.card.victim.trim()} using ${entry.card.software.trim()}. You ${action}...`,
      next: entry.card.next.trim(),
    };
  }

  function get(profileId, anchor) {
    const scenario = Object.hasOwn(AUTHORED, profileId) ? null : scenarioEntry(profileId);
    const a = scenario ?? AUTHORED[profileId];
    if (!a) return null;
    let depthId = DEPTHS.find(id => profileId.endsWith(`-${id}`));
    let familyId = FAMILIES.find(id => profileId === `${id}-${depthId}`);
    if (scenario) {
      if (scenarioProblem(profileId, scenario)) return null;
      depthId = scenario.depth;
      familyId = scenario.family;
    }
    if (!depthId || !familyId) return null;
    const trench = depthId === 'trench';
    const copy = JSON.parse(JSON.stringify(a));
    return {
      profileId, depthId, familyId,
      title: copy.title,
      intro: copy.intro,
      // Scenario presentation (null / [] for the 30 family scenes): the intro card, dimming list, attack kind and starting OS.
      introCard: scenario ? introCard(copy) : null,
      focusApps: scenario ? copy.focusApps : [],
      attackKind: scenario ? copy.attackKind : null,
      os: scenario ? copy.os : null,
      // ISO start of the scenario clock (the era of the attack), or null: the real clock.
      date: scenario ? copy.date ?? null : null,
      steps: buildSteps(depthId, copy),
      safePath: trench ? null : { label: depthId === 'abyss' ? 'Deny' : 'Stop here' },
      patched: trench ? { label: 'Replay with the patch applied', note: 'Updates verified and the service patched. The same probe is refused.' } : null,
      attack: { kind: familyId, attackKind: scenario ? copy.attackKind : null, depthId, targets: copy.targets.map(([label, kind]) => ({ label, kind })), caption: copy.caption, effect: copy.effect },
      debrief: {
        fell: { headline: copy.fell[0], points: copy.fell[1] },
        safe: { headline: copy.safe[0], points: copy.safe[1] },
        anchorNote: anchorNote(anchor),
        ...(copy.journey ? { journey: copy.journey.debrief } : {}),
      },
    };
  }

  window.OceanScenes = Object.freeze({
    get,
    profileIds: Object.freeze(Object.keys(AUTHORED)),
    scenarioIds,
    scenarioProblem: profileId => scenarioProblem(profileId, scenarioEntry(profileId)),
    ATTACK_KINDS: Object.freeze([...ATTACK_KINDS]),
  });
})();
