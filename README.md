# ACT Values Clarification Tool

A web app for identifying and prioritizing personal values using [Acceptance and Commitment Therapy (ACT)](https://en.wikipedia.org/wiki/Acceptance_and_commitment_therapy) principles. Sort values into three tiers (Very Important, Somewhat Important, Not Important) to clarify what matters most to you.

## How it works

Create, rename, and share multiple tier lists of values. Each list is just a (long) URL, so if you send it to a friend, they can view it, and edit a separate copy of it. There is no automatic synchronization, because no data leaves your browser; only by sharing a link with someone do you a share the current state of your list.

Your lists are saved in your browser ("local storage"), but we recommend saving the link or printing a PDF version to save them for later, since your lists will be lost if you clear your browsing data. When you print a PDF, we include a QR code at the bottom with the share link for your list, so you can edit your list further later if you want.

To create your list, the website supports both a "desktop mode" and a "mobile mode". In desktop mode, you can drag-and-drop values or use keyboard shortcuts (the numbers 1, 2, and 3). In mobile mode, you use swipe gestures, and there is a separate "review" screen to support viewing all your tiers. Either way, you can categorize and identify your values, then save the link or print a PDF.

Go to https://valuetier.org/ to use the app.

If you have problems, you can [file an issue](https://github.com/ericphanson/valuetier.org/issues/new), which needs a free GitHub account. You can also contact me [here](https://ericphanson.com/contact), though I am not always responsive.


## Design goals

- Statically hostable (maintainable and sustainable long-term)
- Able to keep full tier state in shareable URLs (shareability / legibility)
- "Back up" URL state to localStorage (don't lose work on accidental tab close)
- Ergonomic interactions (make it actually usable: keyboard shortcuts, swipe gestures, drag-and-drop)
- Print-friendly layout (archiving and offline sharing)

## Current architecture

React, TypeScript, Tailwind CSS. Code written by Claude Sonnet 4.5.

## Developer notes

### Clear local storage

You clear local storage by adding `?clear=1` to the URL. For example: `https://valuetier.org/?clear=1`. This is usually only needed by developers, as the UI provides a mechanism to delete lists. If the UI isn't loading though, clearing local storage could help.

Note: This will delete all your saved lists, so make sure you have exported any important lists first!
