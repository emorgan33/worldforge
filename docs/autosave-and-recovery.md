# Autosave and draft recovery

The article editor saves 1.5 seconds after editing pauses, without leaving the editor. New articles start in Draft state and reuse the ID returned by their first save. Save Article remains available to save immediately and return to the article preview.

Only one save runs at a time. Changes made during a request remain dirty and trigger another save afterward. Failed saves show an error and an explicit Retry save action; they do not continually retry. A committed write is still treated as successful if the subsequent list/detail refresh fails.

Local recovery snapshots include fields, rules-profile metadata, HTML and structured block JSON. They are scoped by world and article (or the world's new-article session) in browser localStorage. Returning to an editor with a different local snapshot offers Restore draft and Discard draft. Recovery never overwrites the server until explicitly restored. Successful saves remove the matching snapshot; newer changes stay recoverable. Storage failures are visible. Drafts stay in this browser; clearing browser data removes them. Simultaneous edits in multiple tabs are not merged.

Navigation remains blocked during saves. Leaving with pending changes asks for confirmation and retains the recovery snapshot when storage is available. Blank-title drafts are kept locally but are not sent to the server.

Validation: draft parsing tests cover structured content, article identity and rejection of malformed/cross-world data. Chromium checks cover debounced database persistence, editing during an in-flight request, save failure, reload/restore/retry, local snapshot cleanup, and multiple autosaves plus manual completion of a new article without duplication. Existing block, organization and RPG tests remain in the suite.

Production verification completed: all 17 automated tests (including the API integration test), TypeScript, focused ESLint and the production build passed. The Chromium autosave/recovery scenarios also passed against the production server on port 3033, with isolated records removed afterward.
