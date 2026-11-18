# Архітектурні рішення

Формат ADR: MADR (Markdown Any Decision Records).

## Правила

- Один ADR описує одне архітектурне рішення.
- ADR створюється, коли рішення має довготривалі наслідки або впливає на кілька модулів.
- Прийнятий ADR не переписується заднім числом; змінене рішення отримує новий ADR.
- Статуси: `Proposed`, `Accepted`, `Rejected`, `Deprecated`, `Superseded`.
- Назви файлів: `ADR-NNN-коротка-назва.md`.

## Шаблон

```markdown
# ADR-NNN: Назва рішення

- Status: Proposed
- Date: YYYY-MM-DD
- Deciders: ...
- Technical area: ...
- Related requirements: ...
- Supersedes: ...
- Superseded by: ...

## Context and Problem Statement
Яку проблему потрібно вирішити і чому зараз.

## Decision Drivers
- ...

## Considered Options

### Option 1: назва
- Переваги: ...
- Недоліки: ...

### Option 2: назва
- Переваги: ...
- Недоліки: ...

## Decision Outcome
Обране рішення та його межі.

## Positive Consequences
- ...

## Negative Consequences
- ...

## Risks and Mitigations
- ...

## Implications for Architecture
- Модулі: ...
- Дані: ...
- Інтеграції: ...
- Безпека: ...
- Експлуатація: ...

## Confirmation
Як перевіряється, що рішення реалізоване.

## References
- ...
```
