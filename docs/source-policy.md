# Source policy

Public access is not a redistribution license. A connector may publish data
only when its version-controlled manifest is `approved_open` or
`approved_permission` and records the supporting evidence, attribution,
retention policy, reviewer, and next review date.

The pipeline checks rights before discovery or fetch. The following statuses
never enter a public release:

- `unknown`
- `internal_evaluation`
- `link_only`
- `blocked`

Internal parser evaluation must be explicitly approved, isolated from public
artifacts, and removed when retention is not permitted. Production never
bypasses access controls, anti-bot measures, or source-specific rate limits.
