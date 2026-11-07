# Usable chat viewports and responsive previews

Planned-with: gpt-6.1-sol
Suggested-Impl-Model: gpt-6.1-sol

## Evidence and scope

`enterprise/apps/web-portal/src/components/WorkspaceShell.tsx` currently updates height/offset only while `(max-width: 1023px)` matches. Wide touch viewports therefore ignore a software keyboard. The update also has no segment geometry and its sidebar breakpoints use the full display width. `AttachmentContentPanel.tsx` always docks at 48%; `DeepResearchFilesPanel.tsx` may clamp its width below usable preview chrome on a small container.

Only the existing Portal chat shell and shared chat preview components are in scope. Keep rooms, projects, settings and history navigation, existing chat scrolling behavior and research preview resize semantics. Do not add a new work page, device-name detection, product menus, server behavior or administrative/desktop changes.

## Implementation

1. Add `enterprise/features/chat/src/utils/usable-viewport.ts` with finite positive rectangle validation, intersection and deterministic selection of the visible segment. Compute the visual rectangle in layout CSS coordinates, intersect it with each valid segment, prefer a usable candidate containing the editing control, then the previous usable area, then largest area/top-left order. A candidate clipped below 200px height/240px width must not displace a usable alternative. Invalid/empty segment data falls back to the visual rectangle. A non-unit visual scale or zero-size rotation snapshot returns no update so pinch zoom does not reflow the app or collapse its height.
2. Add `hooks/useUsableViewport.ts` and a testable observer. Read current `window.viewport.segments`, with legacy feature-detected fallbacks, on every resize/orientation/posture snapshot. Coalesce events with one animation frame and bounded settling timers. Observe visual viewport resize/scroll, window/orientation/posture and focus/composition changes, including wide screens. Update only bounded CSS custom properties; return the compact-layout boolean when available width crosses 1024px. Never call scroll/focus from viewport updates, preserve input composition and clean up all listeners/frames/timers.
3. In `WorkspaceShell.tsx`, replace the narrow-only effect with that hook. The root is a fixed border-box frame using the computed left/top/width/height. Sidebar, backdrop and menu use available-width compact mode, with the original media-query fallback before hydration; an overlay sidebar is absolute inside the chosen frame. In `MachiChatView.tsx` mark the header/composer and let `globals.css` use that same compact attribute for menu clearance and composer spacing. Truncate long titles and let toolbar items wrap so physical display breakpoints cannot cause overlap inside a narrow segment.
4. Add `hooks/usePreviewPanelLayout.ts` to measure the actual parent via ResizeObserver and resize fallback. A container narrower than 900px uses an overlay instead of subtracting a narrow docked column. Overlay/fullscreen bounds use inherited usable viewport coordinates and safe-area padding, covering the underlying navigation as well as chat. In both preview panels retain explicit close/fullscreen controls, support Escape (ignore composition), contain focus within the topmost modal (including engines that skip buttons during native Tab), and restore prior focus without scrolling. Docked research drag/keyboard resizing remains unchanged; remove drag listeners and restore body cursor/selection on pointercancel, close, mode change or unmount. Re-clamp research width on parent resize, not only window resize.
5. Add focused geometry/observer/component tests and a path-scoped hosted regression workflow. Add a disposable browser fixture exercising the production viewport observer and both preview components; emulate keyboard, horizontal/vertical/three-segment layouts, orientation recovery, preview close and research pointer cleanup. Capture screenshots as test artifacts. Test tooling uses no live login, tokens or external model service.
6. The existing empty-chat hero is about 250px before the 156px composer and outer spacing, exceeding a keyboard-reduced chat area. Extract that existing presentation into `components/molecules/EmptyChatPane.tsx`; a height container query hides only its decorative hero and reduces outer spacing below 560px. Keep the same composer node mounted and scrollable. Reuse it from `MachiChatView.tsx` and in the synthetic browser fixture; assert empty-chat keyboard and short landscape layouts keep the composer inside the usable frame.
7. The existing model menu uses full-display width and a minimum 120px height above the trigger; those can cross a fold. Add a pure `placeMenuAboveTrigger` helper in `usable-viewport.ts`, clamp both axes to the chosen frame/visible intersection, and remeasure the open menu on viewport/frame changes using one queued animation frame. Preserve upward placement and selection semantics; dispose its observers and listeners when closed. Add narrow-width, horizontal-fold and short-region geometry assertions.

## Acceptance

- `fold-segment-layout.test.ts`: ordinary viewports, wide keyboard offsets, vertical/horizontal/three segments, visible intersections, invalid data, clipped focus, unusable fragments, pinch zoom and zero-size rotation snapshots.
- `useUsableViewport.test.ts`: listener cleanup, bounded settling, resize across 1024px, offsets, focus/composition, zoom recovery and unchanged scroller position/focus/selection.
- `WorkspaceShell.modes.test.tsx`: current chat/settings modes and rooms/projects navigation remain; computed compact mode controls sidebar independently of the display media query.
- `AttachmentContentPanel.mobile.test.tsx` and research preview tests: overlay only for small measured containers, close/fullscreen/Escape, desktop dock restoration, parent resize and pointercancel/unmount cleanup.
- Run the declared test files, scoped browser simulation and workflow syntax checks. Compare full Portal typecheck diagnostics against original `a680b0663` under the exact same dependency installation; report pre-existing diagnostics, never suppress them.
- Simulated browser geometry is not physical device acceptance. Real tablet/foldable software keyboards and device posture remain a separate acceptance stage.

## Validation results

- Seven focused test files pass 42 tests with zero skips/failures. The new geometry, observers, contract tests and browser harness pass `pnpm exec tsc --project tsconfig.portal-viewport-contracts.json`.
- The isolated browser fixture passes 13 scenarios in each of two engines, including keyboard offsets on wide and narrow screens, pinch recovery, horizontal/vertical/three-region layouts, header/menu clearance, focus/scroll preservation, previews, pointer cancellation and short empty-chat layouts. Screenshots were rendered and visually inspected. These tests inject geometry snapshots; they do not claim a native keyboard or physical posture was exercised.
- Full Portal typecheck remains 33 diagnostics; the shared chat package remains 13. An original `a680b0663` source snapshot installed from the exact same dependency lock reports the same diagnostics, with zero additional signatures in this branch. No type-error bypass was added or changed.
- `portal-viewport-regressions.yml` passes actionlint. It checks the seven declared test files exist, runs the isolated contracts typecheck and DOM regressions, then runs the two browser engines on a fixed supported host image and retains reports/screenshots. Hosted run results still need checking after publication.
- Test-only dependencies were added explicitly; no live environment, authentication, model service, deployment setting or product permission was used.

## Primary API references

- https://drafts.csswg.org/css-viewport/#segments — snapshot geometry and resize/orientation/posture re-query semantics.
- https://developer.chrome.com/blog/viewport-segments-api-shipped — current `window.viewport.segments` location.
- https://drafts.csswg.org/cssom-view/#the-visualviewport-interface — visual viewport offset and scale.
