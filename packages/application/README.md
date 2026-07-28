# Application package

Production orchestration for Tomato Clock's domain aggregate.

- `ApplicationService.initialize` loads the aggregate and its revision, or persists a new initial state with compare-and-swap semantics.
- Commands are serialized. Rejected domain commands are not saved.
- Accepted states are atomically saved against the service's expected revision before events are returned or notification side effects run.
- User-initiated `StartFocus` may request notification permission. `resume()` only refreshes existing capability.
- Recovery re-reads repository truth after each asynchronous notification boundary, completes an elapsed focus at its persisted `endsAt`, or reschedules a future notification.
- Notification failures return warnings and never roll back persisted timer truth.
- `activeProjectProjection()` exposes the current work and its unreported sessions; `worldProjection()` retains every active building and monument.

The repository implementation must make `save(state, expectedRevision)` an atomic compare-and-swap replacement and return the committed revision. A stale service must fail rather than overwrite an import or restore, then call `resume()` to adopt current repository truth. Browser storage, Capacitor, and UI code belong in their adapter packages.
