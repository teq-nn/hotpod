# POC Local Recording – Planning Overview

## Branch Strategy
- Base branch: `work`
- Feature branch: `poc/local-recording`

## Epics and Issues

### Epic: Local Recording Enablement
- **Goal:** Deliver end-to-end support for local recording sessions within the Hotpod environment.
- **Acceptance Criteria:**
  - Recording lifecycle (join, active, leave) is fully documented with expected UI states.
  - Local recording artifacts can be generated, exported, and verified for integrity.
  - Demo script validates the user journey in a browser build.

#### Issue: Join/Leave Flow Enhancements
- **Description:** Ensure participants can start and stop local recording when joining or leaving a session, including state synchronization across clients.
- **Acceptance Criteria:**
  1. Participant joining a session sees recording controls with correct default state.
  2. Starting/stopping recording updates all connected clients within 2 seconds.
  3. Leaving a session stops recording gracefully and persists partial data.
  4. Audit log captures join/leave events with timestamps.
- **Definition of Done:**
  - Unit and integration tests cover state transitions for join/leave.
  - UX copy reviewed and approved by product design.
  - Documentation updated in `docs/session-lifecycle.md` with screenshots.
  - Feature flag configuration for local recording updated and deployed to staging.

#### Issue: Recording Management
- **Description:** Implement reliable local recording capture with progress feedback and error handling.
- **Acceptance Criteria:**
  1. Users can start a new recording and see a timer indicator.
  2. Recording automatically splits after 2 hours to prevent file corruption.
  3. Error states (disk full, permissions) present actionable messages.
  4. Local cache stores recordings until manual export or auto-cleanup after 30 days.
- **Definition of Done:**
  - Automated tests simulate recording sessions and failure modes.
  - Observability dashboards updated with recording metrics (start/stop counts, error rates).
  - Security review completed for local storage handling.
  - Release notes drafted and shared with stakeholders.

#### Issue: Recording Export Pipeline
- **Description:** Provide export workflows for recorded sessions, including metadata packaging and delivery confirmation.
- **Acceptance Criteria:**
  1. Users can export recordings as ZIP containing media + JSON metadata.
  2. Export process indicates progress and completion status.
  3. Downloaded artifacts pass checksum validation.
  4. Exports are logged with user ID and timestamp for auditing.
- **Definition of Done:**
  - End-to-end tests verify export flow on macOS, Windows, and Linux builds.
  - Documentation added to `docs/export-guide.md` with troubleshooting tips.
  - Customer support macro prepared for common export questions.
  - Telemetry events for export success/failure integrated and reviewed.

## Demo Session Plan

### Objectives
- Demonstrate the join/leave synchronization, active recording management, and export delivery in a browser-based build.

### Test Script Outline
1. Launch browser build version `poc-local-recording`.
2. Join session as Host; verify recording controls default to "Ready" state.
3. Start recording; confirm timer UI and telemetry event in console.
4. Join as Guest in second browser; validate synchronized recording state.
5. Trigger simulated disk-full warning; confirm error messaging.
6. Stop recording; observe automatic persistence message.
7. Export recording; download ZIP and verify checksum with provided script.
8. Leave session with both users; confirm audit log entries.

### Browser Build Requirements
- Build branch `poc/local-recording` via CI pipeline `webapp-browser-build`.
- Enable feature flag `localRecordingEnabled` for demo users.
- Provide signed URL for latest build artifacts (Chrome/Edge).

### Test Data Preparation
- Seed database with demo workspace `LocalRec-Demo` and members `host@example.com`, `guest@example.com`.
- Preload sample agenda notes to simulate real meeting context.
- Prepare checksum verification script `scripts/verify-export-checksum.js` with expected hash values.
- Ensure logging sinks (Datadog, S3) are pointing to staging resources for observation.

