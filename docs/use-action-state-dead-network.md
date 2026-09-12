# `useActionState` and a dropped connection

A finding from send-183 through send-188 (tracker notes losing a draft on a
dead network), written down so the deferred audit below doesn't have to
re-derive it. **Read this before assuming any of the 25+ other
`useActionState` + `<form action>` call sites need a full Route Handler
rewrite — most probably don't.**

## The mechanism, confirmed

React's documented behavior for `useActionState(action, initialState)`: if
`action` **returns** a value — even one that means "this failed" — the hook's
state updates normally. If `action` **rejects/throws**, React escalates the
rejection straight to the nearest Error Boundary instead. A `"use server"`
action's own `try/catch` only ever sees a failure that reached the server; a
transport-level failure (a dropped connection, an aborted request — the POST
never lands at all) makes the client-side call to the bound server reference
itself reject, and that rejection happens inside React's own action-dispatch
machinery — below the action's own body, and below anything a component can
see once it has already handed the dispatcher (the `formAction` that
`useActionState` **returns**) off to `<form action={formAction}>`.

**What does NOT work**: wrapping the *returned* `formAction()` dispatcher in
a `try/catch` (e.g. calling it manually from an `onSubmit` handler). That
call's own stack frame isn't where the rejection surfaces — React's
transition scheduling produces it asynchronously, outside that frame
entirely. A PR in this history tried exactly this, concluded no catchable
path exists inside `useActionState` at all, and used that conclusion to
justify moving a form off Server Actions entirely onto a plain `fetch()` +
Route Handler.

**What DOES work**: wrapping the *action function itself* — the first
argument passed INTO `useActionState`, before the hook ever sees it — in a
`try/catch`. This function is plain application code; nothing about calling
it and awaiting its result happens inside React's own dispatch internals.
A rejection there is an ordinary rejected promise this wrapper's own `await`
already sits around. Catch it, return the same `{status:"error", ...}` shape
the action's own server-side failures already produce, and `useActionState`
never sees a rejection to escalate.

That fix shipped as `withNetworkFallback` in
[PR #376](https://github.com/Bayo-1987/Claude-Talentrah/pull/376) (a small,
generic wrapper — `(action, onFailure) => wrapped action`), verified
deterministically: the isolated e2e case that used to fail 3/3 in isolation
passed 3/3 after the fix, in isolation, after every other test in its file
individually, and across repeated full-file runs. **#376 itself was closed
without merging** — not because the fix was wrong, but because a second,
independent PR (#377, same bug, different session) reached the server via a
plain Route Handler instead, sidestepping a second bug the
`useActionState`-based fix had to work around separately (React's own
post-action reset of an uncontrolled field, once the action resolves instead
of rejecting) and arrived with more thorough verification behind it. Two
different valid fixes for the same root cause — #377 was picked for reasons
specific to that one component, not because `withNetworkFallback`'s
mechanism doesn't work. It does, and `with-network-fallback.ts` never landed
on `main`, so this doc — not that file — is the durable record of it.

## For the deferred 25+ component audit

When that audit happens (see `useActionState` usages across
`src/components/`), the question for each call site is **not** "does this
need a Route Handler rewrite" by default. It's:

1. Does a genuine transport-level failure (not just a server-side error the
   action already handles) matter for this form — is there real, effortful
   user input worth preserving, or is it a low-stakes single-action button
   with nothing to lose on a failed click?
2. If it matters: the minimal fix is almost always re-deriving
   `withNetworkFallback`'s pattern (or extracting it to a real shared
   helper and reusing it) — wrap the action passed to `useActionState`, not
   the dispatcher it returns.
3. A Route Handler + plain `fetch()` rewrite is a legitimate alternative,
   but a bigger diff, a new endpoint to secure independently, and doesn't
   generalize the same fix across the other components the way a shared
   wrapper does. Reach for it only when a call site has its own separate
   reason to want it (as #377 did), not as the default answer to this
   specific problem.
