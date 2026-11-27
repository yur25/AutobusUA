# ADR-005: Vitest замість `node:test` для тестового набору

- Status: Accepted
- Date: 2026-11-21
- Deciders: Проєкт AutobusUA
- Technical area: Test infrastructure
- Related requirements: `docs/specs/03-testing.md`
- Supersedes: N/A
- Superseded by: N/A

## Context and Problem Statement

Для лабораторної 3 потрібен єдиний runner для unit, integration та E2E тестів
на TypeScript/ESM, а також для вибраного Stryker mutation testing. Початкові
smoke-тести використовували вбудований `node:test`. Потрібно було визначити,
чи залишити його, чи перейти на Vitest.

## Decision Drivers

- Один узгоджений runner для всіх рівнів тестування.
- Зручні mocks, spies, timers і coverage для unit-тестів критичної логіки.
- Підтримка TypeScript/ESM і сумісність із Stryker.
- Можливість запускати integration та E2E зі справжньою PostgreSQL і окремим
  процесом застосунку.
- Прийнятна складність залежностей, конфігурації та ізоляції тестових даних.

## Considered Options

### Option 1: Vitest

- Переваги: підтримує TypeScript/ESM у тестовому циклі; надає mocks, spies,
  fake timers, фільтрацію та coverage; має Stryker Vitest runner; дозволяє
  виконувати всі типи тестів однією системою команд.
- Недоліки: додає залежності й конфігурацію; паралельне виконання потрібно
  контролювати для тестів зі спільною PostgreSQL; runner сам не забезпечує
  ізоляцію даних чи керування окремим процесом застосунку.

### Option 2: `node:test`

- Переваги: вбудований у Node.js, не потребує окремої залежності runner;
  підходить для async, HTTP та PostgreSQL сценаріїв; Stryker може запускати
  тести через TAP runner.
- Недоліки: для TypeScript потрібна окрема конфігурація loader або build;
  немає еквіваленту Vitest module mocking до завантаження ESM-модуля; TAP
  runner вимагає окремої інтеграції Stryker замість спеціалізованого Vitest
  runner.

## Decision Outcome

Обрано Vitest як єдиний runner для unit, integration та E2E тестів, а також
для Stryker. Рішення базується на узгодженому TypeScript/ESM workflow,
можливостях ізоляції критичних unit-гілок і прямій інтеграції зі Stryker
Vitest runner, а не на тому, що Vitest є шаблоном Nest CLI.

## Positive Consequences

- Три рівні тестів запускаються однією системою та мають спільні утиліти.
- Unit-тести можуть використовувати spies, mocks і timers для перевірки
  бізнес-гілок та помилок залежностей.
- Mutation testing використовує Stryker Vitest runner без адаптації тестів
  до іншого протоколу.

## Negative Consequences

- Runner і Stryker runner додають dev-залежності та конфігурацію.
- Vitest не замінює окремі налаштування запуску застосунку, тестової БД,
  міграцій і очищення тестових записів.

## Risks and Mitigations

- Паралельні тести можуть конфліктувати через спільну тестову БД; Vitest
  налаштовано на послідовний запуск, а тести прибирають створені ними записи.
- Помилкове підключення до іншої БД може пошкодити дані; test migration
  перевіряє, що ціль — `autobusua_test`.
- Mutation suite може стати надто повільним; Stryker обмежений чотирма
  критичними сервісами та пов'язаними unit-тестами.

## Implications for Architecture

- Модулі: production-модулі не залежать від Vitest; unit-тести сервісів
  створюють тестований клас із підставними залежностями.
- Дані: integration та E2E використовують справжню тестову PostgreSQL.
- Інтеграції: Vitest є runner для тестів, а Stryker використовує його окрему
  конфігурацію.
- Безпека: вибір runner не змінює runtime-авторизацію чи захист даних.
- Експлуатація: `make test` готує тестову БД і запускає всі рівні;
  `make mutation` запускає окремий mutation workflow.

## Confirmation

Підтверджено успішними перевірками: `make test` — 81 unit, 14 integration і
3 E2E тести; `make mutation` — 403 мутанти, з яких 349 вбито та 54 вижили.
Також пройшли typecheck, lint і format check; наявні smoke-сценарії входять
до E2E набору.

## References

- [Spec 03](../specs/03-testing.md)
- [Mutation testing report](../audits/03-mutation-testing-report.md)
- [Vitest configuration](../../vitest.config.ts)
- [Stryker configuration](../../stryker.config.mjs)
- [Package scripts and dependencies](../../package.json)
