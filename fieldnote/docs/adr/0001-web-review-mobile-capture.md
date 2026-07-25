# 0001. The phone captures, the web reviews

- **Status:** accepted
- **Date:** 2026-07-25

## Context

Fieldnote spans two surfaces and could plausibly do everything on both. A
surveyor could review a report on their phone in the van; they could start a
recording from a laptop. Most competitors in adjacent categories build full
parity across mobile and web, and the pull to match them is strong.

The pull is wrong, for two reasons.

The first is about the work itself. Capture and review are different activities
performed in different postures. Capture happens standing up, one-handed, in bad
light, often with gloves on, in a loft with no signal. Review happens sitting
down, two-handed, with a keyboard, a large screen and a coffee. A UI good at one
is bad at the other. A record button large enough to hit without looking is
absurd on a laptop; a thirty-field form with inline editing and source
tap-through is unusable on a phone.

The second is about capacity. Building full parity across iOS, Android and web
as a solo founder means three implementations of every screen, three sets of
bugs, and three release cycles. That is how a small team ships nothing.

## Decision

The phone captures. The web reviews, edits, exports, administers and reports.

The mobile app is approximately six screens and stays that way:

1. Report list with sync status
2. New report (template, address, client, reference)
3. Capture (record button, level meter, section chips, camera, offline
   indicator, pending count)
4. Upload queue
5. Settings
6. Sign in

The web app owns everything else: the review workspace, export, delivery,
templates, team management, billing and settings.

Sync is one-way. Captures go up. Report values are edited on the web only and
never travel back down to the phone.

## Consequences

**Good.**

The one-way sync is the largest win. Because report values are only ever edited
in one place, there is no concurrent edit to reconcile, no merge conflict, and
no need for CRDTs or operational transforms. A whole category of distributed
systems difficulty simply does not arise. We should be suspicious of any future
feature that would create a second writer.

Each surface can be optimised without compromise. The capture screen can have a
112-point record button and no navigation chrome. The review workspace can
assume a keyboard and a wide viewport.

The mobile app stays small enough for one person to maintain across two
platforms.

**Bad.**

A surveyor cannot review on their phone. This will be requested, probably within
the first week of the beta. The honest answer is that reviewing a thirty-field
report on a phone is not a good experience even when it is possible, and that
the fifteen-minute evening review is the product's actual promise.

Photo captions are the awkward case: captions are natural to write on site while
the subject is in front of you, but they are part of the report rather than part
of the capture. The current split has captions edited on the web, which is
slightly wrong. If field evidence says caption editing on the phone is important,
that is the one exception worth considering — it is additive data on a row the
phone already owns, so it does not create a second writer for report values.

**Revisit if.** Field testing shows surveyors routinely reviewing between
appointments rather than in the evening, or if the six-screen limit starts
requiring genuinely awkward workarounds rather than just saying no.
