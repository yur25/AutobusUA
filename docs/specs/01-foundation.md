# Spec 01

## Інженерна основа AutobusUA

## Context

### Current State

До початку роботи існував лише `spec.md` з описаною користувачем ідеєю та
погодженою архітектурою застосунку. Реалізація, README, стандарти, перевірки,
пакети та git hooks були відсутні.

### Problem

Початковий опис не задавав єдиного формату для наступних лабораторних,
Definition of Done або переліку перевірок. Не були налаштовані стиль,
форматування, lint, статичний аналіз, smoke-тест і збірка. Компоненти, модулі,
дані та сценарії також не були оформлені в окремій структурованій специфікації.

## Goal

Підготувати репозиторій і документацію для послідовної реалізації застосунку:

- описати ідею в `README.md`;
- налаштувати пакети, стиль, форматтер, lint і статичний аналіз;
- налаштувати git hooks для format, lint, smoke-test і build на commit/push;
- створити стандарти `standards/`;
- описати компоненти, модулі, взаємодії, дані, зв'язки й оновлення в ключових
  сценаріях;
- провести аудит відповідності структури репозиторію цій специфікації та
  визначити топ-3 зайві або неправильні залежності.

## Scope

### In scope

- README з описом ідеї, мети та меж проєкту.
- Пакети, стиль коду, Prettier, ESLint, TypeScript strict mode, smoke-тест,
  збірка та Husky hooks з lint-staged.
- Універсальні стандарти spec, MADR ADR, Definition of Done і verification
  checklist у `standards/`.
- Специфікація модульної архітектури, даних, зв'язків і ключових сценаріїв.
- Аудит структури репозиторію та залежностей.

### Out of scope

- Реалізація бізнес-логіки, API, міграцій, PostgreSQL і frontend.
- Повна реалізація функціональних та інтеграційних тестів.

## Implementation

### Repository and runtime

Кореневий `README.md` описує призначення, стек, поточний стан і команди запуску.
Проєкт має TypeScript/NestJS-каркас у `src/` як ESM-застосунок. `AppModule`
підключає заглушки `Auth`, `Carriers`, `Trips` і `Bookings`; `GET /health`
використовується як мінімальна перевірка запуску. Production build створює
`dist/`, dev-режим запускається через `tsx watch`.

### Quality tools and automation

`package.json` містить runtime-залежності NestJS і dev-залежності TypeScript,
ESLint, Prettier, Husky, lint-staged та `tsx`. Prettier налаштований з
подвійними лапками і `tabWidth: 4`. ESLint використовує flat config для
TypeScript, а `tsconfig.json` і `tsconfig.test.json` вмикають strict typecheck.

Pre-commit запускає lint-staged для форматування й lint змінених файлів.
Pre-push запускає typecheck, build і smoke test. Smoke test у
`tests/smoke-test.ts` використовує вбудований `node:test` та перевіряє
`GET /health`.

### Architecture documentation

Застосунок заплановано як модульний моноліт NestJS/TypeScript. Межі модулів:
`Auth` — автентифікація, сесії та ролі; `Carriers` — заявки та дії
адміністратора; `Trips` — рейси й пошук; `Bookings` — купівля, скасування та
місткість. Циклічні залежності між модулями заборонені.

Основні сутності — `User`, `CarrierApplication`, `Trip`, `Ticket`, `Session`.
PostgreSQL використовується як єдина цільова БД, серверні сесії зберігаються в
ній. `Trip` має `capacity` і `occupiedSeats`; `Ticket` зберігає ціну купівлі та
статус. Детальна модель винесена в [ER diagram](../er-diagram.md).

Ключові сценарії описані в документації: подання та розгляд заявки,
створення рейсу підтвердженим перевізником, конкурентна купівля через
`SELECT ... FOR UPDATE` і скасування квитка з атомарною зміною місткості.

### Audit

Аудит структури та залежностей є частиною результату цієї роботи, але ще не
виконаний. Він має зіставити фактичні файли й модулі зі scope та Implementation,
а також надати топ-3 зайві або неправильні залежності з обґрунтуванням.
Якщо підтверджено менше ніж три знайдені проблеми, додавати вигадані findings
не потрібно.

## Acceptance Criteria

- **AC-1:** `README.md` описує ідею, мету, межі та спосіб запуску AutobusUA.
- **AC-2:** Репозиторій містить налаштовані пакети, Prettier, ESLint, strict
  typecheck, smoke-тест і build-команди.
- **AC-3:** Pre-commit запускає форматування та lint staged-файлів, а pre-push
  запускає typecheck, build і smoke test та завершується помилкою при їх збої.
- **AC-4:** `standards/` містить шаблони spec, MADR ADR, Definition of Done і
  verification checklist.
- **AC-5:** Spec та пов'язані документи описують модулі, взаємодії, сутності,
  зв'язки й оновлення даних у ключових сценаріях.
- **AC-6:** Аудит містить висновок про відповідність структури spec і топ-3
  підтверджені зайві або неправильні залежності з обґрунтуванням.

## Verification

- Перевірити README, `standards/`, spec і фактичну структуру репозиторію вручну.
- Запустити `npm run format:check`, `npm run lint`, `npm run typecheck`,
  `npm run build` і `npm run smoke:test`.
- Перевірити pre-commit на staged-файлі з помилкою та pre-push на повному
  pipeline.
- Виконати аудит структури й залежностей за AC-6; зафіксувати щонайбільше
  топ-3 підтверджені висновки без вигаданих findings.
- Звірити результат із [verification checklist](../../standards/verification-checklist.md).

## Open Questions

Немає питань, що блокують наступну лабораторну.
