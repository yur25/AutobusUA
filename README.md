# AutobusUA

Backend-платформа для пошуку міжміських автобусних рейсів по Україні та
купівлі квитків.

## Стек

- Node.js, TypeScript, NestJS;
- PostgreSQL через `pg`, parameterized SQL і автоматичні міграції;
- ESLint, Prettier, TypeScript strict mode;
- Husky і lint-staged.

## Стан проєкту

HTTP API використовує PostgreSQL для автентифікації, заявок перевізників,
рейсів і квитків. Під час старту застосунок перевіряє з'єднання та застосовує
невиконані міграції; недоступна база зупиняє запуск.

## Встановлення та запуск

Потрібні Node.js 24+, npm, GNU Make і Docker з Docker Compose.

Підготуйте локальну конфігурацію для застосунку й тестового набору
(unit, integration та E2E), використовуючи окрему тестову БД:

```powershell
Copy-Item .env.example .env
Copy-Item .env.test.example .env.test
```

Замініть усі пароль-заповнювачі у `.env` та `.env.test` на той самий локальний
пароль. Переконайтеся, що test URL вказує на окрему `autobusua_test` базу, потім
запустіть PostgreSQL і застосунок:

```bash
make install
make db-up
make dev
```

`make dev` завантажує `.env`, запускає TypeScript через SWC з налаштуваннями
декораторів із `tsconfig.json` і автоматично перезапускає застосунок після змін.
SWC не перевіряє типи, тому окремо запускайте `make typecheck` або `make verify`.

Compose ізолює PostgreSQL від системних портів, публікуючи її на `55432` за
замовчуванням. `make db-down` зупиняє та прибирає Compose-контейнери, зберігаючи
дані БД у volume; окремо запущений застосунок потрібно зупинити самостійно.
Для перегляду й схвалення заявок перевізників задайте
`BOOTSTRAP_ADMIN_PHONE` та `BOOTSTRAP_ADMIN_PASSWORD` у `.env`; обидві змінні
потрібні разом, пароль має містити щонайменше 12 символів. Без них API
запускається без адміністратора.

`make db-migrate` застосовує міграції окремо; під час звичайного запуску вони
також виконуються автоматично. Шлях до міграцій визначається від модуля
застосунку, а не від поточної директорії; під час перенесення збірки потрібно
зберегти каталог `database/migrations` поруч із каталогом `dist`.

Застарілі записи ідемпотентності періодично очищаються. Список таких записів і
їх кількість читаються узгоджено в межах одного PostgreSQL-запиту.

API починається з `/api/v1`; ключові маршрути наведені в
[Spec 02](docs/specs/02-implementation.md) та [ER/API diagram](docs/er-diagram.md).

Перевірка доступності застосунку:

```text
GET http://localhost:3000/health
```

Готовність застосунку до роботи з PostgreSQL:

```text
GET http://localhost:3000/health/ready
```

Версія збірки та Git commit SHA:

```text
GET http://localhost:3000/version
```

Для `make build` SHA коміту зчитується під час build і вбудовується в артефакт.
У середовищі збірки поза Git-репозиторієм можна передати повний SHA через
`GIT_COMMIT`.

Production-збірка та запуск:

```bash
make build
make start
```

Повний локальний pipeline перевірок:

```bash
make verify
```

`make help` показує доступні команди, зокрема `test`, `coverage`, `smoke`,
`mutation`, `typecheck`, `lint`, `format` і `format-check`. `make coverage`
перевіряє branch coverage `CarriersService`.

`make test` піднімає PostgreSQL через Docker Compose, чекає на її готовність,
застосовує міграції до тестової БД та послідовно запускає unit, integration і
E2E тести. Unit-тести розміщені біля класів у `src/`; integration та E2E —
відповідно в `tests/integration/` та `tests/e2e/`. Integration/E2E працюють зі
справжньою PostgreSQL. E2E запускають зібраний застосунок окремим процесом.
`CarriersService` має 100% покриття логічних гілок; його unit-тести
використовують вручну написані фейки залежностей без запуску БД чи інших
реальних модулів.

`make test` залишає PostgreSQL запущеною та не видаляє тестову БД; тести
прибирають лише створені ними записи. Для запуску потрібна виділена
`TEST_DATABASE_URL` у `.env.test`, що вказує на `autobusua_test`; міграції та
тести відмовляються працювати з іншою БД.

`make mutation` запускає Stryker із Vitest runner лише для критичної
бізнес-логіки, перевірюваної unit-тестами. Mutation score не має порога;
mutants, що вижили, класифікуються в
[звіті мутаційного аналізу](docs/audits/03-mutation-testing-report.md).
Окремий аудит структури та критеріїв приймання Spec 03 завершено; він не
входить до `make verify`; його результати наведені у
[звіті аудиту тестування](docs/audits/03-testing-audit.md).

Деталі вимог описані у [Spec 01](docs/specs/01-foundation.md) і
[Spec 02](docs/specs/02-implementation.md) та
[Spec 03](docs/specs/03-testing.md), а
архітектурні рішення — у [ADR](docs/adr/README.md).
