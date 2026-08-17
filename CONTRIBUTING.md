# Contributing

## Branches

Create branches from `main` using `feature/<short-name>`, `fix/<short-name>`,
`docs/<short-name>`, or `chore/<short-name>`.

## Commits and pull requests

Use an imperative Conventional Commit title:

```text
type(scope): concise outcome
```

Allowed types are `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci`,
and `build`. Keep titles under 72 characters. Describe product or engineering
outcomes only; do not mention coding agents, assistants, harnesses, generated
agent records, or local network ports.

Every pull request must state:

- the SRS requirement IDs it affects;
- the behavior and data-contract change;
- the checks run;
- any source-rights, provenance, security, or release impact;
- how failure leaves the current public release safe.

Do not commit raw source files unless their manifest explicitly permits it.
Do not commit AI-agent instructions, records, editor state, or harness files.
